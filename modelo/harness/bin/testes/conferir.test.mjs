// node --test harness/bin/testes/*.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extrairDesvios, globParaRegex } from '../config.mjs';
import { avaliar, formatarAchado, lerDiff } from '../conferir.mjs';

const configPadrao = JSON.parse(readFileSync(new URL('../../config.json', import.meta.url), 'utf8'));

function arquivo(caminho, linhas = [], extras = {}) {
  return {
    caminho,
    novo: false,
    removido: false,
    removidas: 0,
    pastaNova: false,
    adicionadas: linhas.map((texto, indice) => ({ n: indice + 1, texto })),
    ...extras,
  };
}

function conferir(arquivos, { config = configPadrao, somenteEspaco = 0, ...regras } = {}) {
  const achados = avaliar({ arquivos, somenteEspaco }, { config, modo: 'fatia', prefixo: 'backend/', ...regras });
  return achados.map(formatarAchado);
}

test('lerDiff separa arquivos, linhas adicionadas e numeração', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,2 +10,3 @@ function a() {',
    '-  antiga();',
    '-  outra();',
    '+  nova();',
    '+++contador;',
    '+  fim();',
    'diff --git a/src/novo.ts b/src/novo.ts',
    'new file mode 100644',
    'index 0000000..3333333',
    '--- /dev/null',
    '+++ b/src/novo.ts',
    '@@ -0,0 +1 @@',
    '+export const x = 1;',
    'diff --git a/src/velho.ts b/src/velho.ts',
    'deleted file mode 100644',
    'index 4444444..0000000',
    '--- a/src/velho.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-a',
    '-b',
    'diff --git a/src/de.ts b/src/para.ts',
    'similarity index 100%',
    'rename from src/de.ts',
    'rename to src/para.ts',
  ].join('\n');

  const [alterado, novo, removido, renomeado] = lerDiff(diff);
  assert.equal(alterado.caminho, 'src/a.ts');
  assert.deepEqual(alterado.adicionadas, [
    { n: 10, texto: '  nova();' },
    { n: 11, texto: '++contador;' },
    { n: 12, texto: '  fim();' },
  ]);
  assert.equal(alterado.removidas, 2);
  assert.equal(novo.novo, true);
  assert.equal(removido.caminho, 'src/velho.ts');
  assert.equal(removido.removido, true);
  assert.equal(renomeado.caminho, 'src/para.ts');
});

test('verificação desligada bloqueia só em linha adicionada de código', () => {
  const achados = conferir([
    arquivo('src/a.ts', ['// eslint-disable-next-line no-console', 'const x: any = 1; // NOSONAR']),
    arquivo('src/a.test.ts', ['it.only("foca", () => {});']),
    arquivo('docs/guia.md', ['use eslint-disable com cuidado']),
  ]);
  assert.deepEqual(achados, [
    '[BLOQUEIO] backend/src/a.ts:1 — desliga o lint (eslint-disable)',
    '[BLOQUEIO] backend/src/a.ts:2 — desliga o Sonar (NOSONAR)',
    '[BLOQUEIO] backend/src/a.test.ts:1 — teste focado ou pulado',
  ]);
});

test('arquivo protegido bloqueia, e o plano libera o que o humano aprovou', () => {
  const arquivos = [arquivo('package.json', ['    "date-fns": "^3.0.0",']), arquivo('.github/workflows/ci.yml', ['x'])];
  assert.deepEqual(conferir(arquivos), [
    '[BLOQUEIO] backend/package.json — arquivo protegido: só o humano altera (lei, seção 2)',
    '[BLOQUEIO] backend/.github/workflows/ci.yml — arquivo protegido: só o humano altera (lei, seção 2)',
  ]);
  assert.deepEqual(conferir(arquivos, { liberados: ['backend/package.json'] }), [
    '[liberado] backend/package.json — arquivo protegido: só o humano altera (lei, seção 2)',
    '[BLOQUEIO] backend/.github/workflows/ci.yml — arquivo protegido: só o humano altera (lei, seção 2)',
  ]);
});

test('camada que importa o que não pode é bloqueio', () => {
  const config = {
    ...configPadrao,
    camadas: [{ em: 'backend/src/domain/', naoImporta: ['/infra/', 'express'], motivo: 'domínio não conhece infraestrutura' }],
  };
  const achados = conferir(
    [
      arquivo('src/domain/venda.ts', ["import { db } from '../infra/db';", "import { soma } from './soma';"]),
      arquivo('src/infra/rota.ts', ["import express from 'express';"]),
    ],
    { config },
  );
  assert.deepEqual(achados, [
    '[BLOQUEIO] backend/src/domain/venda.ts:1 — importa "../infra/db": domínio não conhece infraestrutura',
  ]);
});

test('escopo da fatia: o que está fora é bloqueio', () => {
  const arquivos = [arquivo('src/parsers/vendas.ts', ['x']), arquivo('src/utils/data.ts', ['x'])];
  assert.deepEqual(conferir(arquivos, { escopo: ['backend/src/parsers/'] }), [
    '[BLOQUEIO] backend/src/utils/data.ts — fora do escopo deste trabalho: desfaça ou, se o trabalho precisa mesmo dele, declare com "ESCOPO EXTRA" no resultado',
  ]);
  assert.deepEqual(conferir(arquivos, { escopo: ['src/parsers', 'src/utils/data.ts'] }), []);
});

test('avisos: tamanho da fatia, comentários, reformatação, pasta nova e arquivo novo sem teste', () => {
  const muitasLinhas = Array.from({ length: 201 }, (_, i) => `const v${i} = ${i};`);
  const comentarios = Array.from({ length: 7 }, (_, i) => `// passo ${i}`);
  const achados = conferir(
    [
      arquivo('src/grande.ts', muitasLinhas),
      arquivo('src/falante.ts', comentarios),
      arquivo('src/helpers/novo.ts', ['export const a = 1;'], { novo: true, pastaNova: true }),
      arquivo('src/parsers/vendas.ts', ['export const b = 1;'], { novo: true }),
      arquivo('src/parsers/vendas.test.ts', ['it("ok", () => {});'], { novo: true }),
      arquivo('src/parsers/index.ts', ["export * from './vendas';"], { novo: true }),
    ],
    { somenteEspaco: 30 },
  );
  assert.deepEqual(achados, [
    '[aviso] fatia maior que o alvo: 211 linhas (alvo: 150), sem contar testes. Não bloqueia.',
    '[aviso] 7 linhas de comentário novas (máximo 6): deixe só o porquê que o código não diz.',
    '[aviso] 30 linhas mudaram só em espaço/formatação: desfaça o que não é da tarefa.',
    '[aviso] backend/src/helpers — pasta nova: confirme que a receita do padrão prevê',
    '[aviso] backend/src/helpers/novo.ts — arquivo novo sem teste novo: o Sonar cobra cobertura em código novo',
  ]);
});

test('PR não tem orçamento: o tamanho do diff inteiro nunca vira aviso nem bloqueio', () => {
  const enorme = Array.from({ length: 30 }, (_, i) => arquivo(`src/modulo${i}/arquivo.ts`, Array.from({ length: 200 }, (__, j) => `const v${j} = ${j};`)));
  const achados = avaliar({ arquivos: enorme, somenteEspaco: 0 }, { config: configPadrao, modo: 'pr', prefixo: 'backend/' }).map(formatarAchado);
  assert.deepEqual(achados, [], '6000 linhas em 30 arquivos: nada a dizer sobre tamanho');
  assert.equal(configPadrao.orcamento.pr, undefined);
});

test('pastasLivres dispensa o aviso de pasta nova', () => {
  const config = { ...configPadrao, pastasLivres: ['backend/src/usecases/'] };
  const arquivos = [
    arquivo('src/usecases/vendas/listar.ts', ['x'], { novo: true, pastaNova: true }),
    arquivo('src/usecases/vendas/listar.test.ts', ['x'], { novo: true, pastaNova: true }),
  ];
  assert.deepEqual(conferir(arquivos, { config }), []);
});

test('globParaRegex: sem barra vale em qualquer pasta; com barra é ancorado', () => {
  assert.ok(globParaRegex('package.json').test('apps/web/package.json'));
  assert.ok(globParaRegex('tsconfig*.json').test('tsconfig.build.json'));
  assert.ok(globParaRegex('.env*').test('.env.example'));
  assert.ok(globParaRegex('.github/**').test('.github/workflows/ci.yml'));
  assert.ok(!globParaRegex('.github/**').test('docs/.github/x.yml'));
  assert.ok(!globParaRegex('package.json').test('src/package.json.ts'));
  assert.ok(globParaRegex('release/*', { inteiro: true }).test('release/1.2'));
  assert.ok(!globParaRegex('main', { inteiro: true }).test('feature/main'));
});

test('extrairDesvios lê os caminhos entre crases da seção do plano', () => {
  const plano = [
    '# ABC-1',
    '## Fatias',
    '- Escopo: `src/x`',
    '## Desvios aprovados',
    '<!-- exemplo: `nao/conta` -->',
    '- `frontend/package.json` e `frontend/package-lock.json` — date-fns — Tarcio, 25/11',
    '## Estado',
    '- `tambem/nao`',
  ].join('\n');
  assert.deepEqual(extrairDesvios(plano), ['frontend/package.json', 'frontend/package-lock.json']);
});
