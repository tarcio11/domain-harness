// Lê harness/config.json e reúne o que os outros scripts compartilham.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CAMINHO_DA_CONFIG = join(RAIZ, 'harness', 'config.json');
const PASTA_DE_TAREFAS = join(RAIZ, 'harness', 'tarefas');
// O livro da condução do maestro (/entregar ou /revisar). Só o livro.mjs lê e grava; o caminho
// fica aqui porque a catraca precisa saber qual plano vale enquanto há uma condução aberta.
export const CAMINHO_DO_LIVRO = join(RAIZ, 'harness', '.maestro', 'conducao', 'livro.json');

export function lerConfig() {
  return JSON.parse(readFileSync(CAMINHO_DA_CONFIG, 'utf8'));
}

export function nomesDosRepos(config) {
  return Object.keys(config.repos ?? {});
}

export function pastaDoRepo(config, nome) {
  const repo = config.repos?.[nome];
  if (!repo) {
    const opcoes = nomesDosRepos(config).join(', ');
    throw new Error(`Repositório "${nome}" não está em harness/config.json. Opções: ${opcoes}.`);
  }
  return join(RAIZ, repo.dir);
}

export function ehRepoGit(pasta) {
  return existsSync(join(pasta, '.git'));
}

export function git(pasta, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd: pasta,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, saida: (r.stdout ?? '').replace(/\r?\n$/, '') };
}

export function branchAtual(pasta) {
  const r = git(pasta, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok ? r.saida.trim() : null;
}

export function ehBranchProtegida(config, branch) {
  if (!branch) return false;
  return (config.branchesProtegidas ?? []).some((padrao) => globParaRegex(padrao, { inteiro: true }).test(branch));
}

// Sem barra, o glob vale para o nome do arquivo em qualquer pasta (como no .gitignore).
export function globParaRegex(glob, { inteiro = false } = {}) {
  const corpo = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*');
  const inicio = inteiro || glob.includes('/') ? '^' : '(?:^|.*/)';
  return new RegExp(`${inicio}${corpo}$`);
}

export function tarefaAtual() {
  const ponteiro = join(PASTA_DE_TAREFAS, 'ATUAL');
  if (!existsSync(ponteiro)) return null;
  return readFileSync(ponteiro, 'utf8').trim() || null;
}

// O que o humano liberou no plano. Com uma condução aberta vale o plano dela; uma revisão
// (/revisar) não tem plano, e então nada está liberado.
export function desviosAprovados() {
  const conducao = conducaoEmCurso();
  if (conducao?.tipo === 'revisao') return [];
  const id = conducao?.tarefa ?? tarefaAtual();
  if (!id) return [];
  const plano = join(PASTA_DE_TAREFAS, id, 'plano.md');
  return existsSync(plano) ? extrairDesvios(readFileSync(plano, 'utf8')) : [];
}

function conducaoEmCurso() {
  try {
    const livro = JSON.parse(readFileSync(CAMINHO_DO_LIVRO, 'utf8'));
    return livro.encerrado ? null : livro;
  } catch {
    return null;
  }
}

// Os caminhos liberados são os trechos entre crases da seção "Desvios aprovados" do plano.
export function extrairDesvios(markdown) {
  const semComentarios = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const secao = semComentarios.split(/^## +/m).find((trecho) => /^Desvios aprovados/i.test(trecho));
  if (!secao) return [];
  return Array.from(secao.matchAll(/`([^`]+)`/g), (achado) => achado[1].trim());
}
