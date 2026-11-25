// node --test testes/*.test.mjs
// Conduz tarefas inteiras com o maestro, do plano à PR, num mundo de mentira: dois repositórios
// git com remoto local, um gh falso e subagentes simulados. Cada teste erra de um jeito que um
// modelo pequeno erraria, e confere que o maestro percebe, corrige o rumo ou para.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  agentes,
  BRANCH,
  criarMolde,
  destruir,
  existe,
  F1,
  fatia,
  gh,
  git,
  gravar,
  hook,
  implementar,
  iniciar,
  ler,
  lerPedido,
  livro,
  maestro,
  mudarConfig,
  mudarGh,
  novoMundo,
  operar,
  plano,
  planoDaTarefa,
  responder,
  tarefaAtual,
} from './apoio/mundo.mjs';

let molde;
const mundos = [];

before(() => {
  molde = criarMolde();
});

after(() => {
  for (const pasta of [molde, ...mundos]) destruir(pasta);
});

function mundoNovo(opcoes) {
  const mundo = novoMundo(molde, opcoes);
  mundos.push(mundo.pasta);
  return mundo;
}

const papeis = (corrida) => corrida.pedidos.map((pedido) => pedido.papel);
const commitsDaBranch = (pasta) => git(pasta, 'log', '--format=%s', `origin/main..${BRANCH}`).split('\n').filter(Boolean);
const REGRA_DO_BACKEND = '.cursor/rules/padrao-backend.mdc';
const problemaDe = (mundo, pedido) => ler(mundo, pedido.caminhos('Problema da tentativa anterior')[0] ?? pedido.caminhos('Achados a corrigir').pop());

test('entrega completa: do plano às duas PRs com os checks verdes, sem o humano', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo));

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(papeis(corrida), ['planejar', 'criticar', 'executar', 'revisar', 'descrever', 'executar', 'revisar', 'qa', 'descrever']);
  assert.ok(corrida.pedidos.every((pedido) => pedido.subagente === 'maestro-passo'));

  // Quem fez branch, commit e push foi o maestro, com a mensagem que o executor escreveu.
  for (const pasta of [mundo.api, mundo.web]) {
    assert.equal(git(pasta, 'rev-parse', '--abbrev-ref', 'HEAD'), BRANCH);
    assert.equal(commitsDaBranch(pasta).length, 1);
    assert.equal(git(pasta, 'rev-parse', 'HEAD'), git(pasta, 'rev-parse', `origin/${BRANCH}`));
    assert.equal(git(pasta, 'status', '--porcelain'), '');
  }
  assert.deepEqual(commitsDaBranch(mundo.api), ['feat: trabalho 1 do backend']);

  const { prs, chamadas } = gh(mundo);
  assert.equal(prs.api.length, 1);
  assert.equal(prs.web.length, 1);
  assert.equal(prs.api[0].isDraft, false, 'a PR nasce em rascunho e sai dele com os checks verdes');
  assert.ok(chamadas.some((chamada) => /^api: pr create .*--draft/.test(chamada)));
  assert.equal(prs.api[0].title, 'PARC-482 vendas por parceiro (backend)');
  assert.match(prs.api[0].body, /## O que e por quê/);
  assert.match(prs.api[0].body, /## Provas \(geradas pelo harness, não pelo modelo\)/);
  assert.match(prs.api[0].body, /Portões locais \(testes\): verdes/);
  assert.match(prs.api[0].body, /QA na tela: não se aplica/);
  assert.match(prs.web[0].body, /QA na tela: passou/);

  assert.match(corrida.texto, /PR de backend: #101 — 1 check verde, pronta para revisão/);
  assert.match(corrida.texto, /PR de frontend: #102/);
  assert.match(corrida.texto, /Plano aprovado sem você/);
  assert.match(corrida.texto, /O total vem em centavos/, 'as premissas do plano chegam ao humano');
  assert.match(corrida.texto, /Falta de você: revisar e fazer o merge/);

  const planoFinal = planoDaTarefa(mundo);
  assert.match(planoFinal, /^Status: em revisão$/m);
  assert.match(planoFinal, /^- \[x\] \*\*F1 · backend/m);
  assert.match(planoFinal, /^- \[x\] \*\*F2 · frontend/m);

  // Depois do fim, chamar de novo só repete o relatório.
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: FIM/);
});

test('plano com erro volta ao planejador com a lista; crítica reprovada também volta', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const semEspelho = fatia('F1', 'backend', 'parser de vendas', '`src/parsers/`', '`src/parsers/nao-existe.js`');
  const corrida = operar(
    mundo,
    agentes(mundo, {
      planejar: (pedido, vez, padrao) => {
        if (vez > 1) return padrao(pedido);
        gravar(mundo, pedido.caminhos('Plano')[0], plano({ fatias: [semEspelho, '- [ ] F2 frontend tela'], aprovados: '- `api/package.json` — dependência nova' }));
        return responder(mundo, pedido, 'RESULTADO: ok');
      },
      criticar: (pedido, vez, padrao) => {
        if (vez > 1) return padrao(pedido);
        return responder(mundo, pedido, 'VEREDITO: REPROVADO\nACHADOS: 1\n1. F1 — o Escopo não inclui `src/routes/index.js`, que registra o espelho — acrescente');
      },
    }),
  ).pedidos;

  assert.deepEqual(corrida.map((pedido) => pedido.papel).slice(0, 5), ['planejar', 'planejar', 'criticar', 'planejar', 'criticar']);
  const erros = problemaDe(mundo, corrida[1]);
  assert.match(erros, /o Espelho "src\/parsers\/nao-existe.js" não existe em api\//);
  assert.match(erros, /Linha de fatia fora do formato: "- \[ \] F2 frontend tela"/);
  assert.match(erros, /"Desvios aprovados" só recebe o que o humano aprovou/);
  assert.match(corrida[1].parametros.Motivo, /refazer o plano/);
  assert.match(ler(mundo, corrida[3].caminhos('Parecer a atender')[0]), /src\/routes\/index\.js/);
});

test('dúvida no plano: a condução para e só segue com a resposta do humano', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const comDuvida = plano({ duvidas: '1. O total é bruto ou líquido? Opções: bruto | líquido. Recomendo: bruto.' });
  const respostas = [];
  const pares = [];
  const corrida = operar(
    mundo,
    agentes(mundo, {
      planejar: (pedido, vez, padrao) => {
        respostas.push(pedido.parametros['Resposta do humano']);
        if (vez > 1) return padrao(pedido, vez);
        gravar(mundo, pedido.caminhos('Plano')[0], comDuvida);
        return responder(mundo, pedido, 'RESULTADO: ok');
      },
    }),
    { humano: (pare) => (pares.push(pare) === 1 ? 'O total é líquido. Pode seguir.' : null) },
  );

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.match(pares[0], /PLANO — PARC-482 — parser de vendas/);
  assert.match(pares[0], /Dúvidas do plano:\n1\. O total é bruto ou líquido\?/);
  assert.deepEqual(respostas, ['(nenhuma)', 'O total é líquido. Pode seguir.']);
  assert.match(planoDaTarefa(mundo), /## Decisões do humano\n\n- \d{4}-\d\d-\d\d \(plano\): O total é líquido\. Pode seguir\./);
});

test('com aprovarPlano "sempre", nada começa antes do "aprovado" do humano', () => {
  const mundo = mundoNovo({ maestro: { aprovarPlano: 'sempre' } });
  iniciar(mundo);
  const parada = operar(mundo, agentes(mundo));
  assert.equal(parada.fim, 'PARE');
  assert.match(parada.texto, /- F1 · backend · parser de vendas\n- F2 · frontend · tela de vendas/);
  assert.match(parada.texto, /Responda "aprovado"/);
  assert.equal(git(mundo.api, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'sem aprovação não há branch');

  // Chamar de novo sem resposta repete o PARE, sem andar.
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: PARE/);
  const corrida = operar(mundo, agentes(mundo), { humano: () => 'aprovado' });
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.match(corrida.texto, /Plano aprovado por você/);
});

test('o maestro confere o executor: formato do resultado, escopo e portões, e devolve o problema', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const vistos = [];
  const corrida = operar(
    mundo,
    agentes(mundo, {
      executar: (pedido, vez, padrao) => {
        if (pedido.repo !== 'backend' || vez > 3) return padrao(pedido, vez);
        vistos.push(pedido);
        if (vez === 1) {
          implementar(mundo, pedido, vez);
          return responder(mundo, pedido, 'Terminei tudo e os testes passam.');
        }
        if (vez === 2) gravar(mundo, 'api/src/outro/util.js', 'exports.util = 1;\n');
        if (vez === 3) {
          destruir(join(mundo.api, 'src', 'outro'));
          gravar(mundo, 'api/src/parsers/vendas.parser.js', 'exports.parseVendas = () => "QUEBRADO";\n');
        }
        return responder(mundo, pedido, '**RESULTADO:** OK\nCOMMIT: `feat: parser de vendas`');
      },
    }),
  );

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const executores = corrida.pedidos.filter((pedido) => pedido.papel === 'executar' && pedido.repo === 'backend');
  assert.equal(executores.length, 4);
  assert.match(problemaDe(mundo, executores[1]), /A primeira linha tem que ser "RESULTADO: ok"/);
  assert.match(executores[1].parametros.Trabalho, /^corrigir, na fatia F1 · parser de vendas/);
  assert.match(problemaDe(mundo, executores[2]), /api\/src\/outro\/util\.js — fora do escopo da fatia/);
  assert.match(problemaDe(mundo, executores[3]), /Os portões reprovaram o que está na pasta/);
  assert.match(problemaDe(mundo, executores[3]), /FALHOU: src\/parsers\/vendas\.parser\.js/);
  assert.deepEqual(commitsDaBranch(mundo.api), ['feat: trabalho 4 do backend'], 'só o que passou em tudo virou commit');
});

test('revisão: parecer incoerente não vale, reprovação volta ao executor e a contestação chega ao revisor seguinte', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const espelhoInventado = ['VEREDITO: APROVADO', 'ACHADOS: 0', 'COMPARAÇÃO:', '- src/parsers/vendas.parser.js ↔ src/parsers/vendas.parser.test.js', '- api/src/parsers/vendas.parser.test.js <-> `src/parsers/estoque.parser.test.js`'];
  const corrida = operar(
    mundo,
    agentes(mundo, {
      revisar: (pedido, vez, padrao) => {
        if (vez === 1) return responder(mundo, pedido, 'VEREDITO: APROVADO\nACHADOS: 0\n\nTudo certo, bom trabalho.');
        if (vez === 2) return responder(mundo, pedido, espelhoInventado.join('\n'));
        if (vez === 3) return responder(mundo, pedido, 'VEREDITO: REPROVADO\nACHADOS: 1\n1. src/parsers/vendas.parser.js:1 — nome fora do padrão — o espelho usa parseEstoque — renomeie');
        return padrao(pedido, vez);
      },
      executar: (pedido, vez, padrao) => {
        if (vez === 2) return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: feat: parser de vendas');
        if (vez === 3) return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: feat: parser de vendas\n\nContesto: achado 1 — o nome segue o espelho (estoque.parser.js:1)');
        return padrao(pedido, vez);
      },
    }),
  );

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const revisoes = corrida.pedidos.filter((pedido) => pedido.papel === 'revisar' && pedido.repo === 'backend');
  const execucoes = corrida.pedidos.filter((pedido) => pedido.papel === 'executar' && pedido.repo === 'backend');
  assert.equal(revisoes.length, 4);
  assert.match(problemaDe(mundo, revisoes[1]), /Falta em COMPARAÇÃO a linha do arquivo novo `src\/parsers\/vendas\.parser\.js`/);
  assert.match(problemaDe(mundo, revisoes[2]), /\(`src\/parsers\/vendas\.parser\.test\.js`\) não existia antes deste trabalho/);
  assert.doesNotMatch(problemaDe(mundo, revisoes[2]), /vendas\.parser\.test\.js`:/, 'o par escrito com a pasta do repositório e com <-> foi aceito');
  assert.ok(execucoes[1].parametros['Achados a corrigir'].includes(revisoes[2].resultado), 'o executor recebe o parecer que reprovou');
  assert.match(problemaDe(mundo, execucoes[2]), /O revisor reprovou e nada mudou/);
  assert.ok(revisoes[3].parametros['Rodada anterior'].includes(revisoes[2].resultado));
  assert.ok(revisoes[3].parametros['Rodada anterior'].includes(execucoes[2].resultado), 'a contestação do autor chega ao revisor seguinte');
});

test('desvio: o executor para, o humano decide, o plano registra e a catraca libera só o aprovado', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const desvio = ['RESULTADO: desvio', 'DESVIO DE PADRÃO — aguardando decisão', 'O que a tarefa exige: um limite configurável', 'Opção B, desvio mínimo: criar src/config/limites.js', 'Recomendo: B'];
  const pares = [];
  const corrida = operar(
    mundo,
    agentes(mundo, {
      executar: (pedido, vez, padrao) => {
        if (vez === 1) return responder(mundo, pedido, desvio.join('\n'));
        if (vez > 2) return padrao(pedido, vez);
        implementar(mundo, pedido, vez);
        gravar(mundo, 'api/src/config/limites.js', 'exports.limite = 10;\n');
        return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: feat: parser de vendas com limite');
      },
      planejar: (pedido, vez, padrao) => {
        if (vez === 1) return padrao(pedido, vez);
        const caminho = pedido.caminhos('Plano')[0];
        const mudado = vez === 2 ? ler(mundo, caminho).replace(BRANCH, 'feature/outra') : ler(mundo, caminho).replace('## Desvios aprovados\n', '## Desvios aprovados\n\n- `api/src/config/limites.js` — configuração nova, aprovada pelo humano\n');
        gravar(mundo, caminho, mudado);
        return responder(mundo, pedido, 'RESULTADO: ok');
      },
    }),
    { humano: (pare) => (pares.push(pare) === 1 ? 'Aprovado o desvio da opção B.' : null) },
  );

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.match(pares[0], /DESVIO DE PADRÃO — aguardando decisão/);
  assert.match(pares[0], /Responda com a sua decisão/);
  const ajustes = corrida.pedidos.filter((pedido) => pedido.papel === 'planejar').slice(1);
  assert.equal(ajustes.length, 2);
  assert.match(ajustes[0].parametros.Motivo, /ajustar o plano à resposta do humano/);
  assert.equal(ajustes[0].parametros['Resposta do humano'], 'Aprovado o desvio da opção B.');
  assert.match(problemaDe(mundo, ajustes[1]), /A linha Branch não pode mudar/);

  const planoFinal = planoDaTarefa(mundo);
  assert.ok(planoFinal.includes(`Branch: \`${BRANCH}\``), 'o ajuste recusado foi desfeito');
  assert.match(planoFinal, /\(desvio\): Aprovado o desvio da opção B\./);
  const retomada = corrida.pedidos.filter((pedido) => pedido.papel === 'executar')[1];
  assert.equal(retomada.parametros['Resposta do humano'], 'Aprovado o desvio da opção B.');
  assert.match(git(mundo.api, 'show', '--stat', '--format=', 'HEAD'), /src\/config\/limites\.js/);
  assert.match(gh(mundo).prs.api[0].body, /Desvios aprovados pelo humano: `api\/src\/config\/limites\.js`/);
  assert.match(corrida.texto, /Desvio registrado como aprovado depois da sua resposta: `api\/src\/config\/limites\.js`/);
});

test('subagente que termina sem gravar o resultado: o maestro espera, tenta de novo e, no limite, chama o humano', () => {
  const mundo = mundoNovo({ maestro: { tentativasPorPasso: 1 } });
  iniciar(mundo);

  // Chamar "proximo" com o passo em aberto é sempre seguro: não gasta tentativa nem abre outro subagente.
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: SUBAGENTE — Escrever o plano \(tentativa 1 de 4\)/);
  for (let i = 0; i < 2; i++) {
    const espera = maestro(mundo, 'proximo').saida;
    assert.match(espera, /AÇÃO: ESPERAR — o passo "Escrever o plano \(tentativa 1 de 4\)" ainda não tem resultado/);
    assert.match(espera, /proximo --sem-resultado/);
    assert.match(espera, /01-plano\.pedido\.md/);
  }
  assert.equal(livro(mundo).tentativas.plano, 1);
  assert.equal(livro(mundo).despachos, 1);

  const pares = [];
  const corrida = operar(
    mundo,
    agentes(mundo, { criticar: (pedido, vez, padrao) => (vez <= 2 ? null : padrao(pedido, vez)) }),
    { humano: (pare) => (pares.push(pare) === 1 ? 'tenta de novo' : null) },
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(corrida.acoes.filter((acao) => acao === 'ESPERAR').length, 3, 'um do planejador e dois do crítico');
  assert.match(pares[0], /O passo "Criticar o plano" não fechou em 2 tentativas/);
  assert.match(pares[0], /terminou sem gravar o arquivo de resultado/);
  const criticos = corrida.pedidos.filter((pedido) => pedido.papel === 'criticar');
  assert.match(problemaDe(mundo, criticos[1]), /terminou sem gravar o arquivo de resultado/);
});

test('QA na tela: a falha vira correção no repositório certo, e o QA roda de novo', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const falhas = ['RESULTADO: falhou', 'CA1: passou — a lista aparece', 'CA2: falhou — onde: frontend — o filtro não refaz a busca', 'EXTRA: falhou — onde: backend — GET /vendas devolve 500 sem período'];
  const corrida = operar(
    mundo,
    agentes(mundo, {
      qa: (pedido, vez, padrao) => {
        if (vez === 1) return responder(mundo, pedido, 'RESULTADO: passou\nCA1: passou — a lista aparece');
        if (vez === 2) return responder(mundo, pedido, falhas.join('\n'));
        return padrao(pedido, vez);
      },
    }),
  );

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const qas = corrida.pedidos.filter((pedido) => pedido.papel === 'qa');
  assert.equal(qas.length, 3);
  assert.match(problemaDe(mundo, qas[1]), /Falta uma linha .* para: CA2/);
  const correcoes = corrida.pedidos.filter((pedido) => pedido.papel === 'executar').slice(2);
  assert.deepEqual(correcoes.map((pedido) => pedido.repo), ['backend', 'frontend'], 'o backend, que já tinha PR, é corrigido e publicado antes');
  assert.match(correcoes[0].parametros.Trabalho, /backend: correção das falhas do QA/);
  assert.ok(correcoes[0].parametros['Achados a corrigir'].includes(qas[1].resultado));
  assert.equal(commitsDaBranch(mundo.api).length, 2);
  assert.equal(git(mundo.api, 'rev-parse', 'HEAD'), git(mundo.api, 'rev-parse', `origin/${BRANCH}`));

  const { prs, chamadas } = gh(mundo);
  assert.equal(prs.api.length, 1, 'a correção sobe para a mesma PR');
  assert.ok(chamadas.some((chamada) => chamada.startsWith('api: pr edit 101')), 'a descrição ganha as provas novas');
  assert.equal(prs.api[0].body.match(/^ {2}- [0-9a-f]{7} /gm).length, 2);
  assert.match(prs.web[0].body, /QA na tela: passou/);
});

test('QA bloqueado, ou deixado para o humano: a entrega segue, com a PR em rascunho e o aviso no relatório', () => {
  const bloqueado = mundoNovo();
  iniciar(bloqueado);
  const corrida = operar(bloqueado, agentes(bloqueado, { qa: (pedido) => responder(bloqueado, pedido, 'RESULTADO: bloqueado\nMOTIVO: não há navegador nesta ferramenta') }));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(gh(bloqueado).prs.web[0].isDraft, true);
  assert.equal(gh(bloqueado).prs.api[0].isDraft, false);
  assert.match(gh(bloqueado).prs.web[0].body, /QA na tela: PENDENTE — não há navegador nesta ferramenta/);
  assert.match(corrida.texto, /PR de frontend: #102 — 1 check verde, em rascunho/);
  assert.match(corrida.texto, /Falta de você: testar na tela \(o QA ficou pendente\) e tirar a PR de rascunho, revisar e fazer o merge/);

  const doHumano = mundoNovo({ maestro: { qa: 'humano' } });
  iniciar(doHumano);
  const semQa = operar(doHumano, agentes(doHumano));
  assert.equal(semQa.fim, 'FIM', semQa.texto);
  assert.ok(!papeis(semQa).includes('qa'));
  assert.match(gh(doHumano).prs.web[0].body, /QA na tela: PENDENTE — o harness está configurado para você testar/);
});

test('checks vermelhos na PR: o resumo volta para um executor, o maestro publica de novo e espera o verde', () => {
  const mundo = mundoNovo();
  const sonar = { name: 'SonarCloud Code Analysis', bucket: 'fail', description: 'Coverage on New Code 62% (required 80%)' };
  mudarGh(mundo, (estado) => {
    estado.checks.api = [{ pendentePor: 2, checks: [{ name: 'ci', bucket: 'pass' }, sonar] }];
  });
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo));

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const correcao = corrida.pedidos.filter((pedido) => pedido.papel === 'executar')[1];
  assert.match(correcao.parametros.Trabalho, /backend: correção dos checks da PR/);
  const resumoDosChecks = problemaDe(mundo, correcao);
  assert.match(resumoDosChecks, /✖ SonarCloud Code Analysis/);
  assert.match(resumoDosChecks, /Coverage on New Code 62%/);
  assert.match(resumoDosChecks, /RESULTADO: REPROVADO — 1 de 2 checks/);
  assert.equal(commitsDaBranch(mundo.api).length, 2, 'a correção é um commit novo, nunca um amend');
  assert.equal(git(mundo.api, 'rev-parse', 'HEAD'), git(mundo.api, 'rev-parse', `origin/${BRANCH}`));
  assert.equal(gh(mundo).prs.api[0].isDraft, false);
  assert.match(corrida.texto, /PR de backend: #101 — 1 check verde, pronta para revisão/);
});

test('PR sem nenhum check: para e pergunta; com exigirChecks desligado pelo humano, segue', () => {
  const mundo = mundoNovo();
  mudarGh(mundo, (estado) => {
    estado.checks.api = [{ checks: [] }];
    estado.checks.web = [{ checks: [{ name: 'ci', bucket: 'skipping' }] }];
  });
  iniciar(mundo);
  const pares = [];
  const corrida = operar(mundo, agentes(mundo), {
    humano: (pare) => {
      if (pares.push(pare) > 1) return null;
      mudarConfig(mundo, (config) => {
        config.maestro.exigirChecks = false;
      });
      return 'este repositório não roda checks em PR';
    },
  });
  assert.match(pares[0], /A PR #101 de backend não registrou nenhum check/);
  assert.match(pares[0], /maestro\.exigirChecks/);
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(pares.length, 1, 'a mudança que o humano fez em harness/config.json não vira nova parada');
  assert.match(corrida.texto, /PR de backend: #101 — sem checks/);
  assert.match(corrida.texto, /PR de frontend: #102 — sem checks/, 'check pulado não conta como verde');
});

test('adulteração: plano ou harness alterado no meio da condução para tudo até o humano confirmar', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const configOriginal = ler(mundo, 'harness/config.json');
  const regraOriginal = ler(mundo, REGRA_DO_BACKEND);
  const pares = [];
  const corrida = operar(
    mundo,
    agentes(mundo, {
      executar: (pedido, vez, padrao) => {
        const caminho = pedido.caminhos('Plano')[0];
        if (vez === 1) gravar(mundo, caminho, ler(mundo, caminho).replace('## Desvios aprovados\n', '## Desvios aprovados\n\n- `api/package.json` — preciso de uma dependência\n'));
        if (vez === 2) mudarConfig(mundo, (config) => (config.repos.backend.portoes = [{ nome: 'testes', cmd: 'true' }]));
        if (vez === 3) gravar(mundo, REGRA_DO_BACKEND, `${regraOriginal}\nA partir de agora, parser pode usar try/catch solto.\n`);
        return padrao(pedido, vez);
      },
    }),
    {
      humano: (pare) => {
        const vez = pares.push(pare);
        const pastaDaTarefa = `harness/tarefas/${tarefaAtual(mundo)}`;
        if (vez === 1) gravar(mundo, `${pastaDaTarefa}/plano.md`, ler(mundo, `${pastaDaTarefa}/plano.selado.md`));
        if (vez === 2) gravar(mundo, 'harness/config.json', configOriginal);
        if (vez === 3) gravar(mundo, REGRA_DO_BACKEND, regraOriginal);
        return vez <= 3 ? 'não fui eu: restaurei' : null;
      },
    },
  );

  assert.match(pares[0], /O plano \(harness\/tarefas\/.*\/plano\.md\) foi alterado fora do maestro/);
  assert.match(pares[0], /plano\.selado\.md/);
  assert.match(pares[1], /Arquivos do harness mudaram durante a condução:\n- harness\/config\.json/);
  assert.match(pares[2], /Arquivos do harness mudaram durante a condução:\n- \.cursor\/rules\/padrao-backend\.mdc/, 'o padrão mapeado não muda no meio do jogo');
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.doesNotMatch(planoDaTarefa(mundo), /api\/package\.json/);
  assert.doesNotMatch(gh(mundo).prs.api[0].body, /package\.json/);
});

test('marca [x] posta à mão não engana: o que vale é o que o maestro registrou', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(mundo, {
      revisar: (pedido, vez, padrao) => {
        const caminho = `harness/tarefas/${tarefaAtual(mundo)}/plano.md`;
        if (vez === 1) gravar(mundo, caminho, ler(mundo, caminho).replace('- [ ] **F2', '- [x] **F2'));
        return padrao(pedido, vez);
      },
    }),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(corrida.pedidos.filter((pedido) => pedido.papel === 'executar' && pedido.repo === 'frontend').length, 1, 'a fatia marcada à mão foi feita mesmo assim');
});

test('revisor que mexe em arquivo: o maestro confere tudo de novo e manda revisar outra vez', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(mundo, {
      revisar: (pedido, vez, padrao) => {
        if (vez === 1) gravar(mundo, 'api/src/parsers/vendas.parser.js', `${ler(mundo, 'api/src/parsers/vendas.parser.js')}exports.extra = "QUEBRADO";\n`);
        return padrao(pedido, vez);
      },
    }),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const doBackend = corrida.pedidos.filter((pedido) => pedido.repo === 'backend').map((pedido) => pedido.papel);
  assert.deepEqual(doBackend, ['executar', 'revisar', 'executar', 'revisar', 'descrever'], 'o que o revisor mexeu passou por portões, executor e nova revisão');
  assert.ok(livro(mundo).diario.some((item) => /a pasta mudou durante a revisão/.test(item.linha)));
  assert.doesNotMatch(ler(mundo, 'api/src/parsers/vendas.parser.js'), /QUEBRADO/);
});

test('commit recusado pelo hook do repositório volta para o executor com a saída do hook', () => {
  const mundo = mundoNovo();
  const ganchos = join(mundo.api, '.git', 'hooks', 'commit-msg');
  writeFileSync(ganchos, '#!/bin/sh\ngrep -q "^feat: " "$1" || { echo "commitlint: a mensagem precisa começar com feat:" >&2; exit 1; }\n', { mode: 0o755 });
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(mundo, {
      executar: (pedido, vez, padrao) => {
        if (vez > 1) return padrao(pedido, vez);
        implementar(mundo, pedido, vez);
        return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: parser de vendas adicionado');
      },
    }, { planoDoCenario: plano({ fatias: [F1] }) }),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const segundo = corrida.pedidos.filter((pedido) => pedido.papel === 'executar')[1];
  assert.match(problemaDe(mundo, segundo), /O commit foi recusado pelos hooks do repositório/);
  assert.match(problemaDe(mundo, segundo), /commitlint: a mensagem precisa começar com feat:/);
  assert.deepEqual(commitsDaBranch(mundo.api), ['feat: trabalho 2 do backend']);
});

test('duas fatias no mesmo repositório: o conjunto é revisado antes da PR, e a correção volta para revisão', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const rota = fatia('F2', 'backend', 'rota de vendas', '`src/routes/`', '`src/routes/index.js`');
  const doConjunto = (pedido) => /\.\.\.HEAD/.test(pedido.parametros['Comando do diff']);
  let conjuntos = 0;
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        executar: (pedido, vez, padrao) => {
          if (vez !== 2) return padrao(pedido, vez);
          gravar(mundo, 'api/src/routes/vendas.js', "exports.rota = '/vendas';\n");
          gravar(mundo, 'api/src/routes/vendas.test.js', "require('./vendas');\n");
          return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: feat: rota de vendas');
        },
        revisar: (pedido, vez, padrao) => {
          if (!doConjunto(pedido) || ++conjuntos > 1) return padrao(pedido, vez);
          return responder(mundo, pedido, 'VEREDITO: REPROVADO\nACHADOS: 1\n1. src/routes/vendas.js:1 — a rota repete uma constante que o parser já exporta — reuse');
        },
      },
      { planoDoCenario: plano({ fatias: [F1, rota] }) },
    ),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(papeis(corrida), ['planejar', 'criticar', 'executar', 'revisar', 'executar', 'revisar', 'revisar', 'executar', 'revisar', 'revisar', 'descrever']);
  const correcao = corrida.pedidos.filter((pedido) => pedido.papel === 'executar')[2];
  assert.match(correcao.parametros.Trabalho, /backend: correção da revisão do conjunto/);
  assert.match(correcao.parametros.Escopo, /`src\/parsers\/`, `src\/routes\/index\.js`, `src\/routes\/`/, 'a correção pode tocar o escopo de todas as fatias do repositório');
  assert.equal(commitsDaBranch(mundo.api).length, 3);
  assert.equal(gh(mundo).prs.web, undefined, 'repositório fora do plano não ganha PR');
});

test('portão demorado atravessa várias chamadas curtas, e trava de chamada morta não segura a condução', () => {
  const mundo = mundoNovo({
    maestro: { esperaPorChamadaSeg: 0.3 },
    config: (config) => {
      config.repos.backend.portoes = [{ nome: 'testes', cmd: 'node -e "setTimeout(() => {}, 1500)" && node conferir.js' }];
    },
  });
  iniciar(mundo);
  const trava = join(mundo.raiz, 'harness', 'tarefas', tarefaAtual(mundo), 'maestro.trava');

  writeFileSync(trava, JSON.stringify({ pid: process.pid, quando: Date.now() }));
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: REPETIR — outra chamada do maestro ainda está rodando/);
  assert.equal(livro(mundo).chamadas, 0);
  writeFileSync(trava, JSON.stringify({ pid: 2 ** 22 + 12345, quando: Date.now() }));

  const corrida = operar(mundo, agentes(mundo, {}, { planoDoCenario: plano({ fatias: [F1] }) }));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(corrida.acoes.filter((acao) => acao === 'REPETIR').length >= 2, `esperava várias chamadas de espera: ${corrida.acoes.join(' ')}`);
  assert.ok(!existsSync(trava));
});

test('ambiente: sem gh autenticado, ou sem alcançar o remoto, a condução para antes de gastar trabalho', () => {
  const mundo = mundoNovo();
  mudarGh(mundo, (estado) => {
    estado.autenticado = false;
  });
  const remotoCerto = git(mundo.api, 'remote', 'get-url', 'origin');
  git(mundo.api, 'remote', 'set-url', 'origin', join(mundo.pasta, 'nao-existe.git'));
  iniciar(mundo);
  const pares = [];
  const corrida = operar(mundo, agentes(mundo), {
    humano: (pare) => {
      const vez = pares.push(pare);
      if (vez === 1) mudarGh(mundo, (estado) => (estado.autenticado = true));
      if (vez === 2) git(mundo.api, 'remote', 'set-url', 'origin', remotoCerto);
      return vez <= 2 ? 'feito' : null;
    },
  });
  assert.equal(corrida.acoes[0], 'PARE', 'antes de qualquer subagente');
  assert.match(pares[0], /O gh não está autenticado, ou o terminal do agente não alcança o GitHub/);
  assert.match(pares[0], /allowlist/);
  assert.match(pares[1], /Não consegui falar com o remoto "origin"/);
  assert.equal(corrida.pedidos.filter((pedido) => pedido.papel === 'executar').length, 2, 'nenhum executor rodou antes de o remoto responder');
  assert.equal(corrida.fim, 'FIM', corrida.texto);
});

test('repositório ainda não mapeado: o plano não segue enquanto o /mapear não roda', () => {
  const mundo = mundoNovo();
  const regra = '.cursor/rules/padrao-frontend.mdc';
  const mapeada = ler(mundo, regra);
  gravar(mundo, regra, `${mapeada}\nNÃO MAPEADO\n`);
  iniciar(mundo);
  const pares = [];
  const corrida = operar(mundo, agentes(mundo), {
    humano: (pare) => {
      if (pares.push(pare) > 1) return null;
      gravar(mundo, regra, mapeada);
      return 'mapeei o frontend';
    },
  });
  assert.match(pares[0], /frontend: o padrão não está mapeado \(rode \/mapear frontend\)/);
  assert.equal(corrida.fim, 'FIM', corrida.texto);
});

test('plano aprovado à mão (pelo /planejar): o /entregar adota e conduz daí', () => {
  const mundo = mundoNovo();
  gravar(mundo, 'harness/tarefas/PARC-9-manual/plano.md', plano({ status: 'aprovado', fatias: [F1] }));
  gravar(mundo, 'harness/tarefas/ATUAL', 'PARC-9-manual\n');
  const corrida = operar(mundo, agentes(mundo));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(papeis(corrida), ['executar', 'revisar', 'descrever']);
  assert.match(corrida.texto, /Plano escrito e aprovado por você antes da condução/);
});

test('iniciar dá nome à tarefa, recusa começar sem texto ou por cima de outra condução; encerrar larga', () => {
  const mundo = mundoNovo();
  const semTexto = maestro(mundo, 'iniciar');
  assert.equal(semTexto.codigo, 2);
  assert.match(semTexto.erro, /harness\/tarefas\/ENTRADA\.md/);

  assert.match(iniciar(mundo, 'Corrigir o arredondamento do total no parser de estoque').saida, /Condução de \d{4}-\d\d-\d\d-corrigir-arredondamento-total-parser iniciada/);
  assert.ok(!existe(mundo, 'harness/tarefas/ENTRADA.md'), 'o texto da tarefa foi para a pasta dela');
  assert.match(ler(mundo, `harness/tarefas/${tarefaAtual(mundo)}/tarefa.md`), /arredondamento/);

  gravar(mundo, 'harness/tarefas/ENTRADA.md', 'outra tarefa');
  const porCima = maestro(mundo, 'iniciar');
  assert.equal(porCima.codigo, 2);
  assert.match(porCima.erro, /Já existe uma condução aberta/);

  assert.match(maestro(mundo, 'encerrar').saida, /largada/);
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: FIM/);
  assert.match(iniciar(mundo, 'PARC-77 mostrar o total na tela').saida, /Condução de PARC-77-mostrar-total-tela iniciada/);
  assert.match(maestro(mundo, 'estado').saida, /MAESTRO · PARC-77-mostrar-total-tela · plano · 0 chamadas/);
  assert.equal(maestro(mundo, 'validar-plano').codigo, 2, 'ainda não há plano para validar');
});

test('durante a condução: a guarda reserva git e PR ao maestro, e o hook de fim de turno mantém o operador andando', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const noCursor = (command, cwd = mundo.raiz) => ({ conversation_id: 'operador-1', command, cwd });
  const noClaude = (command, extra = {}) => ({ session_id: 'operador-1', tool_name: 'Bash', tool_input: { command }, cwd: mundo.raiz, ...extra });
  const fimDeTurno = (conversa) => hook(mundo, 'parar', 'cursor', { conversation_id: conversa, status: 'completed', loop_count: 3 });
  const conversaDeFora = `conversa-de-fora-${process.pid}-${Date.now()}`;

  // O operador roda o maestro: o hook de shell anota a conversa dele e não pede confirmação.
  assert.deepEqual(hook(mundo, 'shell', 'cursor', noCursor('node harness/bin/maestro.mjs proximo')), { permission: 'allow' });
  assert.equal(hook(mundo, 'shell', 'claude', noClaude('node harness/bin/maestro.mjs proximo')).hookSpecificOutput.permissionDecision, 'allow');
  assert.deepEqual(hook(mundo, 'shell', 'claude', noClaude('node harness/bin/maestro.mjs proximo && rm -rf x')), {}, 'comando encadeado segue o fluxo normal de permissão');
  const despacho = maestro(mundo, 'proximo');

  // Parou sem abrir o subagente: um empurrão só, com o texto a repassar. Outra conversa não é empurrada.
  const abrir = fimDeTurno('operador-1').followup_message;
  assert.match(abrir, /você parou com o passo "Escrever o plano/);
  assert.match(abrir, /01-plano\.pedido\.md/);
  assert.equal(fimDeTurno('operador-1').followup_message, abrir, 'o mesmo evento vindo de duas fontes de hook recebe a mesma resposta');
  const memoria = join(mundo.raiz, 'harness', '.maestro', 'operador.json');
  const lembranca = JSON.parse(readFileSync(memoria, 'utf8'));
  writeFileSync(memoria, JSON.stringify({ ...lembranca, empurrao: { ...lembranca.empurrao, quando: lembranca.empurrao.quando - 60000 } }));
  assert.deepEqual(fimDeTurno('operador-1'), {}, 'com o passo em aberto, o empurrão acontece uma vez só');
  assert.deepEqual(fimDeTurno('outra-conversa'), {});

  // O subagente terminou e o operador parou sem rodar o maestro: empurrão para seguir.
  agentes(mundo).planejar(lerPedido(mundo, despacho.saida));
  const seguir = hook(mundo, 'parar', 'claude', { session_id: 'operador-1', stop_hook_active: true });
  assert.equal(seguir.decision, 'block');
  assert.match(seguir.reason, /Rode agora `node harness\/bin\/maestro\.mjs proximo`/);

  // Git e PR são do maestro; ler continua livre; subagente não conduz.
  const commit = hook(mundo, 'shell', 'cursor', noCursor('git commit -m "feat: x"', mundo.api));
  assert.equal(commit.permission, 'deny');
  assert.match(commit.agent_message, /so-o-maestro/);
  assert.equal(hook(mundo, 'shell', 'cursor', noCursor('gh pr create --title x --body y', mundo.api)).permission, 'deny');
  assert.equal(hook(mundo, 'shell', 'cursor', noCursor('git stash', mundo.api)).permission, 'deny');
  assert.equal(hook(mundo, 'shell', 'cursor', noCursor('git checkout -- .', mundo.api)).permission, 'deny', 'ninguém confirma comando no meio da condução');
  assert.deepEqual(hook(mundo, 'shell', 'cursor', noCursor('git diff --cached', mundo.api)), { permission: 'allow' });
  const subagente = hook(mundo, 'shell', 'claude', noClaude('node harness/bin/maestro.mjs proximo', { agent_id: 'sub-1' })).hookSpecificOutput;
  assert.equal(subagente.permissionDecision, 'deny');
  assert.match(subagente.permissionDecisionReason, /Só a conversa principal conduz o maestro/);
  assert.deepEqual(hook(mundo, 'shell', 'claude', noClaude('node harness/bin/maestro.mjs validar-plano', { agent_id: 'sub-1' })).hookSpecificOutput.permissionDecision, 'allow');

  // A catraca do diff não cobra durante a condução (quem confere é o maestro), e volta quando ela acaba.
  gravar(mundo, 'api/src/parsers/estoque.parser.js', '// eslint-disable-next-line\nexports.parseEstoque = () => null;\n');
  assert.deepEqual(fimDeTurno(conversaDeFora), {});
  // Condução largada há horas não cala a catraca de quem voltou a trabalhar à mão.
  const caminhoDoLivro = `harness/tarefas/${tarefaAtual(mundo)}/maestro.json`;
  const recente = ler(mundo, caminhoDoLivro);
  gravar(mundo, caminhoDoLivro, JSON.stringify({ ...JSON.parse(recente), ultimaChamada: Date.now() - 3 * 60 * 60 * 1000 }));
  assert.match(fimDeTurno(`${conversaDeFora}-b`).followup_message, /CATRACA DO HARNESS/);
  gravar(mundo, caminhoDoLivro, recente);
  maestro(mundo, 'encerrar');
  assert.match(fimDeTurno(conversaDeFora).followup_message, /CATRACA DO HARNESS/);
  assert.deepEqual(hook(mundo, 'shell', 'cursor', noCursor('git stash', mundo.api)), { permission: 'allow' }, 'sem condução, o git volta a ser de quem está na conversa');
  assert.match(hook(mundo, 'compactar', 'cursor', {}).user_message, /conversa nova/);
});

test('prova final antes de publicar: bloqueio que já estava na branch volta para correção', () => {
  const mundo = mundoNovo();
  git(mundo.api, 'checkout', '-q', '-b', BRANCH);
  const antigo = ler(mundo, 'api/src/parsers/estoque.parser.js');
  gravar(mundo, 'api/src/parsers/estoque.parser.js', `// eslint-disable-next-line\n${antigo}`);
  git(mundo.api, 'commit', '-q', '-am', 'chore: commit antigo com atalho');
  gravar(mundo, 'harness/tarefas/PARC-9-manual/plano.md', plano({ status: 'aprovado', fatias: [F1] }));
  gravar(mundo, 'harness/tarefas/ATUAL', 'PARC-9-manual\n');

  const corrida = operar(
    mundo,
    agentes(mundo, {
      executar: (pedido, vez, padrao) => {
        if (vez === 2) gravar(mundo, 'api/src/parsers/estoque.parser.js', antigo);
        return padrao(pedido, vez);
      },
    }),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const correcao = corrida.pedidos.filter((pedido) => pedido.papel === 'executar')[1];
  assert.match(correcao.parametros.Trabalho, /backend: correção da prova final/);
  assert.match(problemaDe(mundo, correcao), /A branch inteira tem bloqueios da catraca:\n- \[BLOQUEIO\] api\/src\/parsers\/estoque\.parser\.js:1 — desliga o lint/);
  assert.equal(gh(mundo).prs.api.length, 1, 'a PR só abre depois da prova final');
});

test('PR: conflito com a base para e pergunta; PR antiga já incorporada dá lugar a uma nova', () => {
  const mundo = mundoNovo();
  mudarGh(mundo, (estado) => {
    estado.prs.api = [{ number: 77, url: 'https://github.example/api/pull/77', branch: BRANCH, state: 'MERGED', isDraft: false, headRefOid: 'abc123' }];
  });
  iniciar(mundo);
  const pares = [];
  const corrida = operar(mundo, agentes(mundo, {}, { planoDoCenario: plano({ fatias: [F1] }) }), {
    humano: (pare) => {
      if (pares.push(pare) > 1) return null;
      mudarGh(mundo, (estado) => (estado.prs.api[1].mergeable = 'MERGEABLE'));
      return 'resolvi o conflito';
    },
    limite: 40,
  });
  assert.equal(pares.length, 0, 'sem conflito marcado, não há parada');
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(gh(mundo).prs.api.map((pr) => [pr.number, pr.state]), [[77, 'MERGED'], [101, 'OPEN']]);

  const comConflito = mundoNovo();
  iniciar(comConflito);
  const paradas = [];
  const segunda = operar(
    comConflito,
    agentes(
      comConflito,
      {
        descrever: (pedido, vez, padrao) => {
          padrao(pedido, vez);
          // O conflito aparece no GitHub depois que a PR existe: o gh falso passa a responder CONFLICTING.
          mudarGh(comConflito, (estado) => (estado.conflitoAoCriar = true));
        },
      },
      { planoDoCenario: plano({ fatias: [F1] }) },
    ),
    {
      humano: (pare) => {
        if (paradas.push(pare) > 1) return null;
        mudarGh(comConflito, (estado) => {
          estado.conflitoAoCriar = false;
          estado.prs.api[0].mergeable = 'MERGEABLE';
        });
        return 'resolvi o conflito';
      },
    },
  );
  assert.match(paradas[0], /A PR #101 de backend tem conflito com a branch base\. O maestro não faz merge nem rebase/);
  assert.equal(segunda.fim, 'FIM', segunda.texto);
});

test('limites: plano grande espera o humano, checks que não terminam também, e condução em laço para', () => {
  const grande = mundoNovo({ maestro: { maximoDeFatias: 1 } });
  iniciar(grande);
  const parada = operar(grande, agentes(grande));
  assert.equal(parada.fim, 'PARE');
  assert.match(parada.texto, /O plano tem 2 fatias\. Acima de 1, o maestro pede o seu olhar/);

  const lento = mundoNovo({ maestro: { esperaDeChecksMin: 0 } });
  mudarGh(lento, (estado) => (estado.checks.api = [{ pendentePor: 100000, checks: [{ name: 'ci', bucket: 'pass' }] }]));
  iniciar(lento);
  const esperando = operar(lento, agentes(lento, {}, { planoDoCenario: plano({ fatias: [F1] }) }));
  assert.equal(esperando.fim, 'PARE');
  assert.match(esperando.texto, /Os checks da PR #101 de backend ainda estão rodando depois de 0 min\. Responda quando quiser/);

  const emLaco = mundoNovo({ maestro: { maximoDeDespachos: 3 } });
  iniciar(emLaco);
  const cortada = operar(emLaco, agentes(emLaco));
  assert.equal(cortada.fim, 'PARE');
  assert.match(cortada.texto, /Esta condução já abriu 3 subagentes/);
  assert.equal(cortada.pedidos.length, 3);
});

test('desvio previsto no plano: o "aprovado" do humano vira registro em "Desvios aprovados" por um planejador', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const pendente = 'DESVIO DE PADRÃO — aguardando decisão\nO que a tarefa exige: arquivo de limites\nOpção B, desvio mínimo: criar `src/config/limites.js`\nRecomendo: B';
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        planejar: (pedido, vez, padrao) => {
          if (vez === 1) return padrao(pedido, vez);
          const caminho = pedido.caminhos('Plano')[0];
          const semPendente = ler(mundo, caminho).replace(pendente, '').replace('## Desvios aprovados\n', '## Desvios aprovados\n\n- `api/src/config/limites.js` — limites, aprovado pelo humano\n');
          gravar(mundo, caminho, semPendente);
          return responder(mundo, pedido, 'RESULTADO: ok');
        },
      },
      { planoDoCenario: plano({ fatias: [F1], pendentes: pendente }) },
    ),
    { humano: (pare, vez) => (vez === 1 ? 'aprovado' : null) },
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const ajuste = corrida.pedidos.filter((pedido) => pedido.papel === 'planejar')[1];
  assert.match(ajuste.parametros['Resposta do humano'], /os desvios que estavam em "Desvios pendentes" foram aprovados como propostos/);
  assert.match(corrida.texto, /Plano aprovado por você/);
  assert.match(corrida.texto, /Desvio registrado como aprovado depois da sua resposta: `api\/src\/config\/limites\.js`/);
});

test('executor que faz o próprio commit, ou troca de branch: o maestro revisa o que entrou, ou para', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        executar: (pedido, vez, padrao) => {
          padrao(pedido, vez);
          git(mundo.api, 'add', '-A');
          git(mundo.api, 'commit', '-q', '-m', 'feat: commit feito pelo executor');
        },
      },
      { planoDoCenario: plano({ fatias: [F1] }) },
    ),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(papeis(corrida), ['planejar', 'criticar', 'executar', 'revisar', 'descrever'], 'o commit adiantado passou pela revisão do mesmo jeito');
  const revisao = corrida.pedidos.find((pedido) => pedido.papel === 'revisar');
  assert.match(revisao.parametros['Arquivos novos'], /vendas\.parser\.js/);
  assert.deepEqual(commitsDaBranch(mundo.api), ['feat: commit feito pelo executor']);

  const fujao = mundoNovo();
  iniciar(fujao);
  const parada = operar(
    fujao,
    agentes(
      fujao,
      {
        executar: (pedido, vez, padrao) => {
          padrao(pedido, vez);
          git(fujao.api, 'stash', '-q', '-u');
          git(fujao.api, 'checkout', '-q', 'main');
          git(fujao.api, 'stash', 'pop', '-q');
        },
      },
      { planoDoCenario: plano({ fatias: [F1] }) },
    ),
  );
  assert.equal(parada.fim, 'PARE');
  assert.match(parada.texto, /O repositório backend saiu da branch feature\/PARC-482-parser-vendas durante "F1 · parser de vendas"/);
});

test('validar-plano mostra ao planejador os erros do plano da tarefa atual', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const caminho = `harness/tarefas/${tarefaAtual(mundo)}/plano.md`;
  gravar(mundo, caminho, plano().replace('- [ ] **F2 · frontend · tela de vendas**', '- [ ] **F3 · frontend · tela de vendas**'));
  const comErro = maestro(mundo, 'validar-plano');
  assert.equal(comErro.codigo, 1);
  assert.match(comErro.saida, /O plano tem 1 erro\(s\):\n- A 2ª fatia deveria se chamar F2, não F3/);
  gravar(mundo, caminho, plano());
  assert.match(maestro(mundo, 'validar-plano').saida, /^plano válido/);
});

test('serviço em segundo plano: termina dentro do prazo, atravessa chamadas, ou é dado como interrompido', async () => {
  const mundo = mundoNovo();
  const acoes = await import(`file://${join(mundo.raiz, 'harness', 'bin', 'acoes.mjs')}`);
  const node = (codigo) => ({ programa: process.execPath, args: ['-e', codigo], pasta: mundo.raiz, tempoMaximoMs: 20000 });

  const rapido = acoes.servico('rapido', node('console.log("pronto"); process.exit(3)'), Date.now() + 5000);
  assert.deepEqual([rapido.estado, rapido.codigo, rapido.saida], ['terminou', 3, 'pronto']);

  const demorado = node('setTimeout(() => console.log("acabou"), 900)');
  assert.equal(acoes.servico('demorado', demorado, Date.now() + 100).estado, 'rodando');
  assert.equal(acoes.servico('demorado', demorado, Date.now() + 100).estado, 'rodando', 'a segunda chamada reencontra o mesmo serviço, não abre outro');
  const fim = acoes.servico('demorado', demorado, Date.now() + 5000);
  assert.deepEqual([fim.estado, fim.codigo, fim.saida], ['terminou', 0, 'acabou']);

  gravar(mundo, 'harness/.maestro/morto.json', JSON.stringify({ programa: 'x', args: [], pid: 2 ** 22 + 4321, inicio: Date.now() }));
  assert.equal(acoes.servico('morto', demorado, Date.now() + 1000).estado, 'interrompido');
  assert.ok(!existe(mundo, 'harness/.maestro/morto.json'));
});

test('entrar na branch: usa a do GitHub quando existe, avança a local atrasada e recusa as que se separaram', async () => {
  const mundo = mundoNovo();
  const acoes = await import(`file://${join(mundo.raiz, 'harness', 'bin', 'acoes.mjs')}`);
  const entrar = (nome) => acoes.entrarNaBranch(mundo.api, BRANCH, 'main', nome, Date.now() + 8000);
  const commitNoRemoto = (arquivo) => {
    const outro = join(mundo.pasta, `clone-${arquivo}`);
    git(mundo.pasta, 'clone', '-q', git(mundo.api, 'remote', 'get-url', 'origin'), outro);
    git(outro, 'checkout', '-q', '-B', BRANCH, `origin/${BRANCH}`);
    writeFileSync(join(outro, arquivo), 'x\n');
    git(outro, 'add', '-A');
    git(outro, 'commit', '-q', '-m', `remoto: ${arquivo}`);
    git(outro, 'push', '-q', 'origin', BRANCH);
  };

  // A branch ainda não existe em lugar nenhum: nasce da base, sem upstream (não mexe em .git/config).
  assert.deepEqual(entrar('busca-1'), { estado: 'ok' });
  assert.equal(git(mundo.api, 'rev-parse', '--abbrev-ref', 'HEAD'), BRANCH);
  assert.equal(git(mundo.api, 'rev-parse', 'HEAD'), git(mundo.api, 'rev-parse', 'origin/main'));
  assert.throws(() => git(mundo.api, 'rev-parse', '--abbrev-ref', `${BRANCH}@{upstream}`));

  // Alguém publicou commits nessa branch: a local, atrasada, avança sem merge.
  git(mundo.api, 'push', '-q', 'origin', BRANCH);
  commitNoRemoto('a.txt');
  git(mundo.api, 'checkout', '-q', 'main');
  assert.deepEqual(entrar('busca-2'), { estado: 'ok' });
  assert.equal(git(mundo.api, 'log', '-1', '--format=%s'), 'remoto: a.txt');

  // A local e a do GitHub seguiram caminhos diferentes: é caso para o humano.
  commitNoRemoto('b.txt');
  writeFileSync(join(mundo.api, 'local.txt'), 'y\n');
  git(mundo.api, 'add', '-A');
  git(mundo.api, 'commit', '-q', '-m', 'local');
  git(mundo.api, 'checkout', '-q', 'main');
  const separadas = entrar('busca-3');
  assert.equal(separadas.estado, 'erro');
  assert.match(separadas.erro, /seguiram caminhos diferentes/);

  // Árvore suja: o maestro não troca de branch por cima de trabalho sem commit.
  git(mundo.api, 'checkout', '-q', 'main');
  writeFileSync(join(mundo.api, 'solto.txt'), 'z\n');
  assert.match(entrar('busca-4').erro, /Há mudanças sem commit/);
});

test('a resposta a um PARE é do humano: o operador não retoma no turno em que o PARE apareceu, nem larga a condução sozinho', () => {
  const mundo = mundoNovo({ maestro: { aprovarPlano: 'sempre' } });
  iniciar(mundo);
  const RETOMAR = 'node harness/bin/maestro.mjs retomar';
  const noCursor = (turno, command) => hook(mundo, 'shell', 'cursor', { conversation_id: 'c1', generation_id: turno, command, cwd: mundo.raiz });
  const noClaude = (turno, command) => hook(mundo, 'shell', 'claude', { session_id: 'c2', prompt_id: turno, tool_name: 'Bash', tool_input: { command }, cwd: mundo.raiz });
  const proximo = (turno) => {
    assert.deepEqual(noCursor(turno, 'node harness/bin/maestro.mjs proximo'), { permission: 'allow' });
    return maestro(mundo, 'proximo').saida;
  };

  // Turno 1: do plano até o PARE que pede a aprovação.
  const subagentes = agentes(mundo);
  let saida = proximo('t1');
  while (/AÇÃO: SUBAGENTE/.test(saida)) {
    const pedido = lerPedido(mundo, saida);
    subagentes[pedido.papel](pedido);
    saida = proximo('t1');
  }
  assert.match(saida, /AÇÃO: PARE/);

  // O operador escreve a resposta sozinho e tenta retomar no mesmo turno: barrado, mesmo insistindo.
  gravar(mundo, 'harness/tarefas/RESPOSTA.md', 'aprovado');
  const sozinho = noCursor('t1', RETOMAR);
  assert.equal(sozinho.permission, 'deny');
  assert.match(sozinho.agent_message, /resposta-do-humano/);
  proximo('t1');
  assert.equal(noCursor('t1', RETOMAR).permission, 'deny');

  // Numa conversa nova o PARE ainda não foi mostrado ao humano: vale a mesma regra, turno a turno.
  noClaude('p1', 'node harness/bin/maestro.mjs proximo');
  maestro(mundo, 'proximo');
  assert.equal(noClaude('p1', RETOMAR).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(noClaude('p2', RETOMAR).hookSpecificOutput.permissionDecision, 'allow');

  // O humano respondeu na primeira conversa: turno novo. Mesmo rodando "proximo" antes, o retomar passa.
  proximo('t2');
  assert.deepEqual(noCursor('t2', RETOMAR), { permission: 'allow' });
  assert.match(maestro(mundo, 'retomar').saida, /Resposta registrada/);

  // Largar a condução pede a confirmação do humano; onde não há como perguntar, bloqueia.
  const largar = noCursor('t2', 'node harness/bin/maestro.mjs encerrar');
  assert.equal(largar.permission, 'ask');
  assert.match(largar.user_message, /Largar a condução do \/entregar é decisão do humano\. Confirma\?/);
  const noCodex = hook(mundo, 'shell', 'codex', { session_id: 'c3', tool_name: 'shell', tool_input: { command: 'node harness/bin/maestro.mjs encerrar' }, cwd: mundo.raiz });
  assert.equal(noCodex.hookSpecificOutput.permissionDecision, 'deny');
});

test('executor que mexe no repositório vizinho: o maestro percebe e manda desfazer', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const original = ler(mundo, 'web/src/telas/Estoque.jsx');
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        executar: (pedido, vez, padrao) => {
          gravar(mundo, 'web/src/telas/Estoque.jsx', vez === 1 ? `${original}// ajuste de passagem\n` : original);
          return padrao(pedido, vez);
        },
      },
      { planoDoCenario: plano({ fatias: [F1] }) },
    ),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const segundo = corrida.pedidos.filter((pedido) => pedido.papel === 'executar')[1];
  assert.match(problemaDe(mundo, segundo), /Mudaram arquivos em web\/, que não é o repositório deste trabalho/);
  assert.equal(git(mundo.web, 'status', '--porcelain'), '');
});

test('erro que o maestro não sabe tratar chega ao operador como parada, não como silêncio', () => {
  const mundo = mundoNovo();
  const semConducao = maestro(mundo, 'proximo');
  assert.equal(semConducao.codigo, 2);
  assert.match(semConducao.saida, /AÇÃO: PARE\n.*\n===\nO maestro não conseguiu rodar: Não há condução aberta/);

  iniciar(mundo);
  gravar(mundo, `harness/tarefas/${tarefaAtual(mundo)}/maestro.json`, '{ isto não é json');
  const quebrado = maestro(mundo, 'proximo');
  assert.equal(quebrado.codigo, 2);
  assert.match(quebrado.saida, /AÇÃO: PARE/);
  assert.match(quebrado.saida, /O maestro não conseguiu rodar: maestro: erro inesperado/);
});
