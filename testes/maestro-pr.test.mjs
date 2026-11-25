// node --test testes/*.test.mjs
// A segunda metade de uma entrega, no mesmo mundo de mentira de maestro.test.mjs: a revisão da PR
// linha por linha, o QA na tela, a publicação, os checks, os poucos bloqueios que sobraram e os
// comandos e hooks que seguram a condução no trilho.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  agentes, BRANCH, CAMINHO_DO_LIVRO, commitsDaBranch, criarMolde, destruir, dos, existe, F1, fatia, gh, git, gravar, hook, iniciar, ler, lerPedido, livro,
  maestro, mudarGh, mudarLivro, novoMundo, operar, papeis, plano, problemaDe, REPROVADO, responder,
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

const soBackend = { planoDoCenario: plano({ fatias: [F1] }) };
const ROTA = fatia('F2', 'backend', 'rota de vendas', '`src/routes/`', '`src/routes/index.js`');
const duasNoBackend = { planoDoCenario: plano({ fatias: [F1, ROTA] }) };
// O executor de mentira que entrega a segunda fatia do backend (a rota).
function comRota(mundo, extras = {}) {
  return {
    executar: (pedido, vez, padrao) => {
      if (vez !== 2) return (extras.executar ?? ((p, v, fazer) => fazer(p, v)))(pedido, vez, padrao);
      gravar(mundo, 'api/src/routes/vendas.js', "exports.rota = '/vendas';\n");
      gravar(mundo, 'api/src/routes/vendas.test.js', "require('./vendas');\n");
      return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: feat: sales route\n\nFeito: a rota de vendas.');
    },
    ...Object.fromEntries(Object.entries(extras).filter(([papel]) => papel !== 'executar')),
  };
}

// ------------------------------------------------------------------ revisão linha por linha

test('duas fatias no mesmo repositório: a PR é lida linha por linha, e o que o revisor aponta vira um commit de ajuste', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(mundo, comRota(mundo, { revisarPr: (pedido) => responder(mundo, pedido, REPROVADO('src/routes/vendas.js:1 — a rota repete uma constante que o parser já exporta — reuso — importe do parser')) }), duasNoBackend),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(papeis(corrida), ['reconhecer', 'planejar', 'criticar', 'executar', 'revisar', 'executar', 'revisar', 'revisarPr', 'executar', 'revisar', 'descrever']);

  const leitura = dos(corrida, 'revisarPr')[0];
  assert.match(leitura.parametros['Arquivos do lote'], /`src\/parsers\/vendas\.parser\.js`.*`src\/routes\/vendas\.js`/);
  assert.doesNotMatch(leitura.parametros['Arquivos do lote'], /package\.json/);
  assert.match(leitura.parametros['Comando do diff'], /^`git -C api diff [0-9a-f]{40}\.\.\.HEAD -- src\/parsers\/vendas\.parser\.js /);
  assert.equal(leitura.parametros['Mapa do código'], 'no plano, na seção "Mapa do código"');
  assert.equal(leitura.parametros['O que a catraca achou neste lote'], '(nada)');

  const ajuste = dos(corrida, 'executar')[2];
  assert.match(ajuste.parametros.Trabalho, /^refatorar o código da própria branch como os arquivos de "Achados a corrigir" apontam, sem mudar o que o código faz/);
  assert.equal(ajuste.parametros.Escopo, '`src/parsers`, `src/routes`', 'o ajuste fica nas pastas do lote');
  assert.ok(ajuste.parametros['Achados a corrigir'].includes(leitura.resultado));
  assert.equal(commitsDaBranch(mundo.api).length, 3, 'duas fatias e um ajuste: três commits pequenos');
  assert.equal(gh(mundo).prs.web, undefined, 'repositório fora do plano não ganha PR');
  assert.equal(gh(mundo).prs.api[0].isDraft, false);
});

test('diff grande é dividido em lotes que cabem numa janela; lote sem parecer ou com ajuste que não fecha não segura a entrega', () => {
  const mundo = mundoNovo({ maestro: { arquivosPorLote: 2, tentativasPorPasso: 0, voltasDeRevisao: 0 } });
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      comRota(mundo, {
        executar: (pedido, vez, padrao) => {
          if (vez < 3) return padrao(pedido, vez);
          gravar(mundo, 'api/src/parsers/vendas.parser.js', 'exports.parseVendas = () => "QUEBRADO";\n');
          return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: refactor: reuse the parser constant');
        },
        // Lote 1: um achado, e o ajuste dele nunca passa nos portões. Lote 2: o revisor não grava parecer.
        revisarPr: (pedido, vez) => (vez === 1 ? responder(mundo, pedido, REPROVADO('src/parsers/vendas.parser.js:1 — nome fora do padrão — o espelho usa parseEstoque — renomeie')) : null),
      }),
      duasNoBackend,
    ),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  const leituras = dos(corrida, 'revisarPr');
  assert.deepEqual(leituras.map((pedido) => pedido.parametros['Arquivos do lote']), ['`src/parsers/vendas.parser.js`, `src/parsers/vendas.parser.test.js`', '`src/routes/index.js`, `src/routes/vendas.js`', '`src/routes/vendas.test.js`']);
  assert.equal(commitsDaBranch(mundo.api).length, 2, 'o ajuste que não fechou foi desfeito');
  assert.equal(git(mundo.api, 'status', '--porcelain'), '');
  const corpo = gh(mundo).prs.api[0].body;
  assert.match(corpo, /- Ponto em aberto da revisão \(2 arquivo\(s\) a partir de src\/parsers\/vendas\.parser\.js\): os ajustes não fecharam .* O revisor apontava: src\/parsers\/vendas\.parser\.js:1 — nome fora do padrão/);
  assert.equal(gh(mundo).prs.api[0].isDraft, false, 'ponto em aberto não é pendência');
  assert.match(corrida.texto, /A revisão linha por linha de backend não teve parecer válido para 2 arquivo\(s\) a partir de src\/routes\/index\.js/);
});

// --------------------------------------------------------------------------------------- QA

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
  const qas = dos(corrida, 'qa');
  assert.equal(qas.length, 3);
  assert.match(problemaDe(mundo, qas[1]), /Falta uma linha .* para: CA2/);
  const correcoes = dos(corrida, 'executar').slice(2);
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

test('QA que não dá para fazer, ou que continua falhando: a entrega segue, com a PR em rascunho e a pendência escrita', () => {
  const bloqueado = mundoNovo();
  iniciar(bloqueado);
  const corrida = operar(bloqueado, agentes(bloqueado, { qa: (pedido) => responder(bloqueado, pedido, 'RESULTADO: bloqueado\nMOTIVO: não há navegador nesta ferramenta') }));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(gh(bloqueado).prs.web[0].isDraft, true);
  assert.equal(gh(bloqueado).prs.api[0].isDraft, false);
  assert.match(gh(bloqueado).prs.web[0].body, /QA na tela: PENDENTE — não há navegador nesta ferramenta/);
  assert.match(gh(bloqueado).prs.web[0].body, /## Pendências\n\n.*\n\n- O QA na tela não foi feito: não há navegador nesta ferramenta\. Teste na tela antes de tirar a PR de rascunho\./);
  assert.doesNotMatch(gh(bloqueado).prs.api[0].body, /## Pendências/, 'a pendência é do repositório da tela');
  assert.match(corrida.texto, /PR de frontend: #102 — 1 check verde, em rascunho/);

  const doHumano = mundoNovo({ maestro: { qa: 'humano' } });
  iniciar(doHumano);
  const semQa = operar(doHumano, agentes(doHumano));
  assert.equal(semQa.fim, 'FIM', semQa.texto);
  assert.ok(!papeis(semQa).includes('qa'));
  assert.match(gh(doHumano).prs.web[0].body, /QA na tela: PENDENTE — o harness está configurado para você testar/);

  const teimoso = mundoNovo({ maestro: { ciclosDeQa: 1 } });
  iniciar(teimoso);
  const falhando = operar(teimoso, agentes(teimoso, { qa: (pedido) => responder(teimoso, pedido, 'RESULTADO: falhou\nCA1: passou — a lista aparece\nCA2: falhou — onde: frontend — o filtro não refaz a busca') }));
  assert.equal(falhando.fim, 'FIM', falhando.texto);
  assert.ok(!falhando.acoes.includes('PARE'));
  assert.equal(dos(falhando, 'qa').length, 2);
  assert.match(gh(teimoso).prs.web[0].body, /QA na tela: FALHOU — veja "Pendências"/);
  assert.match(falhando.texto, /- frontend: O QA na tela falhou e não foi corrigido: falhou 2 vezes seguidas\.\n {4}\| RESULTADO: falhou/);
  assert.equal(gh(teimoso).prs.web[0].isDraft, true);
});

// ------------------------------------------------------------------------ publicação e checks

test('checks vermelhos na PR: o resumo volta para um executor, o maestro publica de novo e espera o verde', () => {
  const mundo = mundoNovo();
  const sonar = { name: 'SonarCloud Code Analysis', bucket: 'fail', description: 'Coverage on New Code 62% (required 80%)' };
  mudarGh(mundo, (estado) => {
    estado.checks.api = [{ pendentePor: 2, checks: [{ name: 'ci', bucket: 'pass' }, sonar] }];
  });
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo));

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const correcao = dos(corrida, 'executar')[1];
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

test('checks que continuam vermelhos, ou que não terminam: a PR fica em rascunho com a pendência, sem chamar ninguém', () => {
  const vermelho = mundoNovo({ maestro: { voltasDeChecks: 1 } });
  const sonar = { name: 'SonarCloud Code Analysis', bucket: 'fail', description: 'Coverage on New Code 62% (required 80%)' };
  mudarGh(vermelho, (estado) => (estado.checks.api = [{ checks: [sonar] }, { checks: [sonar] }]));
  iniciar(vermelho);
  const corrida = operar(vermelho, agentes(vermelho, {}, soBackend));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  assert.equal(commitsDaBranch(vermelho.api).length, 2, 'uma rodada de correção foi tentada');
  assert.equal(gh(vermelho).prs.api[0].isDraft, true);
  assert.match(corrida.texto, /PR de backend: #101 — vermelhos, em rascunho/);
  assert.match(corrida.texto, /- backend: Os checks da PR #101 de backend continuam vermelhos depois de 1 correções\.\n {4}\| .*SonarCloud/s);

  const lento = mundoNovo({ maestro: { esperaDeChecksMin: 0 } });
  mudarGh(lento, (estado) => (estado.checks.api = [{ pendentePor: 100000, checks: [{ name: 'ci', bucket: 'pass' }] }]));
  iniciar(lento);
  const esperando = operar(lento, agentes(lento, {}, soBackend));
  assert.equal(esperando.fim, 'FIM', esperando.texto);
  assert.match(esperando.texto, /PR de backend: #101 — ainda rodando, em rascunho/);
  assert.match(esperando.texto, /Os checks da PR #101 de backend ainda estavam rodando depois de 0 min; o maestro parou de esperar\./);
});

test('PR sem nenhum check: sai do rascunho uma vez para o CI rodar; continuando sem checks, a entrega termina com o aviso', () => {
  const mundo = mundoNovo();
  mudarGh(mundo, (estado) => {
    // No backend o CI ignora rascunho: a primeira leitura não traz nada, a segunda (fora do rascunho) traz.
    estado.checks.api = [{ checks: [] }];
    estado.checks.web = [{ checks: [{ name: 'ci', bucket: 'skipping' }] }];
  });
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  const { prs, chamadas } = gh(mundo);
  assert.equal(chamadas.filter((chamada) => chamada.startsWith('api: pr ready 101')).length, 1, 'uma tentativa de tirar do rascunho, não mais');
  assert.equal(prs.api[0].isDraft, false);
  assert.match(corrida.texto, /PR de backend: #101 — sem checks, pronta para revisão/);
  assert.match(corrida.texto, /PR de frontend: #102 — sem checks/, 'check pulado não conta como verde');
  assert.match(corrida.texto, /A PR #101 de backend não registrou nenhum check\. Se o repositório roda CI em PR, confira no GitHub por que não disparou\./);
});

test('PR: conflito com a base vira pendência; PR antiga já incorporada dá lugar a uma nova', () => {
  const mundo = mundoNovo();
  mudarGh(mundo, (estado) => {
    estado.prs.api = [{ number: 77, url: 'https://github.example/api/pull/77', branch: BRANCH, state: 'MERGED', isDraft: false, headRefOid: 'abc123' }];
  });
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo, {}, soBackend), { limite: 60 });
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(gh(mundo).prs.api.map((pr) => [pr.number, pr.state]), [[77, 'MERGED'], [101, 'OPEN']]);

  const comConflito = mundoNovo();
  iniciar(comConflito);
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
      soBackend,
    ),
  );
  assert.equal(segunda.fim, 'FIM', segunda.texto);
  assert.ok(!segunda.acoes.includes('PARE'));
  assert.match(segunda.texto, /- backend: A PR #101 de backend tem conflito com a branch base\. O maestro não faz merge nem rebase\./);
  assert.equal(gh(comConflito).prs.api[0].isDraft, true);
});

test('prova final antes de publicar: bloqueio que já estava na branch volta para correção; sem conserto, publica em rascunho com a pendência', () => {
  const preparar = (mundo) => {
    git(mundo.api, 'checkout', '-q', '-b', BRANCH);
    const antigo = ler(mundo, 'api/src/parsers/estoque.parser.js');
    gravar(mundo, 'api/src/parsers/estoque.parser.js', `// eslint-disable-next-line\n${antigo}`);
    git(mundo.api, 'commit', '-q', '-am', 'chore: old commit with a shortcut');
    gravar(mundo, 'harness/tarefas/PARC-9-manual/plano.md', plano({ status: 'aprovado', fatias: [F1] }));
    gravar(mundo, 'harness/tarefas/ATUAL', 'PARC-9-manual\n');
    return antigo;
  };

  const mundo = mundoNovo();
  const antigo = preparar(mundo);
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
  const correcao = dos(corrida, 'executar')[1];
  assert.match(correcao.parametros.Trabalho, /backend: correção da prova final/);
  assert.match(problemaDe(mundo, correcao), /A branch tem bloqueios da catraca:\n- \[BLOQUEIO\] api\/src\/parsers\/estoque\.parser\.js:1 — desliga o lint/);
  assert.equal(gh(mundo).prs.api.length, 1, 'a PR só abre depois da prova final');
  assert.equal(gh(mundo).prs.api[0].isDraft, false);

  // O executor não conserta o atalho antigo: a PR sai assim mesmo, em rascunho, e diz o que falta.
  const semConserto = mundoNovo({ maestro: { voltasDeRevisao: 1 } });
  preparar(semConserto);
  const outra = operar(semConserto, agentes(semConserto));
  assert.equal(outra.fim, 'FIM', outra.texto);
  assert.ok(!outra.acoes.includes('PARE'));
  const pr = gh(semConserto).prs.api[0];
  assert.equal(pr.isDraft, true);
  assert.match(pr.body, /Portões locais \(testes\): NÃO passam\. Veja "Pendências"\./);
  assert.match(pr.body, /- A branch de backend não passa na prova final \(catraca e portões da branch inteira\), mesmo depois de 1 correções\./);
  assert.match(pr.body, /\[BLOQUEIO\] api\/src\/parsers\/estoque\.parser\.js:1 — desliga o lint/);
  assert.match(outra.texto, /PR de backend: #101 — não acompanhados, em rascunho/);
  assert.ok(!gh(semConserto).chamadas.some((chamada) => chamada.startsWith('api: pr checks')), 'sem prova local não há por que esperar os checks');
});

test('correção que não fecha (dos checks, do QA): o maestro desfaz a tentativa, escreve a pendência e a condução segue até o fim', () => {
  const quebrar = (mundo, arquivo) => (pedido) => {
    gravar(mundo, arquivo, 'export const quebrado = "QUEBRADO";\n');
    return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: fix: attempt that never passes the gates');
  };

  // Checks vermelhos, e a correção nunca passa nos portões.
  const dosChecks = mundoNovo({ maestro: { tentativasPorPasso: 0, voltasDeRevisao: 0 } });
  mudarGh(dosChecks, (estado) => (estado.checks.api = [{ checks: [{ name: 'ci', bucket: 'fail', description: 'lint failed' }] }]));
  iniciar(dosChecks);
  const umaVez = operar(dosChecks, agentes(dosChecks, { executar: (pedido, vez, padrao) => (vez === 1 ? padrao(pedido, vez) : quebrar(dosChecks, 'api/src/parsers/vendas.parser.js')(pedido)) }, soBackend));
  assert.equal(umaVez.fim, 'FIM', umaVez.texto);
  assert.ok(!umaVez.acoes.includes('PARE'));
  assert.equal(commitsDaBranch(dosChecks.api).length, 1, 'a correção que não passou não virou commit');
  assert.equal(git(dosChecks.api, 'status', '--porcelain'), '');
  assert.match(umaVez.texto, /- backend: Os checks da PR #101 de backend continuam vermelhos e a correção não fechou: "backend: correção dos checks da PR: corrigir" não fechou em 2 tentativas\. O que foi tentado está em harness\/\.maestro\/descartados\/PARC-482-expor-vendas-parceiro-api\/backend-checks-1\.patch\./);
  assert.equal(gh(dosChecks).prs.api[0].isDraft, true);

  // O QA acha uma falha no backend, e a correção de lá nunca fecha: a tela para de esperar.
  const doQa = mundoNovo({ maestro: { tentativasPorPasso: 0, voltasDeRevisao: 0 } });
  iniciar(doQa);
  const outra = operar(
    doQa,
    agentes(doQa, {
      qa: (pedido) => responder(doQa, pedido, 'RESULTADO: falhou\nCA1: falhou — onde: backend — GET /vendas devolve 500\nCA2: passou — o filtro refaz a lista'),
      executar: (pedido, vez, padrao) => (vez <= 2 ? padrao(pedido, vez) : quebrar(doQa, 'api/src/parsers/vendas.parser.js')(pedido)),
    }),
  );
  assert.equal(outra.fim, 'FIM', outra.texto);
  assert.ok(!outra.acoes.includes('PARE'));
  assert.equal(dos(outra, 'qa').length, 1, 'sem a correção, não adianta testar de novo');
  assert.match(outra.texto, /- frontend: O QA na tela achou falhas e a correção em backend não fechou:/);
  const { prs } = gh(doQa);
  assert.equal(prs.web[0].isDraft, true);
  assert.match(prs.web[0].body, /QA na tela: FALHOU — veja "Pendências"/);
  assert.equal(prs.api[0].isDraft, false, 'a pendência é da PR da tela');
});

// ---------------------------------------------------------------------------------- bloqueios

test('ambiente: sem gh autenticado, ou sem alcançar o remoto, a condução bloqueia antes de gastar trabalho e retoma sem cerimônia', () => {
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
      return vez <= 2 ? true : null;
    },
  });
  assert.equal(corrida.acoes[0], 'PARE', 'antes de qualquer subagente');
  assert.match(pares[0], /^BLOQUEIO — O ambiente não está pronto para uma entrega até a PR:/);
  assert.match(pares[0], /O gh não está autenticado, ou o terminal do agente não alcança o GitHub/);
  assert.match(pares[0], /allowlist/);
  assert.match(pares[0], /Quando resolver, mande \/entregar de novo, sem tarefa: a condução continua de onde parou\.$/);
  assert.match(pares[1], /Não consegui falar com o remoto "origin"/);
  assert.equal(dos(corrida, 'executar').length, 2, 'nenhum executor rodou antes de o remoto responder');
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!existe(mundo, 'harness/trabalho/RESPOSTA.md'), 'liberar um bloqueio não pede resposta por escrito');
});

test('mudança sem commit: a do humano bloqueia na entrada; a que a condução deixou é descartada, com o patch guardado', () => {
  const mundo = mundoNovo();
  gravar(mundo, 'api/src/parsers/rascunho-do-humano.js', '// trabalho em andamento\n');
  iniciar(mundo);
  const pares = [];
  const corrida = operar(
    mundo,
    agentes(mundo, {
      // O redator da descrição deixa um arquivo solto no repositório: sobra da própria condução.
      descrever: (pedido, vez, padrao) => {
        if (pedido.repo === 'backend') gravar(mundo, 'api/notas-do-redator.txt', 'rascunho\n');
        return padrao(pedido, vez);
      },
    }),
    {
      humano: (pare) => {
        if (pares.push(pare) > 1) return null;
        destruir(join(mundo.api, 'src', 'parsers', 'rascunho-do-humano.js'));
        return true;
      },
    },
  );
  assert.equal(pares.length, 1);
  assert.match(pares[0], /^BLOQUEIO — Há mudanças sem commit em api\/, e elas são suas: o maestro não mexe nelas\. Faça commit, guarde \(git stash\) ou descarte\./);
  assert.equal(dos(corrida, 'executar').length, 2, 'depois do bloqueio liberado, as duas fatias saem');
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!existe(mundo, 'api/notas-do-redator.txt'));
  assert.match(corrida.texto, /Sobraram mudanças sem commit em api\/ na hora de publicar; o maestro descartou \(estão em harness\/\.maestro\/descartados\/PARC-482-expor-vendas-parceiro-api\/backend-\d+\.patch\)\./);
  assert.equal(git(mundo.api, 'status', '--porcelain'), '');
});

test('mudança sem commit do humano aparece na primeira chamada, antes de qualquer subagente; se a tarefa não mexe lá, ele manda seguir', () => {
  const mundo = mundoNovo();
  gravar(mundo, 'web/src/telas/rascunho-do-humano.jsx', '// trabalho em andamento\n');
  iniciar(mundo);
  const pares = [];
  const corrida = operar(mundo, agentes(mundo, {}, soBackend), { humano: (pare) => pares.push(pare) });

  assert.equal(corrida.acoes[0], 'PARE', 'o aviso vem com o humano ainda na conversa, e não quando a condução chegar ao repositório');
  assert.equal(pares.length, 1);
  assert.match(pares[0], /^BLOQUEIO — Há mudanças sem commit em web\/, e elas são suas: o maestro não mexe nelas\. Faça commit, guarde \(git stash\) ou descarte\.\nPara ver: git -C web status --short\nPara guardar tudo: git -C web stash -u\nSe esta tarefa não mexe aí, deixe como está: a condução não toca nesse repositório\.\n\nQuando resolver, mande \/entregar de novo, sem tarefa: a condução continua de onde parou\.$/);
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(ler(mundo, 'web/src/telas/rascunho-do-humano.jsx'), '// trabalho em andamento\n', 'o que é do humano fica como estava');
  assert.equal(git(mundo.web, 'status', '--porcelain'), '?? src/telas/rascunho-do-humano.jsx');
  assert.equal(git(mundo.web, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'a condução nem entrou nesse repositório');
  assert.equal(gh(mundo).prs.api.length, 1);
  assert.doesNotMatch(corrida.texto, /Sobraram mudanças/);
});

test('mudança sem commit num repositório de que o plano precisa: bloqueia de novo antes da primeira fatia, e não no meio do caminho', () => {
  const mundo = mundoNovo();
  gravar(mundo, 'api/src/parsers/rascunho.js', '// meu\n');
  gravar(mundo, 'web/src/telas/rascunho-do-humano.jsx', '// trabalho em andamento\n');
  iniciar(mundo);
  const pares = [];
  let executores = 0;
  const corrida = operar(
    mundo,
    agentes(mundo, {
      executar: (pedido, vez, padrao) => {
        executores += 1;
        return padrao(pedido, vez);
      },
    }),
    {
      humano: (pare, vez) => {
        pares.push({ pare, executores });
        // Na primeira vez ele só limpa o backend e manda seguir; na segunda, limpa o que faltava.
        if (vez === 1) destruir(join(mundo.api, 'src', 'parsers', 'rascunho.js'));
        if (vez === 2) destruir(join(mundo.web, 'src', 'telas', 'rascunho-do-humano.jsx'));
        return true;
      },
    },
  );

  assert.equal(pares.length, 2);
  assert.match(pares[0].pare, /^BLOQUEIO — Há mudanças sem commit em api\/ e em web\/, e elas são suas/, 'os dois de uma vez');
  assert.match(pares[0].pare, /Para guardar tudo: git -C api stash -u\nPara ver: git -C web status --short/);
  assert.match(pares[1].pare, /^BLOQUEIO — Há mudanças sem commit em web\/, e elas são suas/);
  assert.doesNotMatch(pares[1].pare, /Se esta tarefa não mexe aí/, 'agora o maestro sabe que o plano mexe nele');
  assert.equal(pares[1].executores, 0, 'o segundo bloqueio vem com o plano aprovado, antes de qualquer linha de código');
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(dos(corrida, 'executar').length, 2);
  assert.equal(gh(mundo).prs.web.length, 1);
});

test('mudança que aparece depois do começo num repositório da tarefa não bloqueia: sai do caminho, guardada em patch, com aviso', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(mundo, {
      // O reconhecedor larga anotações dentro de um repositório. Ele só podia ler.
      reconhecer: (pedido, vez, padrao) => {
        gravar(mundo, 'web/anotacoes-do-reconhecimento.md', 'rascunho\n');
        return padrao(pedido, vez);
      },
    }),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'), 'o que não estava lá quando o humano passou a vez não vira "mudança sua"');
  assert.ok(!existe(mundo, 'web/anotacoes-do-reconhecimento.md'));
  assert.equal(git(mundo.web, 'status', '--porcelain'), '');
  assert.match(
    corrida.texto,
    /Havia mudanças sem commit em web\/ que não estavam lá quando você passou a vez \(sobra de um passo, ou edição feita com a condução em andamento\)\. O maestro tirou da pasta para poder trabalhar; estão em harness\/\.maestro\/descartados\/PARC-482-expor-vendas-parceiro-api\/frontend-\d+\.patch\./,
  );
  const guardados = readdirSync(join(mundo.raiz, 'harness', '.maestro', 'descartados', 'PARC-482-expor-vendas-parceiro-api'));
  assert.equal(guardados.length, 1);
  assert.match(ler(mundo, `harness/.maestro/descartados/PARC-482-expor-vendas-parceiro-api/${guardados[0]}`), /anotacoes-do-reconhecimento\.md/, 'nada se perde');
  assert.equal(gh(mundo).prs.web.length, 1, 'e a entrega do frontend sai');
});

test('o que o humano mexe durante uma pausa é dele: bloqueia na entrada; o que já estava lá antes da pausa, e não era dele, não', () => {
  const recusarPush = (mundo) => {
    const gancho = join(gh(mundo).remotos.api, 'hooks', 'pre-receive');
    writeFileSync(gancho, '#!/bin/sh\necho "remote: sem permissão" >&2\nexit 1\n', { mode: 0o755 });
    return gancho;
  };

  // Durante o bloqueio do push do backend, o humano começa algo no frontend e deixa sem commit.
  const mundo = mundoNovo();
  const gancho = recusarPush(mundo);
  iniciar(mundo);
  const pares = [];
  const corrida = operar(mundo, agentes(mundo), {
    humano: (pare, vez) => {
      pares.push(pare);
      if (vez === 1) {
        destruir(gancho);
        gravar(mundo, 'web/src/telas/coisa-minha.jsx', '// comecei aqui durante a pausa\n');
      }
      if (vez === 2) destruir(join(mundo.web, 'src', 'telas', 'coisa-minha.jsx'));
      return vez <= 2 ? true : null;
    },
  });
  assert.equal(pares.length, 2);
  assert.match(pares[0], /^BLOQUEIO — O push da branch/);
  assert.match(pares[1], /^BLOQUEIO — Há mudanças sem commit em web\/, e elas são suas/, 'o que ele deixou na pausa não é descartado');
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.doesNotMatch(corrida.texto, /O maestro tirou da pasta/);

  // A sobra de um subagente, que já estava no frontend antes da pausa, continua não sendo do humano.
  const outro = mundoNovo();
  const outroGancho = recusarPush(outro);
  iniciar(outro);
  const segunda = operar(
    outro,
    agentes(outro, {
      criticar: (pedido, vez, padrao) => {
        gravar(outro, 'web/notas-do-critico.txt', 'rascunho\n');
        return padrao(pedido, vez);
      },
    }),
    { humano: (pare, vez) => (vez === 1 ? (destruir(outroGancho), true) : null) },
  );
  assert.equal(segunda.fim, 'FIM', segunda.texto);
  assert.equal(segunda.acoes.filter((acao) => acao === 'PARE').length, 1, 'só o bloqueio do push');
  assert.match(segunda.texto, /Havia mudanças sem commit em web\/ que não estavam lá quando você passou a vez/);
  assert.equal(git(outro.web, 'status', '--porcelain'), '');
});

test('o que foi descartado continua guardado quando outra condução começa; só as últimas tarefas ficam', () => {
  const mundo = mundoNovo();
  const descartados = join(mundo.raiz, 'harness', '.maestro', 'descartados');
  for (let i = 1; i <= 7; i++) {
    gravar(mundo, `harness/.maestro/descartados/TAREFA-${i}/F1.patch`, 'diff\n');
    utimesSync(join(descartados, `TAREFA-${i}`), new Date(2026, 0, i), new Date(2026, 0, i));
  }
  iniciar(mundo);
  assert.deepEqual(readdirSync(descartados).sort(), ['TAREFA-3', 'TAREFA-4', 'TAREFA-5', 'TAREFA-6', 'TAREFA-7']);
});

test('push recusado é bloqueio de ambiente: o humano resolve, a condução retoma e publica', () => {
  const mundo = mundoNovo();
  const gancho = join(gh(mundo).remotos.api, 'hooks', 'pre-receive');
  writeFileSync(gancho, '#!/bin/sh\necho "remote: você não tem permissão de escrita" >&2\nexit 1\n', { mode: 0o755 });
  iniciar(mundo);
  const pares = [];
  const corrida = operar(mundo, agentes(mundo, {}, soBackend), {
    humano: (pare) => {
      if (pares.push(pare) > 1) return null;
      destruir(gancho);
      return true;
    },
  });
  assert.match(pares[0], /^BLOQUEIO — O push da branch feature\/PARC-482-parser-vendas em backend falhou:/);
  assert.match(pares[0], /você não tem permissão de escrita/);
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(dos(corrida, 'executar').length, 1, 'o trabalho feito antes do bloqueio não se repete');
  assert.equal(gh(mundo).prs.api.length, 1);
});

// ----------------------------------------------------------------------------- comandos e hooks

test('iniciar dá nome à tarefa e não deixa condução parada segurar a próxima; encerrar larga', () => {
  const mundo = mundoNovo();
  const semTexto = maestro(mundo, 'iniciar');
  assert.equal(semTexto.codigo, 2);
  assert.match(semTexto.erro, /harness\/trabalho\/ENTRADA\.md/);
  assert.match(semTexto.saida, /AÇÃO: PARE/, 'o operador só entende AÇÃO: o erro de uso chega como parada');

  assert.match(iniciar(mundo, 'Corrigir o arredondamento do total no parser de estoque').saida, /Condução de \d{4}-\d\d-\d\d-corrigir-arredondamento-total-parser iniciada/);
  assert.ok(!existe(mundo, 'harness/trabalho/ENTRADA.md'), 'o texto da tarefa foi para o livro');
  assert.match(livro(mundo).pedido, /arredondamento/);
  assert.equal(ler(mundo, 'harness/tarefas/ATUAL').trim(), livro(mundo).tarefa);

  // Uma condução com chamada recente tem operador: outra tarefa não começa por cima dela.
  maestro(mundo, 'proximo');
  gravar(mundo, 'harness/trabalho/ENTRADA.md', 'outra tarefa');
  const porCima = maestro(mundo, 'iniciar');
  assert.equal(porCima.codigo, 2);
  assert.match(porCima.erro, /Já existe uma condução em andamento .* com chamada há menos de 10 minutos/);

  // Parada há tempo (ou bloqueada), ela dá o lugar sem ninguém precisar encerrar.
  mudarLivro(mundo, (dados) => (dados.ultimaChamada = Date.now() - 11 * 60 * 1000));
  assert.match(iniciar(mundo, 'PARC-77 mostrar o total na tela').saida, /Condução de PARC-77-mostrar-total-tela iniciada/);
  assert.match(maestro(mundo, 'estado').saida, /MAESTRO · PARC-77-mostrar-total-tela · preparo: mapear · 0 chamadas/);
  assert.equal(maestro(mundo, 'validar-plano').codigo, 2, 'ainda não há plano para validar');

  assert.match(maestro(mundo, 'encerrar').saida, /largada/);
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: FIM/);
  assert.match(maestro(mundo, 'retomar').saida, /Não há condução aberta/);
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
  assert.equal(hook(mundo, 'shell', 'claude', noClaude('node harness/bin/maestro.mjs revisar')).hookSpecificOutput.permissionDecision, 'allow');
  assert.deepEqual(hook(mundo, 'shell', 'claude', noClaude('node harness/bin/maestro.mjs proximo && rm -rf x')), {}, 'comando encadeado segue o fluxo normal de permissão');
  const despacho = maestro(mundo, 'proximo');

  // Parou sem abrir o subagente: um empurrão só, com o texto a repassar. Outra conversa não é empurrada.
  const abrir = fimDeTurno('operador-1').followup_message;
  assert.match(abrir, /você parou com o passo "Reconhecer o código para esta tarefa/);
  assert.match(abrir, /harness\/trabalho\/\d+-reconhecer\.pedido\.md/);
  assert.equal(fimDeTurno('operador-1').followup_message, abrir, 'o mesmo evento vindo de duas fontes de hook recebe a mesma resposta');
  const memoria = join(mundo.raiz, 'harness', '.maestro', 'operador.json');
  const lembranca = JSON.parse(readFileSync(memoria, 'utf8'));
  writeFileSync(memoria, JSON.stringify({ ...lembranca, empurrao: { ...lembranca.empurrao, quando: lembranca.empurrao.quando - 60000 } }));
  assert.deepEqual(fimDeTurno('operador-1'), {}, 'com o passo em aberto, o empurrão acontece uma vez só');
  assert.deepEqual(fimDeTurno('outra-conversa'), {});

  // O subagente terminou e o operador parou sem rodar o maestro: empurrão para seguir.
  agentes(mundo).reconhecer(lerPedido(mundo, despacho.saida));
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
  const instalar = hook(mundo, 'shell', 'cursor', noCursor('npm install date-fns', mundo.api));
  assert.equal(instalar.permission, 'deny');
  assert.match(instalar.agent_message, /Mudar dependência é limite da lei \(seção 2\): só o humano instala\. Resolva sem a dependência; se o trabalho não fecha sem ela, entregue o resto e registre a pendência\./);
  for (const comando of ['proximo', 'revisar', 'iniciar']) {
    const subagente = hook(mundo, 'shell', 'claude', noClaude(`node harness/bin/maestro.mjs ${comando}`, { agent_id: 'sub-1' })).hookSpecificOutput;
    assert.equal(subagente.permissionDecision, 'deny');
    assert.match(subagente.permissionDecisionReason, /Só a conversa principal conduz o maestro/);
  }
  assert.deepEqual(hook(mundo, 'shell', 'claude', noClaude('node harness/bin/maestro.mjs validar-plano', { agent_id: 'sub-1' })).hookSpecificOutput.permissionDecision, 'allow');

  // A catraca do diff não cobra durante a condução (quem confere é o maestro), e volta quando ela acaba.
  gravar(mundo, 'api/src/parsers/estoque.parser.js', '// eslint-disable-next-line\nexports.parseEstoque = () => null;\n');
  assert.deepEqual(fimDeTurno(conversaDeFora), {});
  // Condução largada há horas não cala a catraca de quem voltou a trabalhar à mão.
  const recente = ler(mundo, CAMINHO_DO_LIVRO);
  mudarLivro(mundo, (dados) => (dados.ultimaChamada = Date.now() - 3 * 60 * 60 * 1000));
  const cobranca = fimDeTurno(`${conversaDeFora}-b`).followup_message;
  assert.match(cobranca, /CATRACA DO HARNESS/);
  assert.match(cobranca, /Isto é limite da lei \(seção 2\): não contorne\. Se o trabalho não fecha sem ele, desfaça a mudança, entregue o resto e registre a pendência\./);
  gravar(mundo, CAMINHO_DO_LIVRO, recente);
  maestro(mundo, 'encerrar');
  assert.match(fimDeTurno(conversaDeFora).followup_message, /CATRACA DO HARNESS/);
  assert.deepEqual(hook(mundo, 'shell', 'cursor', noCursor('git stash', mundo.api)), { permission: 'allow' }, 'sem condução, o git volta a ser de quem está na conversa');
  assert.match(hook(mundo, 'compactar', 'cursor', {}).user_message, /conversa nova/);
});

test('quem libera um bloqueio é o humano: o operador não retoma no turno em que o PARE apareceu, nem larga a condução sozinho', () => {
  const mundo = mundoNovo();
  mudarGh(mundo, (estado) => (estado.autenticado = false));
  iniciar(mundo);
  const RETOMAR = 'node harness/bin/maestro.mjs retomar';
  const noCursor = (turno, command) => hook(mundo, 'shell', 'cursor', { conversation_id: 'c1', generation_id: turno, command, cwd: mundo.raiz });
  const noClaude = (turno, command) => hook(mundo, 'shell', 'claude', { session_id: 'c2', prompt_id: turno, tool_name: 'Bash', tool_input: { command }, cwd: mundo.raiz });
  const proximo = (turno) => {
    assert.deepEqual(noCursor(turno, 'node harness/bin/maestro.mjs proximo'), { permission: 'allow' });
    return maestro(mundo, 'proximo').saida;
  };

  // Turno 1: o ambiente bloqueia. O operador tenta retomar sozinho no mesmo turno: barrado, mesmo insistindo.
  assert.match(proximo('t1'), /AÇÃO: PARE\nIsto é um bloqueio que só o humano resolve\./);
  const sozinho = noCursor('t1', RETOMAR);
  assert.equal(sozinho.permission, 'deny');
  assert.match(sozinho.agent_message, /resposta-do-humano/);
  assert.match(sozinho.agent_message, /Quem libera um bloqueio \(PARE\) é o humano/);
  proximo('t1');
  assert.equal(noCursor('t1', RETOMAR).permission, 'deny');

  // Numa conversa nova o PARE ainda não foi mostrado ao humano: vale a mesma regra, turno a turno.
  noClaude('p1', 'node harness/bin/maestro.mjs proximo');
  maestro(mundo, 'proximo');
  assert.equal(noClaude('p1', RETOMAR).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(noClaude('p2', RETOMAR).hookSpecificOutput.permissionDecision, 'allow');

  // O humano respondeu na primeira conversa: turno novo. O retomar passa, e o bloqueio volta se nada mudou.
  proximo('t2');
  assert.deepEqual(noCursor('t2', RETOMAR), { permission: 'allow' });
  assert.match(maestro(mundo, 'retomar').saida, /Bloqueio liberado\. Agora rode: node harness\/bin\/maestro\.mjs proximo/);
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: PARE/, 'o ambiente é conferido de novo: sem conserto, o bloqueio volta');
  mudarGh(mundo, (estado) => (estado.autenticado = true));
  maestro(mundo, 'retomar');
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: SUBAGENTE/);
  assert.match(maestro(mundo, 'retomar').saida, /Nada está bloqueado/);

  // Largar a condução pede a confirmação do humano; onde não há como perguntar, bloqueia.
  const largar = noCursor('t2', 'node harness/bin/maestro.mjs encerrar');
  assert.equal(largar.permission, 'ask');
  assert.match(largar.user_message, /Largar a condução do maestro é decisão do humano\. Confirma\?/);
  const noCodex = hook(mundo, 'shell', 'codex', { session_id: 'c3', tool_name: 'shell', tool_input: { command: 'node harness/bin/maestro.mjs encerrar' }, cwd: mundo.raiz });
  assert.equal(noCodex.hookSpecificOutput.permissionDecision, 'deny');
});

test('portão demorado atravessa várias chamadas curtas, e trava de chamada morta não segura a condução', () => {
  const mundo = mundoNovo({
    maestro: { esperaPorChamadaSeg: 0.3 },
    config: (config) => {
      config.repos.backend.portoes = [{ nome: 'testes', cmd: 'node -e "setTimeout(() => {}, 1500)" && node conferir.js' }];
    },
  });
  iniciar(mundo);
  const trava = join(mundo.raiz, 'harness', '.maestro', 'conducao', 'maestro.trava');

  writeFileSync(trava, JSON.stringify({ pid: process.pid, quando: Date.now() }));
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: REPETIR — outra chamada do maestro ainda está rodando/);
  assert.equal(livro(mundo).chamadas, 0);
  writeFileSync(trava, JSON.stringify({ pid: 2 ** 22 + 12345, quando: Date.now() }));

  const corrida = operar(mundo, agentes(mundo, {}, soBackend));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(corrida.acoes.filter((acao) => acao === 'REPETIR').length >= 2, `esperava várias chamadas de espera: ${corrida.acoes.join(' ')}`);
  assert.ok(!existsSync(trava));
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
  const entrar = (nome, opcoes) => acoes.entrarNaBranch(mundo.api, BRANCH, 'main', nome, Date.now() + 8000, opcoes);
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

  // Já na branch, sem pedir "sempre", não há busca; com "sempre", a local alcança o que subiu.
  commitNoRemoto('a2.txt');
  assert.deepEqual(entrar('busca-2b'), { estado: 'ok' });
  assert.equal(git(mundo.api, 'log', '-1', '--format=%s'), 'remoto: a.txt');
  assert.deepEqual(entrar('busca-2c', { sempre: true }), { estado: 'ok' });
  assert.equal(git(mundo.api, 'log', '-1', '--format=%s'), 'remoto: a2.txt');

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

test('erro que o maestro não sabe tratar: tenta de novo sozinho e, se insiste, vira bloqueio, não silêncio', () => {
  const mundo = mundoNovo();
  const semConducao = maestro(mundo, 'proximo');
  assert.equal(semConducao.codigo, 2);
  assert.match(semConducao.saida, /AÇÃO: PARE\n.*\n===\nO maestro não conseguiu rodar: Não há condução aberta/);

  // Um estado que o maestro não conhece faz cada passo falhar: duas tentativas, depois o bloqueio.
  iniciar(mundo);
  mudarLivro(mundo, (dados) => {
    dados.preparo.fase = 'feito';
    Object.assign(dados, { tipo: 'revisao', revisao: { branch: BRANCH, repos: ['backend'] }, repos: { backend: { fase: 'fase-que-nao-existe' } } });
  });
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: REPETIR — o maestro esbarrou num erro e vai tentar de novo \(Fase desconhecida no livro do maestro: fase-que-nao-existe\.\)/);
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: REPETIR/);
  const bloqueio = maestro(mundo, 'proximo').saida;
  assert.match(bloqueio, /AÇÃO: PARE/);
  assert.match(bloqueio, /BLOQUEIO — O maestro esbarrou num erro que não sabe tratar: Fase desconhecida/);

  // Livro ilegível: o comando falha, e o operador recebe uma parada em vez de um rastro de pilha.
  gravar(mundo, CAMINHO_DO_LIVRO, '{ isto não é json');
  const quebrado = maestro(mundo, 'proximo');
  assert.equal(quebrado.codigo, 2);
  assert.match(quebrado.saida, /AÇÃO: PARE/);
  assert.match(quebrado.saida, /O maestro não conseguiu rodar: maestro: erro inesperado/);
});
