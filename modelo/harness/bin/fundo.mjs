#!/usr/bin/env node
// Roda um comando demorado fora da chamada do maestro e deixa o desfecho num arquivo:
//   node harness/bin/fundo.mjs <arquivo-do-serviço.json>
// Portões, commit e push podem levar mais tempo do que a ferramenta dá a um comando de terminal.
// O maestro dispara o serviço, devolve "REPETIR" e lê o desfecho nas chamadas seguintes.

import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

const LINHAS_GUARDADAS = 200;
const CORES_ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

const arquivo = process.argv[2];
const servico = JSON.parse(readFileSync(arquivo, 'utf8'));

// Grava num arquivo vizinho e troca o nome: quem lê nunca pega o JSON pela metade.
function gravar(dados) {
  writeFileSync(`${arquivo}.tmp`, JSON.stringify(dados));
  renameSync(`${arquivo}.tmp`, arquivo);
}

gravar({ ...servico, pid: process.pid });

const execucao = spawnSync(servico.programa, servico.args, {
  cwd: servico.pasta,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  timeout: servico.tempoMaximoMs,
});
const linhas = `${execucao.stdout ?? ''}\n${execucao.stderr ?? ''}`
  .replace(CORES_ANSI, '')
  .split('\n')
  .filter((linha) => linha.trim() !== '');

gravar({
  ...servico,
  pid: process.pid,
  fim: Date.now(),
  codigo: execucao.status ?? 1,
  estourouOTempo: execucao.error?.code === 'ETIMEDOUT',
  saida: linhas.slice(-LINHAS_GUARDADAS).join('\n'),
});
