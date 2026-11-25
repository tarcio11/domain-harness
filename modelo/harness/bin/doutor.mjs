#!/usr/bin/env node
// Confere se o harness está instalado e mapeado: node harness/bin/doutor.mjs
// Saída: 0 tudo certo · 1 há pendência.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { branchAtual, ehRepoGit, git, lerConfig, nomesDosRepos, pastaDoRepo, RAIZ } from './config.mjs';
import { avaliarComando } from './guarda.mjs';

const NODE_MINIMO = 16;
let pendencias = 0;

function ok(texto) {
  console.log(`✔ ${texto}`);
}

function falta(texto, comoResolver) {
  pendencias++;
  console.log(`✖ ${texto}\n    → ${comoResolver}`);
}

function conferir(condicao, texto, comoResolver) {
  if (condicao) ok(texto);
  else falta(texto, comoResolver);
}

function roda(programa, args) {
  return spawnSync(programa, args, { encoding: 'utf8' }).status === 0;
}

function conferirFerramentas() {
  const versaoDoNode = Number(process.versions.node.split('.')[0]);
  conferir(versaoDoNode >= NODE_MINIMO, `Node ${process.versions.node}`, `use Node ${NODE_MINIMO} ou mais novo`);
  conferir(roda('git', ['--version']), 'git disponível', 'instale o git');
  if (!roda('gh', ['--version'])) {
    falta('GitHub CLI (gh) disponível', 'instale em https://cli.github.com — o /pr depende dele');
    return;
  }
  conferir(roda('gh', ['auth', 'status']), 'gh autenticado', 'rode "gh auth login" no terminal');
}

function conferirRepo(config, nome) {
  const repo = config.repos[nome];
  const pasta = pastaDoRepo(config, nome);
  if (!ehRepoGit(pasta)) {
    falta(`${nome}: pasta "${repo.dir}" é um repositório git`, `ajuste repos.${nome}.dir em harness/config.json (ou rode /mapear ${nome})`);
    return;
  }
  ok(`${nome}: repositório em "${repo.dir}", branch ${branchAtual(pasta)}`);

  const temBase = git(pasta, ['rev-parse', '--verify', '--quiet', `origin/${repo.base}`]).ok;
  conferir(temBase, `${nome}: branch base origin/${repo.base}`, `corrija repos.${nome}.base ou rode "git fetch origin"`);

  const portoes = repo.portoes ?? [];
  const rotuloDosPortoes =
    portoes.length > 0 ? `${nome}: ${portoes.length} portões (${portoes.map((p) => p.nome).join(', ')})` : `${nome}: portões configurados`;
  conferir(portoes.length > 0, rotuloDosPortoes, `rode /mapear ${nome}`);

  const regra = join(RAIZ, '.cursor', 'rules', `padrao-${nome}.mdc`);
  const texto = existsSync(regra) ? readFileSync(regra, 'utf8') : '';
  conferir(texto !== '' && !texto.includes('NÃO MAPEADO'), `${nome}: padrão mapeado`, `rode /mapear ${nome}`);
  conferir(texto.includes(`${repo.dir}/**`), `${nome}: a regra de padrão aponta para "${repo.dir}/**"`, `ajuste "globs" em .cursor/rules/padrao-${nome}.mdc`);
}

function conferirCatraca() {
  conferir(existsSync(join(RAIZ, '.cursor', 'hooks.json')), 'Cursor: .cursor/hooks.json presente', 'rode o instalador de novo');
  conferir(
    existsSync(join(RAIZ, '.agents', 'skills', 'fatia', 'SKILL.md')),
    'roteiros em .agents/skills',
    'rode o instalador de novo',
  );
  const veredito = avaliarComando('git commit -m "x" --no-verify', {
    cwd: RAIZ,
    ehRepoDoProduto: () => false,
    branchDe: () => null,
    ehBranchProtegida: () => false,
  });
  conferir(veredito.permissao === 'deny', 'guarda de shell barra --no-verify', 'harness/bin/guarda.mjs foi alterado?');
}

// Só confere a ferramenta que foi instalada: a ausência do arquivo não é pendência.
function conferirAdaptadores() {
  const hookDoClaude = join(RAIZ, '.claude', 'settings.json');
  if (existsSync(hookDoClaude)) {
    const ligado = readFileSync(hookDoClaude, 'utf8').includes('harness/bin/hook.mjs');
    conferir(ligado, 'Claude Code: hooks do harness em .claude/settings.json', 'junte os hooks de .claude/settings.json.novo ao seu arquivo');
    conferir(existsSync(join(RAIZ, 'CLAUDE.md')), 'Claude Code: CLAUDE.md importa a lei', 'crie CLAUDE.md com a linha @AGENTS.md');
  }
  const hookDoCodex = join(RAIZ, '.codex', 'hooks.json');
  if (existsSync(hookDoCodex)) {
    const texto = readFileSync(hookDoCodex, 'utf8');
    const apontaParaCa = texto.includes(JSON.stringify(join(RAIZ, 'harness', 'bin', 'hook.mjs')).slice(1, -1));
    conferir(apontaParaCa, 'Codex: .codex/hooks.json aponta para esta raiz', 'rode o instalador de novo com --com codex (o caminho é absoluto)');
  }
}

console.log(`DOUTOR DO HARNESS · raiz: ${RAIZ}`);
conferirFerramentas();
const config = lerConfig();
for (const nome of nomesDosRepos(config)) conferirRepo(config, nome);
conferirCatraca();
conferirAdaptadores();

console.log(
  pendencias === 0
    ? 'RESULTADO: tudo certo. Falta só o que o doutor não enxerga: em cada ferramenta, confira se os hooks aparecem e estão confiáveis (Cursor: Customize → Hooks; Claude Code e Codex: /hooks).'
    : `RESULTADO: ${pendencias} pendência(s) acima.`,
);
process.exitCode = pendencias === 0 ? 0 : 1;
