// Recibo dos portões: a prova de que uma árvore de arquivos exata passou em lint, tipos, testes e build.
// Quem grava é o portoes.mjs. O maestro confere o recibo em vez de acreditar em quem diz que rodou.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RAIZ } from './config.mjs';

const PASTA_DE_RECIBOS = join(RAIZ, 'harness', '.recibos');
const caminhoDoRecibo = (repo) => join(PASTA_DE_RECIBOS, `${repo}.json`);

// Identidade do conteúdo da pasta de trabalho (rastreados, alterados e novos, menos o que o
// .gitignore exclui). Usa um índice temporário para não mexer no que está preparado para commit.
export function hashDaArvore(pasta) {
  const indice = join(tmpdir(), `harness-indice-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const git = (args) =>
    spawnSync('git', args, {
      cwd: pasta,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_INDEX_FILE: indice },
    });
  try {
    if (git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).status === 0) git(['read-tree', 'HEAD']);
    git(['add', '-A']);
    const arvore = git(['write-tree']);
    return arvore.status === 0 ? arvore.stdout.trim() : null;
  } finally {
    rmSync(indice, { force: true });
  }
}

export function gravarRecibo(repo, pasta) {
  mkdirSync(PASTA_DE_RECIBOS, { recursive: true });
  const recibo = { repo, arvore: hashDaArvore(pasta), quando: new Date().toISOString() };
  writeFileSync(caminhoDoRecibo(repo), `${JSON.stringify(recibo, null, 2)}\n`);
  return recibo;
}

export function reciboValePara(repo, pasta) {
  if (!existsSync(caminhoDoRecibo(repo))) return false;
  const recibo = JSON.parse(readFileSync(caminhoDoRecibo(repo), 'utf8'));
  return Boolean(recibo.arvore) && recibo.arvore === hashDaArvore(pasta);
}
