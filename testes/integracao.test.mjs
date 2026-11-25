// node --test testes/*.test.mjs
// Instala o harness numa raiz temporária com dois repositórios de mentira e exercita
// os hooks nos três formatos (Cursor, Claude Code, Codex).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_DO_HARNESS = join(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALADOR = join(REPO_DO_HARNESS, 'instalar.mjs');
const AUTOR = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev' };

let raiz;
// A memória da catraca fica na pasta temporária do sistema: cada execução usa conversas só dela.
const CONVERSA = `c-cursor-${process.pid}-${Date.now()}`;
const OUTRA_CONVERSA = `c-outra-${process.pid}-${Date.now()}`;

function rodar(programa, args, opcoes = {}) {
  const r = spawnSync(programa, args, { encoding: 'utf8', env: { ...process.env, ...AUTOR }, ...opcoes });
  return { codigo: r.status, saida: r.stdout, erro: r.stderr };
}

function criarRepo(pasta, dependencias) {
  const caminho = join(raiz, pasta);
  mkdirSync(join(caminho, 'src'), { recursive: true });
  writeFileSync(join(caminho, 'package.json'), JSON.stringify({ name: pasta, dependencies: dependencias }));
  writeFileSync(join(caminho, 'src', 'a.ts'), 'export const a = 1;\n');
  rodar('git', ['init', '-q', '-b', 'main'], { cwd: caminho });
  rodar('git', ['add', '-A'], { cwd: caminho });
  rodar('git', ['commit', '-q', '-m', 'base'], { cwd: caminho });
  rodar('git', ['checkout', '-q', '-b', 'feature/x'], { cwd: caminho });
}

function instalar(...args) {
  return rodar('node', [INSTALADOR, raiz, ...args]);
}

function hook(evento, formato, entrada) {
  const r = rodar('node', [join(raiz, 'harness', 'bin', 'hook.mjs'), evento, '--formato', formato], {
    cwd: raiz,
    input: JSON.stringify(entrada),
  });
  assert.equal(r.codigo, 0, r.erro);
  return JSON.parse(r.saida);
}

const noCursor = (command) => ({ hook_event_name: 'beforeShellExecution', command, cwd: join(raiz, 'api-x') });
const noClaude = (command, tool_name = 'Bash') => ({
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  cwd: join(raiz, 'api-x'),
  tool_name,
  tool_input: { command },
});

before(() => {
  raiz = mkdtempSync(join(tmpdir(), 'harness-teste-'));
  criarRepo('api-x', { express: '^4.0.0' });
  criarRepo('web-x', { react: '^18.0.0', 'react-scripts': '5.0.1' });
});

after(() => rmSync(raiz, { recursive: true, force: true }));

test('instala a base e os adaptadores pedidos, e reconhece backend e frontend', () => {
  const r = instalar('--com', 'claude,codex');
  assert.equal(r.codigo, 0, r.erro);
  assert.match(r.saida, /backend → api-x · frontend → web-x/);
  assert.match(r.saida, /conflitos: 0/);

  for (const arquivo of [
    'AGENTS.md',
    'CLAUDE.md',
    '.agents/skills/conferir/SKILL.md',
    '.agents/skills/fatia/agents/openai.yaml',
    '.cursor/hooks.json',
    '.cursor/agents/revisor.md',
    '.claude/settings.json',
    '.claude/commands/fatia.md',
    '.codex/hooks.json',
    'harness/bin/portoes.mjs',
    'harness/bin/maestro.mjs',
    'harness/roteiros/revisor.md',
    'harness/roteiros/maestro/executar.md',
    '.agents/skills/entregar/SKILL.md',
    '.cursor/agents/maestro-passo.md',
    '.claude/agents/maestro-passo.md',
    '.claude/commands/entregar.md',
    'harness/.instalado.json',
  ]) {
    assert.ok(existsSync(join(raiz, arquivo)), `faltou ${arquivo}`);
  }

  const config = JSON.parse(readFileSync(join(raiz, 'harness', 'config.json'), 'utf8'));
  assert.equal(config.repos.backend.dir, 'api-x');
  assert.equal(config.repos.frontend.dir, 'web-x');
  assert.match(readFileSync(join(raiz, '.cursor', 'rules', 'padrao-frontend.mdc'), 'utf8'), /globs: web-x\/\*\*/);

  const hooksDoCodex = JSON.parse(readFileSync(join(raiz, '.codex', 'hooks.json'), 'utf8'));
  assert.ok(hooksDoCodex.hooks.Stop[0].hooks[0].command.includes(join(raiz, 'harness', 'bin', 'hook.mjs')));
});

test('guarda de shell: mesma decisão, resposta no formato de cada ferramenta', () => {
  const atalho = 'git commit -m "x" --no-verify';
  assert.equal(hook('shell', 'cursor', noCursor(atalho)).permission, 'deny');
  assert.equal(hook('shell', 'claude', noClaude(atalho)).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(hook('shell', 'codex', noClaude(atalho)).hookSpecificOutput.permissionDecision, 'deny');

  assert.deepEqual(hook('shell', 'cursor', noCursor('git status')), { permission: 'allow' });
  assert.deepEqual(hook('shell', 'claude', noClaude('git status')), {});
  assert.deepEqual(hook('shell', 'codex', noClaude('git status')), {});
});

test('o que pede confirmação vira "ask" no Cursor e no Claude Code e bloqueio no Codex', () => {
  const descarta = 'git reset --hard';
  assert.equal(hook('shell', 'cursor', noCursor(descarta)).permission, 'ask');
  assert.equal(hook('shell', 'claude', noClaude(descarta)).hookSpecificOutput.permissionDecision, 'ask');
  const noCodex = hook('shell', 'codex', noClaude(descarta)).hookSpecificOutput;
  assert.equal(noCodex.permissionDecision, 'deny');
  assert.match(noCodex.permissionDecisionReason, /Peça ao humano/);
});

test('patch de edição não é julgado como comando de shell', () => {
  assert.deepEqual(hook('shell', 'codex', noClaude('*** docs: git push --force', 'apply_patch')), {});
});

test('fim de turno: cobra bloqueio novo uma vez, repete para o mesmo evento e depois silencia', () => {
  writeFileSync(join(raiz, 'api-x', 'src', 'a.ts'), '// eslint-disable-next-line\nexport const a = 1;\n');

  const cursor = hook('parar', 'cursor', { status: 'completed', loop_count: 0, conversation_id: CONVERSA });
  assert.match(cursor.followup_message, /api-x\/src\/a\.ts:1 — desliga o lint/);
  const mesmoEvento = hook('parar', 'claude', { session_id: CONVERSA, stop_hook_active: false });
  assert.equal(mesmoEvento.decision, 'block');
  assert.equal(mesmoEvento.reason, cursor.followup_message);

  // Turno interrompido pelo humano não é cobrado. Outra conversa é cobrada pela conta dela,
  // venha ou não de uma continuação: quem limita a repetição é a memória do hook, não o contador da ferramenta.
  assert.deepEqual(hook('parar', 'cursor', { status: 'aborted', loop_count: 0, conversation_id: OUTRA_CONVERSA }), {});
  assert.match(hook('parar', 'codex', { session_id: OUTRA_CONVERSA, stop_hook_active: true }).reason, /desliga o lint/);

  const memoria = join(tmpdir(), 'harness-catraca', `${CONVERSA}.json`);
  const lembranca = JSON.parse(readFileSync(memoria, 'utf8'));
  writeFileSync(memoria, JSON.stringify({ ...lembranca, quando: lembranca.quando - 60000 }));
  assert.deepEqual(hook('parar', 'cursor', { status: 'completed', loop_count: 0, conversation_id: CONVERSA }), {});

  // Lista diferente é cobrada de novo, até três seguidas; depois o hook se cala até o diff ficar limpo.
  for (const [vez, resto] of ['debugger;', '// NOSONAR'].entries()) {
    writeFileSync(join(raiz, 'api-x', 'src', 'a.ts'), `// eslint-disable-next-line\n${resto}\nexport const a = ${vez};\n`);
    assert.match(hook('parar', 'cursor', { status: 'completed', loop_count: vez + 1, conversation_id: CONVERSA }).followup_message, /2 bloqueio\(s\)/);
  }
  writeFileSync(join(raiz, 'api-x', 'src', 'a.ts'), 'debugger;\nexport const a = 9;\n');
  assert.deepEqual(hook('parar', 'cursor', { status: 'completed', loop_count: 3, conversation_id: CONVERSA }), {});

  rodar('git', ['checkout', '-q', '--', 'src/a.ts'], { cwd: join(raiz, 'api-x') });
  assert.deepEqual(hook('parar', 'cursor', { status: 'completed', loop_count: 0, conversation_id: CONVERSA }), {});
  assert.ok(!existsSync(memoria));
});

test('aviso de compactação em cada formato', () => {
  assert.match(hook('compactar', 'cursor', { context_usage_percent: 91.2 }).user_message, /uso em 91%/);
  assert.match(hook('compactar', 'claude', { trigger: 'auto' }).systemMessage, /conversa nova/);
});

test('reinstalar atualiza o motor, preserva o que é do projeto e não atropela o que foi editado', () => {
  const lei = join(raiz, 'AGENTS.md');
  const config = join(raiz, 'harness', 'config.json');
  const guarda = join(raiz, 'harness', 'bin', 'guarda.mjs');
  writeFileSync(lei, `${readFileSync(lei, 'utf8')}\nRegra só minha.\n`);
  writeFileSync(config, readFileSync(config, 'utf8').replace('"linhas": 200', '"linhas": 150'));

  // Simula versão antiga do motor: arquivo diferente do pacote, mas igual ao que o manifesto registrou.
  const manifesto = join(raiz, 'harness', '.instalado.json');
  const registro = JSON.parse(readFileSync(manifesto, 'utf8'));
  const antigo = '// versão antiga\n';
  writeFileSync(guarda, antigo);
  registro.arquivos['harness/bin/guarda.mjs'] = rodar('node', [
    '-e',
    `process.stdout.write(require('crypto').createHash('sha1').update(${JSON.stringify(antigo)}).digest('hex'))`,
  ]).saida;
  writeFileSync(manifesto, JSON.stringify(registro));

  const r = instalar('--com', 'claude,codex');
  assert.match(r.saida, /atualizados: 1 .* do projeto, mantidos: 1 · conflitos: 1/);
  assert.match(r.saida, /AGENTS\.md {2}→ {2}junte à mão/);
  assert.match(readFileSync(lei, 'utf8'), /Regra só minha/);
  assert.ok(existsSync(`${lei}.novo`));
  assert.match(readFileSync(config, 'utf8'), /"linhas": 150/);
  assert.notEqual(readFileSync(guarda, 'utf8'), antigo);
});

test('sem --com, só a base do Cursor é instalada', () => {
  const outraRaiz = mkdtempSync(join(tmpdir(), 'harness-teste-'));
  try {
    const r = rodar('node', [INSTALADOR, outraRaiz]);
    assert.equal(r.codigo, 0, r.erro);
    assert.match(r.saida, /não deu para decidir sozinho/);
    assert.ok(existsSync(join(outraRaiz, '.cursor', 'hooks.json')));
    assert.ok(existsSync(join(outraRaiz, '.agents', 'skills', 'mapear', 'SKILL.md')));
    for (const arquivo of ['CLAUDE.md', '.claude', '.codex']) assert.ok(!existsSync(join(outraRaiz, arquivo)), arquivo);
  } finally {
    rmSync(outraRaiz, { recursive: true, force: true });
  }
});

test('ao atualizar, o instalador fala da raiz como ela está: repositórios do config e só o que falta mapear', () => {
  const outraRaiz = mkdtempSync(join(tmpdir(), 'harness-teste-'));
  const regra = (repo) => join(outraRaiz, '.cursor', 'rules', `padrao-${repo}.mdc`);
  try {
    // Dois repositórios que o instalador não sabe distinguir: nenhum depende de biblioteca de interface.
    for (const pasta of ['api', 'web']) {
      mkdirSync(join(outraRaiz, pasta));
      writeFileSync(join(outraRaiz, pasta, 'package.json'), JSON.stringify({ name: pasta }));
      rodar('git', ['init', '-q', '-b', 'main'], { cwd: join(outraRaiz, pasta) });
    }
    const primeira = rodar('node', [INSTALADOR, outraRaiz]);
    assert.match(primeira.saida, /não deu para decidir sozinho \(achei: api, web\)/);
    assert.match(primeira.saida, /3\. Conversa nova: \/mapear backend {3}· {3}outra conversa nova: \/mapear frontend\n/);
    assert.match(primeira.saida, /4\. Depois de mapear: \/entregar <tarefa>/);

    // O que o /mapear deixa: as pastas no config e, por enquanto, só o padrão do backend.
    const config = join(outraRaiz, 'harness', 'config.json');
    writeFileSync(config, readFileSync(config, 'utf8').replace('"dir": "backend"', '"dir": "api"').replace('"dir": "frontend"', '"dir": "web"'));
    writeFileSync(regra('backend'), '---\nglobs: api/**\n---\n# Padrão do backend\n');
    const segunda = rodar('node', [INSTALADOR, outraRaiz]);
    assert.match(segunda.saida, /do projeto, mantidos: 2 · conflitos: 0/);
    assert.match(segunda.saida, /Repositórios: backend → api · frontend → web\n/);
    assert.match(segunda.saida, /3\. Conversa nova: \/mapear frontend\n/);
    assert.doesNotMatch(segunda.saida, /\/mapear backend/);

    writeFileSync(regra('frontend'), '---\nglobs: web/**\n---\n# Padrão do frontend\n');
    const terceira = rodar('node', [INSTALADOR, outraRaiz]);
    assert.match(terceira.saida, /do projeto, mantidos: 3 · conflitos: 0/);
    assert.doesNotMatch(terceira.saida, /\/mapear/);
    assert.match(terceira.saida, /3\. \/entregar <tarefa>[^\n]*\n {5}No Cursor, para ele andar sozinho: [^\n]*allowlist de comandos\n/);
  } finally {
    rmSync(outraRaiz, { recursive: true, force: true });
  }
});

test('o doutor enxerga repositórios e adaptadores, e os testes da catraca passam dentro da raiz', () => {
  const doutor = rodar('node', [join(raiz, 'harness', 'bin', 'doutor.mjs')], { cwd: raiz });
  assert.match(doutor.saida, /Claude Code: hooks do harness/);
  assert.match(doutor.saida, /Codex: \.codex\/hooks\.json aponta para esta raiz/);
  assert.match(doutor.saida, /backend: repositório em "api-x"/);
  assert.match(doutor.saida, /\/entregar: roteiros do maestro presentes/);
  assert.match(doutor.saida, /\/entregar: subagente maestro-passo/);

  const unitarios = rodar('node', ['--test', join(raiz, 'harness', 'bin', 'testes', 'guarda.test.mjs'), join(raiz, 'harness', 'bin', 'testes', 'conferir.test.mjs')]);
  assert.equal(unitarios.codigo, 0, unitarios.saida);
});
