// node --test testes/*.test.mjs
// O /revisar no mundo de mentira: uma branch escrita fora do harness, já publicada, é lida linha
// por linha, ajustada em commits pequenos e atualizada no GitHub, sem plano e sem perguntas.

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  agentes, commitsDaBranch, criarMolde, destruir, dos, existe, gh, git, gravar, ler, livro, maestro, mudarGh, novoMundo, operar, papeis, REPROVADO, responder,
  revisar, trabalho,
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

const PRONTA = 'feature/PARC-500-vendas';
const DESCRICAO = '## What\n\nSales parser for the partner report.\n\nWritten by a human, before any harness.';
const COM_ATALHO = '// eslint-disable-next-line\nexports.parseVendas = (linha) => ({ id: linha.id, total: linha.total });\n';
const SEM_ATALHO = 'exports.parseVendas = (linha) => ({ id: linha.id, total: linha.total });\n';

// Uma branch escrita à mão: dois arquivos novos, um atalho de lint e uma dependência que o humano
// mesmo acrescentou. Publicada, com ou sem PR aberta. O repositório volta para a main.
function branchPronta(mundo, { pr = true } = {}) {
  git(mundo.api, 'checkout', '-q', '-b', PRONTA);
  gravar(mundo, 'api/src/parsers/vendas.parser.js', COM_ATALHO);
  gravar(mundo, 'api/src/parsers/vendas.parser.test.js', "const { parseVendas } = require('./vendas.parser');\nparseVendas({ id: 1, total: 2 });\n");
  gravar(mundo, 'api/package.json', JSON.stringify({ name: 'api', dependencies: { express: '^4.0.0', 'date-fns': '^3.0.0' } }));
  git(mundo.api, 'add', '-A');
  git(mundo.api, 'commit', '-q', '-m', 'feat: sales parser');
  git(mundo.api, 'push', '-q', 'origin', PRONTA);
  git(mundo.api, 'checkout', '-q', 'main');
  if (!pr) return;
  mudarGh(mundo, (estado) => {
    estado.prs.api = [{ number: 55, url: 'https://github.example/api/pull/55', branch: PRONTA, state: 'OPEN', isDraft: true, title: 'PARC-500 sales parser', body: DESCRICAO }];
  });
}

const tiraOAtalho = (mundo) => ({
  executar: (pedido) => {
    gravar(mundo, 'api/src/parsers/vendas.parser.js', SEM_ATALHO);
    return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: refactor: drop the lint shortcut in the sales parser\n\nFeito: removed the eslint-disable; the line passes lint as written.\nDECISÃO: kept the parser signature — two callers use it — renaming was discarded');
  },
});

test('/revisar numa branch com PR aberta: lê em lotes, ajusta em commit pequeno, faz push e acrescenta à descrição que já existia', () => {
  const mundo = mundoNovo({ maestro: { guardarPassos: false } });
  branchPronta(mundo);
  const inicio = revisar(mundo, `adequar a branch ${PRONTA} ao padrão do projeto, de olho no tratamento de erro`);
  assert.equal(inicio.codigo, 0, inicio.erro);
  assert.match(inicio.saida, /Revisão da branch feature\/PARC-500-vendas iniciada \(backend\)\. Agora rode: node harness\/bin\/maestro\.mjs proximo/);
  assert.equal(livro(mundo).tarefa, 'revisao-feature-parc-500-vendas');

  const vistos = {};
  const corrida = operar(
    mundo,
    agentes(mundo, {
      ...tiraOAtalho(mundo),
      reconhecer: (pedido, vez, padrao) => {
        vistos.pedido = ler(mundo, pedido.caminhos('Pedido')[0]);
        return padrao(pedido, vez);
      },
      revisarPr: (pedido) => {
        vistos.mapa = ler(mundo, pedido.caminhos('Mapa do código')[0]);
        vistos.pedidoDoHumano = ler(mundo, pedido.caminhos('Pedido do humano')[0]);
        return responder(mundo, pedido, REPROVADO('src/parsers/vendas.parser.js:1 — eslint-disable — limite da lei — tire o atalho e corrija a linha'));
      },
    }),
  );

  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  assert.deepEqual(papeis(corrida), ['reconhecer', 'revisarPr', 'executar', 'revisar'], 'sem plano, sem crítica, sem QA e sem redator: a PR já tem descrição');

  // O reconhecimento olha a branch, já com o repositório nela, e o mapa chega ao revisor do lote.
  const reconhecimento = dos(corrida, 'reconhecer')[0];
  assert.match(reconhecimento.parametros.Trabalho, /revisar a branch `feature\/PARC-500-vendas`, que já está escrita/);
  assert.match(reconhecimento.parametros['O que a branch mudou'], /^`git -C api diff --stat [0-9a-f]{40}\.\.\.HEAD`$/);
  assert.equal(reconhecimento.parametros.Repositórios, 'backend (pasta `api`)');
  assert.match(vistos.pedido, /de olho no tratamento de erro/);
  assert.match(vistos.pedidoDoHumano, /de olho no tratamento de erro/);
  assert.match(vistos.mapa, /## Entrega mais parecida/);

  const leitura = dos(corrida, 'revisarPr')[0];
  assert.equal(leitura.parametros['Arquivos do lote'], '`src/parsers/vendas.parser.js`, `src/parsers/vendas.parser.test.js`', 'arquivo protegido não entra em lote');
  assert.match(leitura.parametros['O que a catraca achou neste lote'], /\[BLOQUEIO\] api\/src\/parsers\/vendas\.parser\.js:1 — desliga o lint \(eslint-disable\)/);
  assert.equal(leitura.parametros.Plano, '(não há plano)');
  const ajuste = dos(corrida, 'executar')[0];
  assert.equal(ajuste.parametros.Plano, '(não há plano: o trabalho é o que os achados pedem)');
  assert.equal(ajuste.parametros.Escopo, '`src/parsers`');
  assert.match(ajuste.parametros['Mapa do código'], /^`harness\/trabalho\/\d+-mapa\.md`$/);

  // Commit pequeno por cima do que existia, publicado na mesma branch.
  assert.deepEqual(commitsDaBranch(mundo.api, PRONTA), ['refactor: drop the lint shortcut in the sales parser', 'feat: sales parser']);
  assert.equal(git(mundo.api, 'rev-parse', 'HEAD'), git(mundo.api, 'rev-parse', `origin/${PRONTA}`));
  assert.equal(git(mundo.api, 'status', '--porcelain'), '');

  // A descrição que existia fica como estava; o que foi feito entra embaixo.
  const { prs, chamadas } = gh(mundo);
  assert.equal(prs.api.length, 1);
  const corpo = prs.api[0].body;
  assert.ok(corpo.startsWith(`${DESCRICAO}\n\n---\n\n## Revisão automática — `), corpo);
  assert.match(corpo, /## Revisão automática — \d{4}-\d\d-\d\d\n\nRevisão linha por linha desta branch contra o padrão do projeto: 2 arquivo\(s\) em 1 lote\(s\)\./);
  assert.match(corpo, /Mudanças enviadas:\n- `[0-9a-f]{7}` refactor: drop the lint shortcut in the sales parser — removed the eslint-disable; the line passes lint as written\./);
  assert.match(corpo, /### Decisões do agente\n[\s\S]*- Revisão: kept the parser signature — two callers use it — renaming was discarded/);
  assert.match(corpo, /### Provas \(geradas pelo harness, não pelo modelo\)\n\n- Portões locais \(testes\): verdes para o commit [0-9a-f]{7}\./);
  assert.equal(prs.api[0].title, 'PARC-500 sales parser', 'o título é de quem abriu a PR');
  assert.equal(prs.api[0].isDraft, true, 'numa revisão o maestro não muda o rascunho: a PR é de quem abriu');
  assert.ok(!chamadas.some((chamada) => /pr (create|ready)/.test(chamada)));
  assert.ok(chamadas.some((chamada) => chamada.startsWith('api: pr checks 55')), 'os checks do push são acompanhados');

  assert.match(corrida.texto, /^REVISÃO — Revisão da branch feature\/PARC-500-vendas\n\nPR de backend: #55 — 1 check verde, em rascunho — https:\/\/github\.example\/api\/pull\/55/);
  assert.match(corrida.texto, /Commits:\n- backend [0-9a-f]{7} refactor: drop the lint shortcut in the sales parser/);

  // Nada de pasta de tarefa nem de arquivo solto: a revisão não deixa rastro fora do GitHub.
  assert.deepEqual(readdirSync(join(mundo.raiz, 'harness', 'tarefas')).filter((nome) => nome !== '.gitkeep'), []);
  assert.deepEqual(trabalho(mundo), []);
  assert.ok(!existe(mundo, 'harness/tarefas/ATUAL'));

  // Revisar de novo acrescenta outra seção; a primeira e a descrição original continuam lá.
  assert.equal(revisar(mundo, `/revisar ${PRONTA}`).codigo, 0);
  const segunda = operar(mundo, agentes(mundo));
  assert.equal(segunda.fim, 'FIM', segunda.texto);
  assert.deepEqual(papeis(segunda), ['reconhecer', 'revisarPr']);
  const depois = gh(mundo).prs.api[0].body;
  assert.ok(depois.startsWith(corpo.trimEnd()), 'o que já estava na descrição não muda');
  assert.equal(depois.match(/## Revisão automática — /g).length, 2);
  assert.match(depois, /Nenhuma mudança foi necessária\.\n\n### Provas/);
  assert.match(segunda.texto, /Nenhum commit novo\./);
});

test('/revisar acha sozinho o que revisar: o nome no meio do pedido, o número da PR ou a branch em uso; e diz o que falta quando não acha', () => {
  const mundo = mundoNovo();
  branchPronta(mundo);
  const alvoDe = (pedido) => {
    const r = revisar(mundo, pedido);
    assert.equal(r.codigo, 0, r.erro);
    const { revisao } = livro(mundo);
    maestro(mundo, 'encerrar');
    return revisao;
  };

  assert.deepEqual(alvoDe(`dá uma olhada na ${PRONTA}.`), { branch: PRONTA, repos: ['backend'] });
  assert.deepEqual(alvoDe('revisa a PR #55 por favor'), { branch: PRONTA, repos: ['backend'] });
  assert.deepEqual(alvoDe('https://github.com/acme/api/pull/55'), { branch: PRONTA, repos: ['backend'] }, 'link de outro dono: vale o número, no repositório que tiver a PR');

  // Sem nome e sem número, vale a branch em que o repositório está.
  git(mundo.api, 'checkout', '-q', PRONTA);
  assert.deepEqual(alvoDe('revisar a branch atual'), { branch: PRONTA, repos: ['backend'] });
  git(mundo.api, 'checkout', '-q', 'main');

  const semAlvo = revisar(mundo, 'revisar a branch atual');
  assert.equal(semAlvo.codigo, 2);
  assert.match(semAlvo.erro, /Não achei a branch para revisar\. Diga o nome exato dela ou o número da PR: \/revisar <branch ou PR>\./);
  assert.match(semAlvo.saida, /AÇÃO: PARE/, 'o operador mostra o erro ao humano em vez de adivinhar');
  assert.match(revisar(mundo, 'revisar a main').erro, /Não achei a branch para revisar/, 'branch base não é alvo de revisão');

  // Uma branch sem nada à frente da base não tem o que revisar.
  git(mundo.web, 'branch', 'feature/vazia');
  assert.match(revisar(mundo, 'revisar feature/vazia').erro, /A branch feature\/vazia não tem commit à frente da base em nenhum repositório/);
});

test('/revisar numa branch sem PR: abre a PR com descrição, em rascunho, mesmo sem nada a ajustar', () => {
  const mundo = mundoNovo();
  branchPronta(mundo, { pr: false });
  assert.equal(revisar(mundo, PRONTA).codigo, 0);
  const corrida = operar(mundo, agentes(mundo));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.deepEqual(papeis(corrida), ['reconhecer', 'revisarPr', 'descrever']);
  const redator = dos(corrida, 'descrever')[0];
  assert.match(redator.parametros.Plano, /não há plano: descreva pelo diff e pelos commits da branch/);

  const { prs, chamadas } = gh(mundo);
  assert.equal(prs.api.length, 1);
  assert.ok(chamadas.some((chamada) => /^api: pr create .*--draft/.test(chamada)));
  assert.equal(prs.api[0].isDraft, true, 'quem tira do rascunho uma PR de revisão é o humano');
  assert.match(prs.api[0].body, /^## O que e por quê[\s\S]*\n---\n\n## Revisão automática — /);
  assert.match(prs.api[0].body, /Nenhuma mudança foi necessária\./);
  assert.match(corrida.texto, /PR de backend: #101 — 1 check verde, em rascunho/);
});

test('/revisar com a PR em inglês (o padrão): o que entra na descrição sai em inglês, e o relatório para o humano, em português', () => {
  const mundo = mundoNovo({ config: (dados) => delete dados.convencoes.idiomaDaPr });
  branchPronta(mundo);
  assert.equal(revisar(mundo, PRONTA).codigo, 0);
  const corrida = operar(
    mundo,
    agentes(mundo, { ...tiraOAtalho(mundo), revisarPr: (pedido) => responder(mundo, pedido, REPROVADO('src/parsers/vendas.parser.js:1 — eslint-disable — law limit — drop the shortcut')) }),
  );
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.equal(dos(corrida, 'revisarPr')[0].parametros['Idioma dos achados'], 'inglês');
  const corpo = gh(mundo).prs.api[0].body;
  assert.match(corpo, /\n---\n\n## Automated review — \d{4}-\d\d-\d\d\n\nLine-by-line review of this branch against the project pattern: 2 file\(s\) in 1 batch\(es\)\./);
  assert.match(corpo, /Changes pushed:\n- `[0-9a-f]{7}` refactor: drop the lint shortcut in the sales parser — removed the eslint-disable/);
  assert.match(corpo, /### Decisions made by the agent\n[\s\S]*- Review: kept the parser signature — two callers use it — renaming was discarded/);
  assert.match(corpo, /### Proofs \(generated by the harness, not by the model\)\n\n- Local gates \(testes\): green for commit [0-9a-f]{7}\./);
  assert.doesNotMatch(corpo.slice(DESCRICAO.length), /Revisão|Decisões|Provas|Mudanças/, 'nada do harness em português numa PR em inglês');
  assert.match(corrida.texto, /^REVISÃO — Revisão da branch feature\/PARC-500-vendas/);
  assert.match(corrida.texto, /- backend: Revisão: kept the parser signature/);
});

test('/revisar julga só o que ele mesmo mudou: o que a branch já trazia vai para o revisor do lote, não barra a publicação', () => {
  const mundo = mundoNovo();
  branchPronta(mundo);
  assert.equal(revisar(mundo, PRONTA).codigo, 0);
  // O revisor do lote deixa passar o atalho antigo e o package.json que o humano mudou.
  const corrida = operar(mundo, agentes(mundo));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(!corrida.acoes.includes('PARE'));
  assert.deepEqual(papeis(corrida), ['reconhecer', 'revisarPr']);
  const corpo = gh(mundo).prs.api[0].body;
  assert.match(corpo, /Portões locais \(testes\): verdes/);
  assert.match(corpo, /Catraca do diff: 0 bloqueios\./);
  assert.doesNotMatch(corpo, /Pendências/);
  assert.match(ler(mundo, 'api/src/parsers/vendas.parser.js'), /eslint-disable/, 'o que ninguém apontou continua como estava');

  // O ajuste da revisão, esse sim, passa pela catraca inteira: atalho novo não entra.
  assert.equal(revisar(mundo, PRONTA).codigo, 0);
  const comAtalhoNovo = operar(
    mundo,
    agentes(mundo, {
      revisarPr: (pedido) => responder(mundo, pedido, REPROVADO('src/parsers/vendas.parser.test.js:2 — o teste não confere o resultado — teste-espelho — acrescente a asserção')),
      executar: (pedido, vez) => {
        gravar(mundo, 'api/src/parsers/vendas.parser.test.js', vez === 1 ? "// @ts-ignore\nrequire('./vendas.parser');\n" : "require('./vendas.parser').parseVendas({ id: 1, total: 2 });\n");
        return responder(mundo, pedido, 'RESULTADO: ok\nCOMMIT: test: assert the sales parser result');
      },
    }),
  );
  assert.equal(comAtalhoNovo.fim, 'FIM', comAtalhoNovo.texto);
  assert.equal(dos(comAtalhoNovo, 'executar').length, 2);
  assert.match(ler(mundo, dos(comAtalhoNovo, 'executar')[1].caminhos('Achados a corrigir').pop()), /vendas\.parser\.test\.js:1 — desliga o TypeScript/);
});

test('/revisar: se o "gh pr edit" falhar, a descrição entra pela API; se nem assim, o texto fica guardado e o aviso diz onde', () => {
  const mundo = mundoNovo();
  branchPronta(mundo);
  mudarGh(mundo, (estado) => (estado.falharAoEditar = true));
  assert.equal(revisar(mundo, PRONTA).codigo, 0);
  const corrida = operar(mundo, agentes(mundo));
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  const { prs, chamadas } = gh(mundo);
  assert.match(prs.api[0].body, /## Revisão automática — /, 'a descrição foi atualizada pelo segundo caminho');
  assert.ok(chamadas.some((chamada) => /^api: api --method PATCH repos\/\{owner\}\/\{repo\}\/pulls\/55 -F body=@/.test(chamada)));
  assert.doesNotMatch(corrida.texto, /Não consegui atualizar a descrição/);
});

test('/revisar respeita o que é do humano: mudança sem commit bloqueia antes de qualquer leitura', () => {
  const mundo = mundoNovo();
  branchPronta(mundo);
  gravar(mundo, 'api/anotacoes.txt', 'ainda estou mexendo\n');
  assert.equal(revisar(mundo, PRONTA).codigo, 0);
  const pares = [];
  const corrida = operar(mundo, agentes(mundo), {
    humano: (pare) => {
      if (pares.push(pare) > 1) return null;
      destruir(join(mundo.api, 'anotacoes.txt'));
      return true;
    },
  });
  assert.match(pares[0], /^BLOQUEIO — Há mudanças sem commit em api\/, e elas são suas/);
  assert.match(pares[0], /Para ver: git -C api status --short\nPara guardar tudo: git -C api stash -u/);
  assert.equal(corrida.acoes[0], 'PARE', 'antes de qualquer subagente');
  assert.equal(corrida.fim, 'FIM', corrida.texto);
  assert.ok(existsSync(join(mundo.api, 'src', 'parsers', 'vendas.parser.js')), 'depois do bloqueio liberado, o repositório entrou na branch');
});
