// node --test testes/*.test.mjs
// Conduz entregas inteiras com o maestro, do pedido à PR, num mundo de mentira: dois repositórios
// git com remoto local, um gh falso e subagentes simulados. Cada teste erra de um jeito que um
// modelo pequeno erraria, e confere que o maestro percebe, decide e segue sem chamar o humano.
// Este arquivo cobre o preparo, o plano e a unidade de trabalho; a revisão da PR, o QA, a
// publicação e os bloqueios estão em maestro-pr.test.mjs, e o /revisar em revisar.test.mjs.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  agentes, BRANCH, CAMINHO_DO_LIVRO, commitsDaBranch, criarMolde, destruir, dos, existe, F1, fatia, gh, git, gravar, implementar, iniciar, ler, livro,
  maestro, MAPA, mudarConfig, novoMundo, operar, papeis, pastaDaTarefa, plano, planoDaTarefa, problemaDe, REPROVADO, responder, trabalho,
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

const REGRA_DO_FRONTEND = '.cursor/rules/padrao-frontend.mdc';
const soBackend = { planoDoCenario: plano({ fatias: [F1] }) };

// ------------------------------------------------------------------------------ o caminho todo

test('entrega completa: do pedido às duas PRs com os checks verdes, sem o humano', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo));

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'), 'ninguém foi chamado');
  assert.deepEqual(papeis(corrida), ['reconhecer', 'planejar', 'criticar', 'executar', 'revisar', 'descrever', 'executar', 'revisar', 'qa', 'descrever']);
  assert.ok(corrida.pedidos.every((pedido) => pedido.subagente === 'maestro-passo'));

  // Quem fez branch, commit e push foi o maestro, com a mensagem que o executor escreveu.
  for (const pasta of [mundo.api, mundo.web]) {
    assert.equal(git(pasta, 'rev-parse', '--abbrev-ref', 'HEAD'), BRANCH);
    assert.equal(commitsDaBranch(pasta).length, 1);
    assert.equal(git(pasta, 'rev-parse', 'HEAD'), git(pasta, 'rev-parse', `origin/${BRANCH}`));
    assert.equal(git(pasta, 'status', '--porcelain'), '');
  }
  assert.deepEqual(commitsDaBranch(mundo.api), ['feat: work 1 on backend']);

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
  assert.match(prs.api[0].body, /## Decisões do agente\n\n.*\n\nPremissas do plano:\n {2}- O total vem em centavos/);
  assert.doesNotMatch(prs.api[0].body, /## Pendências/);

  assert.match(corrida.texto, /^ENTREGA — PARC-482 — parser de vendas/);
  assert.match(corrida.texto, /PR de backend: #101 — 1 check verde, pronta para revisão/);
  assert.match(corrida.texto, /PR de frontend: #102/);
  assert.match(corrida.texto, /O total vem em centavos/, 'as premissas do plano chegam ao humano');
  assert.match(corrida.texto, /Falta de você: revisar e fazer o merge\.$/);

  const planoFinal = planoDaTarefa(mundo);
  assert.match(planoFinal, /^Status: em revisão$/m);
  assert.match(planoFinal, /^- \[x\] \*\*F1 · backend/m);
  assert.match(planoFinal, /^- \[x\] \*\*F2 · frontend/m);
  assert.match(planoFinal, /## Estado\n\n- Pronto: F1, F2\n- Próximo passo: revisão humana e merge\n- PR de backend: https:/);

  // Depois do fim, chamar de novo só repete o relatório.
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: FIM/);
});

test('pasta limpa: na pasta da tarefa fica só o plano; os arquivos de passo são podados e somem no fim', () => {
  const mundo = mundoNovo({ maestro: { guardarPassos: false } });
  iniciar(mundo);
  let maiorPasta = 0;
  const subagentes = agentes(mundo);
  const espiar = Object.fromEntries(
    Object.entries(subagentes).map(([papel, agir]) => [
      papel,
      (pedido) => {
        maiorPasta = Math.max(maiorPasta, trabalho(mundo).length);
        return agir(pedido);
      },
    ]),
  );
  const corrida = operar(mundo, espiar);

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(pastaDaTarefa(mundo), ['plano.md'], 'nada de pedidos, respostas, livro ou cópias ao lado do plano');
  assert.deepEqual(trabalho(mundo), [], 'a pasta de trabalho some com o fim da condução');
  assert.ok(!existe(mundo, 'harness/trabalho'));
  assert.ok(maiorPasta <= 6, `a pasta de trabalho nunca acumula (maior tamanho visto: ${maiorPasta} arquivos em ${corrida.pedidos.length} passos)`);
  assert.ok(existe(mundo, CAMINHO_DO_LIVRO), 'o livro fica em harness/.maestro, fora da vista');
  assert.ok(!existe(mundo, 'harness/tarefas/ENTRADA.md'));

  // Com guardarPassos, a trilha inteira fica para quem quer depurar.
  const guardado = mundoNovo();
  iniciar(guardado);
  const outra = operar(guardado, agentes(guardado, {}, soBackend));
  assert.equal(outra.fim, 'FIM', outra.texto);
  assert.ok(trabalho(guardado).length >= outra.pedidos.length * 2, 'um pedido e um resultado por passo');
  assert.deepEqual(pastaDaTarefa(guardado), ['plano.md']);
});

test('por padrão tudo o que vai para o GitHub sai em inglês: commit, título e o texto do harness na PR', () => {
  const mundo = mundoNovo({ config: (config) => delete config.convencoes.idiomaDaPr });
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        executar: (pedido, vez, padrao) => {
          if (vez > 1) return padrao(pedido, vez);
          implementar(mundo, pedido, vez);
          return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: feat: adiciona o parser de vendas\n\nFeito: sales parser.\nDECISÃO: reused the stock parser shape — no sales mirror exists — a new base class was discarded');
        },
      },
      soBackend,
    ),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const executores = dos(corrida, 'executar');
  assert.equal(executores.length, 2);
  assert.match(executores[0].parametros['Formato do commit'], /tipo: descrição curta, em inglês/);
  assert.equal(executores[0].parametros['Idioma das decisões'], 'inglês');
  assert.match(problemaDe(mundo, executores[1]), /A mensagem de commit \("feat: adiciona o parser de vendas"\) tem que ser em inglês/);
  assert.deepEqual(commitsDaBranch(mundo.api), ['feat: work 2 on backend']);

  const corpo = gh(mundo).prs.api[0].body;
  assert.match(corpo, /## Proofs \(generated by the harness, not by the model\)/);
  assert.match(corpo, /- Local gates \(testes\): green for commit [0-9a-f]{7}\./);
  assert.match(corpo, /- Diff checks: 0 blocks\./);
  assert.match(corpo, /## Decisions made by the agent/);
  assert.match(corpo, /- F1: reused the stock parser shape/);
  assert.doesNotMatch(corpo, /Provas|Decisões|Portões/);
  assert.match(dos(corrida, 'descrever')[0].parametros['Formato do título'], /em inglês$/);
  assert.equal(dos(corrida, 'descrever')[0].parametros['Idioma da descrição'], 'inglês');
});

// ------------------------------------------------------------------------------------ preparo

test('reconhecimento: o mapa só vale com arquivos que existem, entra no plano e guia quem executa e revisa', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const inventado = MAPA.replace('`api/src/routes/index.js`', '`api/src/routes/vendas.routes.js`').replace('## Peças e espelhos', '## Peças');
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        reconhecer: (pedido, vez, padrao) => {
          if (vez > 1) return padrao(pedido, vez);
          gravar(mundo, pedido.caminhos('Arquivo do mapa')[0], inventado);
          return responder(mundo, pedido, 'RESULTADO: ok');
        },
      },
      soBackend,
    ),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const reconhecimentos = dos(corrida, 'reconhecer');
  assert.equal(reconhecimentos.length, 2);
  assert.match(ler(mundo, reconhecimentos[0].caminhos('Pedido')[0]), /PARC-482: expor as vendas por parceiro/, 'o pedido chega com as palavras do humano');
  assert.match(reconhecimentos[0].parametros.Repositórios, /backend \(pasta `api`\); frontend \(pasta `web`\)/);
  const problema = problemaDe(mundo, reconhecimentos[1]);
  assert.match(problema, /Falta a seção "## Peças e espelhos"/);
  assert.match(problema, /Estes caminhos entre crases não existem: `api\/src\/routes\/vendas\.routes\.js`/);

  // O planejador recebe o mapa; o script põe o mapa no plano; executor e revisor leem de lá.
  const planejador = dos(corrida, 'planejar')[0];
  assert.equal(planejador.caminhos('Mapa do código')[0], reconhecimentos[0].caminhos('Arquivo do mapa')[0]);
  const planoFinal = planoDaTarefa(mundo);
  assert.match(planoFinal, /## Mapa do código\n\n### Pedido\n/);
  assert.match(planoFinal, /### Entrega mais parecida\nEstoque por parceiro/);
  assert.ok(planoFinal.indexOf('## Mapa do código') < planoFinal.indexOf('## Fatias'), 'o mapa vem antes das fatias');
  assert.doesNotMatch(planoFinal, /^# Mapa do código/m);
  assert.equal(dos(corrida, 'executar')[0].parametros['Mapa do código'], 'no plano, na seção "Mapa do código"');
  assert.match(dos(corrida, 'revisar')[0].parametros.Plano, /mapa do código e desvios aprovados/);
});

test('reconhecimento que não fecha não segura a entrega: o plano sai sem mapa e o aviso vai para o relatório', () => {
  const mundo = mundoNovo({ maestro: { tentativasPorPasso: 1 } });
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo, { reconhecer: (pedido) => responder(mundo, pedido, 'RESULTADO: ok') }, soBackend));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(dos(corrida, 'reconhecer').length, 2);
  assert.match(dos(corrida, 'planejar')[0].parametros['Mapa do código'], /não há/);
  assert.match(corrida.texto, /Avisos da condução:\n- O reconhecimento do código não fechou nas tentativas/);
  assert.doesNotMatch(planoDaTarefa(mundo), /### Entrega mais parecida/);
});

test('repositório ainda não mapeado: o maestro mapeia sozinho, confere o resultado e segue', () => {
  const mundo = mundoNovo();
  const mapeada = ler(mundo, REGRA_DO_FRONTEND);
  gravar(mundo, REGRA_DO_FRONTEND, `${mapeada}\nNÃO MAPEADO\n`);
  mudarConfig(mundo, (config) => (config.repos.frontend.portoes = []));
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(mundo, {
      mapear: (pedido, vez, padrao) => {
        // Primeira vez: diz que terminou sem mapear nada. Segunda: quebra o JSON da configuração.
        if (vez === 1) return responder(mundo, pedido, 'RESULTADO: ok');
        if (vez === 2) {
          gravar(mundo, 'harness/config.json', '{ "repos": ');
          return responder(mundo, pedido, 'RESULTADO: ok');
        }
        padrao(pedido, vez);
        return responder(mundo, pedido, 'RESULTADO: ok\nAVISO: o portão "build" já falha na base e ficou de fora');
      },
    }),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  const mapeadores = dos(corrida, 'mapear');
  assert.deepEqual(mapeadores.map((pedido) => pedido.repo), ['frontend', 'frontend', 'frontend'], 'só o que faltava mapear, antes de qualquer outro passo');
  assert.equal(papeis(corrida)[0], 'mapear');
  assert.match(problemaDe(mundo, mapeadores[1]), /frontend: nenhum portão configurado/);
  assert.match(problemaDe(mundo, mapeadores[1]), /frontend: o padrão não está mapeado/);
  assert.match(problemaDe(mundo, mapeadores[2]), /harness\/config\.json ficou com JSON inválido .* e o maestro devolveu o arquivo ao que era/);
  assert.match(corrida.texto, /O padrão do frontend não estava mapeado, e o maestro mapeou sozinho\. Leia \.cursor\/rules\/padrao-frontend\.mdc/);
  assert.match(corrida.texto, /Mapeamento do frontend: o portão "build" já falha na base/);
  assert.doesNotMatch(corrida.texto, /Arquivos do harness mudaram/, 'o que o mapeador muda a pedido do maestro não é adulteração');

  // Quando nem assim sai, aí sim é bloqueio: só o humano mapeia.
  const teimoso = mundoNovo({ maestro: { tentativasPorPasso: 1 } });
  gravar(teimoso, REGRA_DO_FRONTEND, `${mapeada}\nNÃO MAPEADO\n`);
  iniciar(teimoso);
  const parada = operar(teimoso, agentes(teimoso, { mapear: (pedido) => responder(teimoso, pedido, 'RESULTADO: ok') }));
  assert.equal(parada.fim, 'PARE');
  assert.match(parada.texto, /^BLOQUEIO — Não consegui mapear sozinho o padrão do frontend/);
  assert.match(parada.texto, /Rode \/mapear frontend numa conversa nova\./);
  assert.match(parada.texto, /mande \/entregar de novo, sem tarefa/);
});

// -------------------------------------------------------------------------------------- plano

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
        return responder(mundo, pedido, REPROVADO('F1 — o Escopo não inclui `src/routes/index.js`, que registra o espelho — acrescente'));
      },
    }),
  ).pedidos.filter((pedido) => ['planejar', 'criticar'].includes(pedido.papel));

  assert.deepEqual(corrida.map((pedido) => pedido.papel), ['planejar', 'planejar', 'criticar', 'planejar', 'criticar']);
  const erros = problemaDe(mundo, corrida[1]);
  assert.match(erros, /o Espelho "src\/parsers\/nao-existe.js" não existe em api\//);
  assert.match(erros, /Linha de fatia fora do formato: "- \[ \] F2 frontend tela"/);
  assert.match(erros, /"Desvios aprovados" é só do humano/);
  assert.match(corrida[1].parametros.Motivo, /refazer o plano/);
  assert.match(ler(mundo, corrida[3].caminhos('Parecer a atender')[0]), /src\/routes\/index\.js/);
  assert.match(corrida[0].parametros['Idioma das premissas'], /português \(elas vão para a descrição da PR\)/);
});

test('ninguém aprova plano: dúvida, desvio pendente e nove fatias não param nada', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const fatias = Array.from({ length: 9 }, (_, i) => fatia(`F${i + 1}`, 'backend', `caso ${i + 1} do parser`, '`src/parsers/`, `src/routes/index.js`', '`src/parsers/estoque.parser.js`, `src/parsers/estoque.parser.test.js`'));
  const antigas = '\n## Dúvidas\n\n1. O total é bruto ou líquido? Recomendo: bruto.\n\n## Desvios pendentes\n\nDESVIO DE PADRÃO — aguardando decisão\nRecomendo: B\n';
  const corrida = operar(mundo, agentes(mundo, {}, { planoDoCenario: plano({ fatias, secoesAntigas: antigas }) }));

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  assert.equal(commitsDaBranch(mundo.api).length, 9, 'nove fatias, nove commits pequenos');
  assert.equal(dos(corrida, 'executar').length, 9);
  assert.match(corrida.texto, /O plano trazia dúvidas ou desvios em aberto; a execução seguiu pela opção que o próprio plano recomenda/);
  assert.match(gh(mundo).prs.api[0].body, /O plano trazia dúvidas ou desvios em aberto/);
  assert.match(planoDaTarefa(mundo), /## Decisões no caminho\n\n- O plano trazia dúvidas/);
});

test('crítico que nunca se convence: depois das rodadas o plano segue, e os pontos em aberto vão para o relatório', () => {
  const mundo = mundoNovo({ maestro: { voltasDeRevisao: 1 } });
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo, { criticar: (pedido) => responder(mundo, pedido, REPROVADO('F1 — eu fatiaria de outro jeito — divida em três')) }, soBackend));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(dos(corrida, 'criticar').length, 2);
  assert.equal(dos(corrida, 'planejar').length, 2);
  assert.match(corrida.texto, /O crítico ainda apontava problemas no plano depois de 2 rodadas, e o plano seguiu assim\. Pontos em aberto: F1 — eu fatiaria de outro jeito/);
  assert.doesNotMatch(gh(mundo).prs.api[0].body, /crítico/, 'aviso da condução não é assunto da PR');
});

test('plano que não sai: a condução termina dizendo por quê, sem mexer em nenhum repositório', () => {
  const mundo = mundoNovo({ maestro: { tentativasPorPasso: 0, voltasDeRevisao: 1 } });
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo, { planejar: (pedido) => responder(mundo, pedido, 'RESULTADO: ok') }));
  assert.equal(corrida.fim, 'FIM');
  assert.match(corrida.texto, /^NÃO ENTREGUE — não consegui escrever um plano válido para esta tarefa\./);
  assert.match(corrida.texto, /"Escrever o plano" não fechou em 2 tentativas/);
  assert.match(corrida.texto, /O plano não foi gravado em harness\/tarefas\//);
  assert.match(corrida.texto, /Nada foi alterado nos repositórios/);
  assert.equal(git(mundo.api, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(livro(mundo).encerrado.motivo, 'sem plano');
});

test('plano aprovado à mão (pelo /planejar): o /entregar adota e conduz daí, sem refazer o preparo', () => {
  const mundo = mundoNovo();
  gravar(mundo, 'harness/tarefas/PARC-9-manual/plano.md', plano({ status: 'aprovado', fatias: [F1] }));
  gravar(mundo, 'harness/tarefas/ATUAL', 'PARC-9-manual\n');
  const corrida = operar(mundo, agentes(mundo));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(papeis(corrida), ['executar', 'revisar', 'descrever']);
  assert.equal(livro(mundo).tarefa, 'PARC-9-manual');
  // A mesma tarefa, já entregue, não é adotada de novo.
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: FIM/);
  assert.equal(dos(operar(mundo, agentes(mundo)), 'executar').length, 0);
});

test('validar-plano mostra ao planejador os erros do plano da tarefa atual', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const caminho = `harness/tarefas/${livro(mundo).tarefa}/plano.md`;
  gravar(mundo, caminho, plano().replace('- [ ] **F2 · frontend · tela de vendas**', '- [ ] **F3 · frontend · tela de vendas**'));
  const comErro = maestro(mundo, 'validar-plano');
  assert.equal(comErro.codigo, 1);
  assert.match(comErro.saida, /O plano tem 1 erro\(s\):\n- A 2ª fatia deveria se chamar F2, não F3/);
  gravar(mundo, caminho, plano());
  assert.match(maestro(mundo, 'validar-plano').saida, /^plano válido/);
});

// ------------------------------------------------------------------------- unidade de trabalho

test('o maestro confere o executor: formato do resultado, escopo e portões, e devolve o problema', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        executar: (pedido, vez, padrao) => {
          if (vez > 3) return padrao(pedido, vez);
          if (vez === 1) {
            implementar(mundo, pedido, vez);
            return responder(mundo, pedido, 'Terminei tudo e os testes passam.');
          }
          if (vez === 2) gravar(mundo, 'api/src/outro/util.js', 'exports.util = 1;\n');
          if (vez === 3) {
            destruir(join(mundo.api, 'src', 'outro'));
            gravar(mundo, 'api/src/parsers/vendas.parser.js', 'exports.parseVendas = () => "QUEBRADO";\n');
          }
          return responder(mundo, pedido, '**RESULTADO:** OK\nCOMMIT: `feat: sales parser`');
        },
      },
      soBackend,
    ),
  );

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const executores = dos(corrida, 'executar');
  assert.equal(executores.length, 4);
  assert.match(problemaDe(mundo, executores[1]), /A primeira linha tem que ser "RESULTADO: ok" ou "RESULTADO: falhou"/);
  assert.match(executores[1].parametros.Trabalho, /^corrigir, na fatia F1 · parser de vendas/);
  assert.match(problemaDe(mundo, executores[2]), /api\/src\/outro\/util\.js — fora do escopo deste trabalho: desfaça ou, se o trabalho precisa mesmo dele, declare com "ESCOPO EXTRA"/);
  assert.match(problemaDe(mundo, executores[3]), /Os portões reprovaram o que está na pasta/);
  assert.match(problemaDe(mundo, executores[3]), /FALHOU: src\/parsers\/vendas\.parser\.js/);
  assert.deepEqual(commitsDaBranch(mundo.api), ['feat: work 4 on backend'], 'só o que passou em tudo virou commit');
});

test('fora do padrão não para ninguém: o executor decide, declara, o revisor julga e a decisão vai para a PR', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const decisao = 'criei src/config/limites.js a partir de src/routes/index.js — não há arquivo de configuração no projeto — descartei pôr o limite solto no parser';
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        executar: (pedido, vez, padrao) => {
          // Hábito antigo: devolver "desvio" e esperar alguém escolher. O maestro manda decidir.
          if (vez === 1) return responder(mundo, pedido, 'RESULTADO: desvio\nDESVIO DE PADRÃO — aguardando decisão\nOpção A: … Opção B: …\nRecomendo: B');
          if (vez > 3) return padrao(pedido, vez);
          implementar(mundo, pedido, vez);
          gravar(mundo, 'api/src/config/limites.js', 'exports.limite = 10;\n');
          gravar(mundo, 'api/src/config/limites.test.js', "require('./limites');\n");
          // Limite da lei não se declara: package.json continua barrado mesmo como "escopo extra".
          if (vez === 2) gravar(mundo, 'api/package.json', `${ler(mundo, 'api/package.json')}\n`);
          if (vez === 3) git(mundo.api, 'checkout', '--', 'package.json');
          return responder(mundo, pedido, ['RESULTADO: ok', 'COMMIT: feat: sales parser with limit', '', 'Feito: parser de vendas com limite.', `**DECISÃO:** ${decisao}`, 'ESCOPO EXTRA: `api/src/config/` — o limite precisa de um lugar', 'Escopo extra: `package.json` — queria uma biblioteca', 'PENDÊNCIA: o limite deveria vir de variável de ambiente, e .env é arquivo protegido'].join('\n'));
        },
        revisar: (pedido, vez, padrao) => {
          if (vez > 1) return padrao(pedido, vez);
          const novos = pedido.caminhos('Arquivos novos');
          return responder(mundo, pedido, ['VEREDITO: APROVADO', 'ACHADOS: 0', 'COMPARAÇÃO:', ...novos.map((novo) => `- ${novo} ↔ ${/test/.test(novo) ? 'src/parsers/estoque.parser.test.js' : 'src/routes/index.js'}`)].join('\n'));
        },
      },
      soBackend,
    ),
  );

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'), 'desvio não chama o humano');
  const executores = dos(corrida, 'executar');
  assert.equal(executores.length, 3);
  assert.match(problemaDe(mundo, executores[1]), /Desvio não é resultado e não espera ninguém: decida pela seção 2 da lei/);
  assert.match(problemaDe(mundo, executores[2]), /api\/package\.json — arquivo protegido: só o humano altera/);
  assert.match(executores[2].parametros.Escopo, /`src\/parsers\/`, `src\/routes\/index\.js`, `src\/config`, `package\.json`/, 'o escopo declarado acompanha a tentativa seguinte');

  const revisao = dos(corrida, 'revisar')[0];
  assert.match(revisao.parametros['Declarado pelo autor'], /DECISÃO: criei src\/config\/limites\.js .* · ESCOPO EXTRA: src\/config/);
  assert.match(git(mundo.api, 'show', '--stat', '--format=', 'HEAD'), /src\/config\/limites\.js/);

  const corpo = gh(mundo).prs.api[0].body;
  assert.match(corpo, /## Decisões do agente\n/);
  assert.ok(corpo.includes(`- F1: ${decisao}`));
  assert.match(corpo, /## Pendências\n\nO que não fechou\. Esta PR fica em rascunho até resolver\.\n\n- F1: o limite deveria vir de variável de ambiente/);
  assert.equal(gh(mundo).prs.api[0].isDraft, true, 'com pendência, a PR não sai do rascunho');
  assert.match(corrida.texto, /Decisões que o agente tomou sozinho \(estão na descrição da PR; confira\):\n- backend: F1: criei src\/config\/limites\.js/);
  assert.match(corrida.texto, /PENDÊNCIAS — o que não fechou \(por isso a PR ficou em rascunho\):\n- backend: F1: o limite deveria vir/);
  assert.match(corrida.texto, /Falta de você: resolver as pendências acima e, depois, revisar e fazer o merge\.$/);
  assert.match(planoDaTarefa(mundo), /^Status: com pendências$/m);
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
        if (vez === 3) return responder(mundo, pedido, REPROVADO('src/parsers/vendas.parser.js:1 — nome fora do padrão — o espelho usa parseEstoque — renomeie'));
        return padrao(pedido, vez);
      },
      executar: (pedido, vez, padrao) => {
        if (vez === 2) return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: feat: sales parser');
        if (vez === 3) return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: feat: sales parser\n\nContesto: achado 1 — o nome segue o espelho (estoque.parser.js:1)');
        return padrao(pedido, vez);
      },
    }),
  );

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const revisoes = dos(corrida, 'revisar', 'backend');
  const execucoes = dos(corrida, 'executar', 'backend');
  assert.equal(revisoes.length, 4);
  assert.match(problemaDe(mundo, revisoes[1]), /Falta em COMPARAÇÃO a linha do arquivo novo `src\/parsers\/vendas\.parser\.js`/);
  assert.match(problemaDe(mundo, revisoes[2]), /\(`src\/parsers\/vendas\.parser\.test\.js`\) não existia antes deste trabalho/);
  assert.doesNotMatch(problemaDe(mundo, revisoes[2]), /vendas\.parser\.test\.js`:/, 'o par escrito com a pasta do repositório e com <-> foi aceito');
  assert.ok(execucoes[1].parametros['Achados a corrigir'].includes(revisoes[2].resultado), 'o executor recebe o parecer que reprovou');
  assert.match(problemaDe(mundo, execucoes[2]), /O revisor reprovou e nada mudou/);
  assert.ok(revisoes[3].parametros['Rodada anterior'].includes(revisoes[2].resultado));
  assert.ok(revisoes[3].parametros['Rodada anterior'].includes(execucoes[2].resultado), 'a contestação do autor chega ao revisor seguinte');
  assert.equal(revisoes[0].parametros['Idioma dos achados'], 'português');
});

test('revisor que nunca aprova: com os portões verdes o commit entra, e o ponto em aberto vai para a PR', () => {
  const mundo = mundoNovo({ maestro: { voltasDeRevisao: 1 } });
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(mundo, { revisar: (pedido) => responder(mundo, pedido, REPROVADO('src/parsers/vendas.parser.js:1 — eu chamaria de outro nome — gosto — renomeie')) }, soBackend),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  assert.equal(dos(corrida, 'revisar').length, 2);
  assert.equal(commitsDaBranch(mundo.api).length, 1);
  const { prs } = gh(mundo);
  assert.match(prs.api[0].body, /- Ponto em aberto \(F1 · parser de vendas\): depois de 2 rodadas, o revisor interno ainda apontava: src\/parsers\/vendas\.parser\.js:1 — eu chamaria de outro nome/);
  assert.equal(prs.api[0].isDraft, false, 'ponto em aberto é para o revisor humano arbitrar: não segura a PR');
  assert.doesNotMatch(prs.api[0].body, /## Pendências/);
});

test('fatia que não fecha: o maestro desfaz, guarda o que foi tentado e entrega em rascunho o que já tem commit', () => {
  const mundo = mundoNovo({ maestro: { tentativasPorPasso: 0, voltasDeRevisao: 0 } });
  iniciar(mundo);
  const caso2 = fatia('F2', 'backend', 'caso de linha vazia', '`src/parsers/`', '`src/parsers/estoque.parser.js`');
  const tela = fatia('F3', 'frontend', 'tela de vendas', '`src/telas/`', '`src/telas/Estoque.jsx`, `src/telas/Estoque.test.jsx`');
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        executar: (pedido, vez, padrao) => {
          if (vez === 1) return padrao(pedido, vez);
          gravar(mundo, 'api/src/parsers/vendas.parser.js', 'exports.parseVendas = () => "QUEBRADO";\n');
          return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: feat: empty line case');
        },
      },
      { planoDoCenario: plano({ fatias: [F1, caso2, tela] }) },
    ),
  );

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'), 'fatia que não fecha não vira pergunta');
  assert.equal(dos(corrida, 'executar').length, 3, 'F1, e as duas tentativas de F2; F3 nem começa');
  assert.deepEqual(commitsDaBranch(mundo.api), ['feat: work 1 on backend']);
  assert.equal(git(mundo.api, 'status', '--porcelain'), '', 'o que a fatia deixou foi desfeito');
  assert.doesNotMatch(ler(mundo, 'api/src/parsers/vendas.parser.js'), /QUEBRADO/);
  assert.match(ler(mundo, 'harness/.maestro/descartados/PARC-482-expor-vendas-parceiro-api/F2.patch'), /\+exports\.parseVendas = \(\) => "QUEBRADO";/, 'nada se perde: o que foi tentado fica num patch');

  const { prs } = gh(mundo);
  assert.equal(prs.api.length, 1);
  assert.equal(prs.api[0].isDraft, true);
  assert.match(prs.api[0].body, /## Pendências\n\nO que não fechou\. Esta PR fica em rascunho até resolver\.\n\n- A fatia F2 · caso de linha vazia não fechou e ficou de fora da entrega, com as fatias que vinham depois dela: "F2 · caso de linha vazia: corrigir" não fechou em 2 tentativas\. O que foi tentado está em harness\/\.maestro\/descartados\/PARC-482-expor-vendas-parceiro-api\/F2\.patch\./);
  assert.match(prs.api[0].body, /<details><summary>detalhes<\/summary>[\s\S]*FALHOU: src\/parsers\/vendas\.parser\.js/, 'o fim do log vai junto, recolhido');
  assert.equal(prs.web, undefined, 'o frontend não tinha commit: nada publicado');

  assert.match(corrida.texto, /PR de backend: #101 — 1 check verde, em rascunho/);
  assert.match(corrida.texto, /frontend: nada foi publicado\./);
  assert.match(corrida.texto, /PENDÊNCIAS — o que não fechou/);
  assert.match(corrida.texto, /\| FALHOU: src\/parsers\/vendas\.parser\.js/);
  const planoFinal = planoDaTarefa(mundo);
  assert.match(planoFinal, /^Status: com pendências$/m);
  assert.match(planoFinal, /^- \[x\] \*\*F1 · backend/m);
  assert.match(planoFinal, /^- \[ \] \*\*F2 · backend/m);
  assert.match(planoFinal, /## Pendências\n\n- backend: A fatia F2 · caso de linha vazia não fechou/);
});

test('subagente que termina sem gravar o resultado: o maestro espera, tenta de novo e, no limite, segue sem ele', () => {
  const mundo = mundoNovo({ maestro: { tentativasPorPasso: 1 } });
  iniciar(mundo);

  // Chamar "proximo" com o passo em aberto é sempre seguro: não gasta tentativa nem abre outro subagente.
  assert.match(maestro(mundo, 'proximo').saida, /AÇÃO: SUBAGENTE — Reconhecer o código para esta tarefa \(tentativa 1 de 2\)/);
  for (let i = 0; i < 2; i++) {
    const espera = maestro(mundo, 'proximo').saida;
    assert.match(espera, /AÇÃO: ESPERAR — o passo "Reconhecer o código para esta tarefa \(tentativa 1 de 2\)" ainda não tem resultado/);
    assert.match(espera, /proximo --sem-resultado/);
    assert.match(espera, /harness\/trabalho\/03-reconhecer\.pedido\.md/);
  }
  assert.equal(livro(mundo).tentativas.reconhecer, 1);
  assert.equal(livro(mundo).despachos, 1);

  const corrida = operar(mundo, agentes(mundo, { criticar: () => null }, soBackend));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  assert.equal(corrida.acoes.filter((acao) => acao === 'ESPERAR').length, 3, 'um do reconhecimento e dois do crítico');
  const criticos = dos(corrida, 'criticar');
  assert.equal(criticos.length, 2);
  assert.match(problemaDe(mundo, criticos[1]), /terminou sem gravar o arquivo de resultado/);
  assert.match(corrida.texto, /O crítico do plano não devolveu um parecer válido; o plano seguiu com a validação de formato e de espelhos/);
});

test('commit recusado pelo hook do repositório volta para o executor com a saída do hook', () => {
  const mundo = mundoNovo();
  const ganchos = join(mundo.api, '.git', 'hooks', 'commit-msg');
  writeFileSync(ganchos, '#!/bin/sh\ngrep -q "^feat: " "$1" || { echo "commitlint: the message must start with feat:" >&2; exit 1; }\n', { mode: 0o755 });
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        executar: (pedido, vez, padrao) => {
          if (vez > 1) return padrao(pedido, vez);
          implementar(mundo, pedido, vez);
          return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: sales parser added');
        },
      },
      soBackend,
    ),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const segundo = dos(corrida, 'executar')[1];
  assert.match(problemaDe(mundo, segundo), /O commit foi recusado pelos hooks do repositório/);
  assert.match(problemaDe(mundo, segundo), /commitlint: the message must start with feat:/);
  assert.deepEqual(commitsDaBranch(mundo.api), ['feat: work 2 on backend']);
});

test('executor que faz o próprio commit é revisado do mesmo jeito; o que troca de branch é desfeito e recomeça', () => {
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
          git(mundo.api, 'commit', '-q', '-m', 'feat: commit made by the executor');
        },
      },
      soBackend,
    ),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(papeis(corrida), ['reconhecer', 'planejar', 'criticar', 'executar', 'revisar', 'descrever'], 'o commit adiantado passou pela revisão do mesmo jeito');
  assert.match(dos(corrida, 'revisar')[0].parametros['Arquivos novos'], /vendas\.parser\.js/);
  assert.deepEqual(commitsDaBranch(mundo.api), ['feat: commit made by the executor']);

  const fujao = mundoNovo();
  iniciar(fujao);
  const outra = operar(
    fujao,
    agentes(
      fujao,
      {
        executar: (pedido, vez, padrao) => {
          padrao(pedido, vez);
          if (vez > 1) return;
          git(fujao.api, 'stash', '-q', '-u');
          git(fujao.api, 'checkout', '-q', 'main');
          git(fujao.api, 'stash', 'pop', '-q');
        },
      },
      soBackend,
    ),
  );
  assert.equal(outra.fim, 'FIM', outra.texto);
  assert.ok(!outra.acoes.includes('PARE'));
  const segundo = dos(outra, 'executar')[1];
  assert.match(problemaDe(fujao, segundo), /O repositório backend saiu da branch feature\/PARC-482-parser-vendas durante "F1 · parser de vendas"\. O maestro desfez tudo/);
  assert.equal(git(fujao.api, 'rev-parse', '--abbrev-ref', 'HEAD'), BRANCH);
  assert.equal(commitsDaBranch(fujao.api).length, 1);
  assert.equal(git(fujao.api, 'rev-parse', 'main'), git(fujao.api, 'rev-parse', 'origin/main'), 'a main não levou nada');
});

test('outro repositório muda durante uma fatia: o executor não é cobrado; o que é do maestro volta ao commit, e o resto fica como está, com aviso', () => {
  // Fora da tarefa (plano só de backend): pode ser o humano trabalhando ali. O maestro não toca.
  const mundo = mundoNovo();
  iniciar(mundo);
  const original = ler(mundo, 'web/src/telas/Estoque.jsx');
  const corrida = operar(
    mundo,
    agentes(
      mundo,
      {
        executar: (pedido, vez, padrao) => {
          gravar(mundo, 'web/src/telas/Estoque.jsx', `${original}// edição de quem estava trabalhando ali\n`);
          return padrao(pedido, vez);
        },
      },
      soBackend,
    ),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  assert.equal(dos(corrida, 'executar').length, 1, 'nenhuma tentativa gasta por causa do outro repositório');
  assert.match(ler(mundo, 'web/src/telas/Estoque.jsx'), /edição de quem estava trabalhando ali/, 'repositório fora da tarefa não é tocado');
  assert.match(corrida.texto, /Há mudanças sem commit em web\/ que não estavam lá quando você passou a vez\. A condução não trabalhou nesse repositório, e o maestro não mexeu nelas\. Se não foi você, um subagente editou onde não devia: confira com git -C web status\./);
  assert.equal(gh(mundo).prs.api[0].isDraft, false, 'e a entrega do backend fecha normalmente');

  // Da tarefa, e a condução já entrou nele (o backend, com a PR aberta): é do maestro, volta ao commit.
  const outro = mundoNovo();
  iniciar(outro);
  const segunda = operar(
    outro,
    agentes(outro, {
      executar: (pedido, vez, padrao) => {
        if (pedido.repo === 'frontend') gravar(outro, 'api/src/parsers/estoque.parser.js', `${ler(outro, 'api/src/parsers/estoque.parser.js')}// de passagem\n`);
        return padrao(pedido, vez);
      },
    }),
  );
  assert.equal(segunda.fim, 'FIM', segunda.texto);
  assert.equal(dos(segunda, 'executar').length, 2);
  assert.equal(git(outro.api, 'status', '--porcelain'), '');
  assert.match(segunda.texto, /Sobraram mudanças sem commit em api\/ durante "F2 · tela de vendas", que é de frontend; o maestro descartou \(estão em harness\/\.maestro\/descartados\/PARC-482-expor-vendas-parceiro-api\/backend-\d+\.patch\)\./);
  assert.equal(gh(outro).prs.web[0].isDraft, false);
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

test('portões que deixam arquivo novo na pasta: fica ignorado só nesta máquina, e a condução segue', () => {
  const mundo = mundoNovo({
    config: (config) => {
      config.repos.backend.portoes = [{ nome: 'testes', cmd: 'node conferir.js && node -e "require(\'fs\').writeFileSync(\'relatorio-de-cobertura.txt\', \'ok\')"' }];
    },
  });
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo, {}, soBackend));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  assert.match(readFileSync(join(mundo.api, '.git', 'info', 'exclude'), 'utf8'), /^\/relatorio-de-cobertura\.txt$/m);
  assert.doesNotMatch(git(mundo.api, 'show', '--stat', '--format=', 'HEAD'), /relatorio-de-cobertura/, 'o arquivo gerado não entra no commit');
  assert.equal(readFileSync(join(mundo.api, '.gitignore'), 'utf8'), 'node_modules/\n', 'nenhum arquivo versionado foi tocado para isso');
  assert.match(corrida.texto, /Os portões de backend geram arquivos que o \.gitignore não cobre \(`api\/relatorio-de-cobertura\.txt`\)\. Ficaram ignorados só nesta máquina/);
});

test('adulteração não vira pergunta: o plano volta à versão aprovada, a marca [x] é a do livro e mudança no harness fica avisada', () => {
  const mundo = mundoNovo();
  iniciar(mundo);
  const corrida = operar(
    mundo,
    agentes(mundo, {
      executar: (pedido, vez, padrao) => {
        const caminho = pedido.caminhos('Plano')[0];
        // O executor "aprova" o próprio desvio no plano, e depois afrouxa um portão na configuração.
        if (vez === 1) gravar(mundo, caminho, ler(mundo, caminho).replace('## Desvios aprovados\n', '## Desvios aprovados\n\n- `api/package.json` — preciso de uma dependência\n'));
        if (vez === 2) mudarConfig(mundo, (config) => (config.saida.linhasDeErro = 41));
        return padrao(pedido, vez);
      },
      revisar: (pedido, vez, padrao) => {
        const caminho = `harness/tarefas/${livro(mundo).tarefa}/plano.md`;
        if (vez === 1) gravar(mundo, caminho, ler(mundo, caminho).replace('- [ ] **F2', '- [x] **F2'));
        return padrao(pedido, vez);
      },
    }),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  assert.doesNotMatch(planoDaTarefa(mundo), /api\/package\.json/, 'a seção do humano voltou ao que era');
  assert.match(gh(mundo).prs.api[0].body, /Desvios aprovados pelo humano: nenhum\./);
  assert.equal(dos(corrida, 'executar', 'frontend').length, 1, 'a fatia marcada à mão foi feita mesmo assim');
  assert.match(corrida.texto, /O plano foi alterado fora do maestro durante a condução; a versão aprovada foi restaurada\./);
  assert.match(corrida.texto, /Arquivos do harness mudaram durante a condução: `harness\/config\.json`\./);
  assert.ok(existsSync(join(mundo.raiz, 'harness', '.maestro', 'conducao', 'plano.selado.md')));
});

test('condução em laço não gira para sempre: passa do teto de subagentes, desiste do que falta e encerra com pendência', () => {
  const mundo = mundoNovo({ maestro: { maximoDeDespachos: 6 } });
  iniciar(mundo);
  const corrida = operar(mundo, agentes(mundo));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  assert.equal(corrida.pedidos.length, 6);
  assert.match(corrida.texto, /a condução já abriu 6 subagentes/);
  assert.match(corrida.texto, /PENDÊNCIAS/);
  assert.equal(gh(mundo).prs.api.length, 1, 'o que já tinha commit foi publicado');
});
