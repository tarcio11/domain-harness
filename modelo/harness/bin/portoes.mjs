#!/usr/bin/env node
// A prova local: confere o diff e roda os portões do repositório, com saída curta.
// Saída: 0 aprovado · 1 reprovado · 2 uso ou configuração.

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ehRepoGit, lerConfig, pastaDoRepo, RAIZ } from './config.mjs';
import { conferirRepo, formatarAchado } from './conferir.mjs';
import { gravarRecibo } from './recibo.mjs';

const USO = 'Uso: node harness/bin/portoes.mjs <repo> [--pr] [--escopo caminho ...] [--so-diff] [--todos]';
const PASTA_DE_LOGS = join(RAIZ, 'harness', '.logs');
const CORES_ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const MAXIMO_DE_BLOQUEIOS_IMPRESSOS = 30;
const MAXIMO_DE_AVISOS_IMPRESSOS = 8;

class ErroDeUso extends Error {}

function lerArgumentos(argumentos) {
  const opcoes = { repo: null, modo: 'fatia', escopo: [], soDiff: false, todos: false };
  let lendoEscopo = false;
  for (const argumento of argumentos) {
    if (argumento === '--escopo') {
      lendoEscopo = true;
      continue;
    }
    if (argumento.startsWith('--')) {
      lendoEscopo = false;
      if (argumento === '--pr') opcoes.modo = 'pr';
      else if (argumento === '--so-diff') opcoes.soDiff = true;
      else if (argumento === '--todos') opcoes.todos = true;
      else throw new ErroDeUso(`Opção desconhecida: ${argumento}\n${USO}`);
    } else if (lendoEscopo) {
      opcoes.escopo.push(...argumento.split(',').filter(Boolean));
    } else if (!opcoes.repo) {
      opcoes.repo = argumento;
    } else {
      throw new ErroDeUso(`Argumento sobrando: ${argumento}\n${USO}`);
    }
  }
  if (!opcoes.repo) throw new ErroDeUso(USO);
  return opcoes;
}

function conferirDiff(config, opcoes) {
  const { achados } = conferirRepo(config, opcoes.repo, opcoes);
  const pendentes = achados.filter((a) => a.nivel === 'bloqueio' && !a.liberado);
  const avisos = achados.filter((a) => a.nivel === 'aviso');
  const liberados = achados.filter((a) => a.liberado && a.nivel === 'bloqueio');
  const contagem = [`${pendentes.length} bloqueio(s)`, `${avisos.length} aviso(s)`];
  if (liberados.length > 0) contagem.push(`${liberados.length} liberado(s) no plano`);
  console.log(`${pendentes.length === 0 ? '✔' : '✖'} diff — ${contagem.join(', ')}`);
  imprimirAchados(pendentes, MAXIMO_DE_BLOQUEIOS_IMPRESSOS);
  imprimirAchados(avisos, MAXIMO_DE_AVISOS_IMPRESSOS);
  imprimirAchados(liberados, MAXIMO_DE_AVISOS_IMPRESSOS);
  return { bloqueios: pendentes.length, avisos: avisos.length };
}

function imprimirAchados(achados, maximo) {
  for (const achado of achados.slice(0, maximo)) console.log(`  ${formatarAchado(achado)}`);
  if (achados.length > maximo) console.log(`  … e mais ${achados.length - maximo}.`);
}

function rodarPortao(portao, pasta, config) {
  const inicio = Date.now();
  const minutos = config.saida?.tempoMaximoPorPortaoMin ?? 15;
  const execucao = spawnSync(portao.cmd, {
    cwd: pasta,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: minutos * 60 * 1000,
    // CI=true impede modo watch (CRA/Jest) e faz o build tratar aviso como erro, igual ao pipeline.
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return {
    nome: portao.nome,
    passou: execucao.status === 0,
    estourouOTempo: execucao.error?.code === 'ETIMEDOUT',
    segundos: Math.round((Date.now() - inicio) / 1000),
    saida: `${execucao.stdout ?? ''}\n${execucao.stderr ?? ''}`.replace(CORES_ANSI, ''),
  };
}

function relatarPortao(resultado, repo, config) {
  if (resultado.passou) {
    console.log(`✔ ${resultado.nome} (${resultado.segundos}s)`);
    return;
  }
  const quantas = config.saida?.linhasDeErro ?? 40;
  const log = join(PASTA_DE_LOGS, `${repo}-${resultado.nome.replace(/[^\w-]+/g, '_')}.log`);
  mkdirSync(PASTA_DE_LOGS, { recursive: true });
  writeFileSync(log, resultado.saida);
  const motivo = resultado.estourouOTempo ? 'estourou o tempo' : 'falhou';
  console.log(`✖ ${resultado.nome} ${motivo} (${resultado.segundos}s) — últimas ${quantas} linhas:`);
  const linhas = resultado.saida.split('\n').filter((linha) => linha.trim() !== '');
  for (const linha of linhas.slice(-quantas)) console.log(`  | ${linha}`);
  console.log(`  log completo: ${log.slice(RAIZ.length + 1)} (busque nele; não abra inteiro)`);
}

function rodarPortoes(config, opcoes, pasta) {
  const portoes = config.repos[opcoes.repo].portoes ?? [];
  if (portoes.length === 0) {
    throw new ErroDeUso(`✖ nenhum portão configurado para "${opcoes.repo}". Rode /mapear ${opcoes.repo} primeiro.`);
  }
  const reprovados = [];
  for (const portao of portoes) {
    const resultado = rodarPortao(portao, pasta, config);
    relatarPortao(resultado, opcoes.repo, config);
    if (resultado.passou) continue;
    reprovados.push(resultado.nome);
    if (!opcoes.todos) break;
  }
  if (reprovados.length === 0) gravarRecibo(opcoes.repo, pasta);
  return { total: portoes.length, reprovados };
}

function principal() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  const config = lerConfig();
  const pasta = pastaDoRepo(config, opcoes.repo);
  if (!ehRepoGit(pasta)) {
    throw new ErroDeUso(`✖ "${pasta}" não é um repositório git. Ajuste repos.${opcoes.repo}.dir em harness/config.json.`);
  }

  console.log(`PORTÕES · ${opcoes.repo} · ${opcoes.modo === 'pr' ? 'PR inteira' : 'fatia'}`);
  const diff = conferirDiff(config, opcoes);
  const portoes = opcoes.soDiff ? { total: 0, reprovados: [] } : rodarPortoes(config, opcoes, pasta);

  const motivos = [];
  if (diff.bloqueios > 0) motivos.push(`${diff.bloqueios} bloqueio(s) no diff`);
  if (portoes.reprovados.length > 0) motivos.push(`portão "${portoes.reprovados.join('", "')}"`);
  if (motivos.length > 0) {
    console.log(`RESULTADO: REPROVADO — ${motivos.join(' e ')}. Conserte a causa; não desligue a verificação.`);
    return 1;
  }
  const provas = opcoes.soDiff ? 'diff conferido' : `${portoes.total} portões verdes`;
  const pendencia = diff.avisos > 0 ? `, ${diff.avisos} aviso(s) para resolver ou explicar na PR` : '';
  console.log(`RESULTADO: APROVADO — ${provas}, 0 bloqueios${pendencia}.`);
  return 0;
}

try {
  process.exitCode = principal();
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 2;
}
