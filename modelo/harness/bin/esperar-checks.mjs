#!/usr/bin/env node
// Espera os checks da PR (CI, Sonar) terminarem, em silêncio, e devolve só o resumo.
// Saída: 0 tudo verde · 1 algum check reprovou · 2 uso/gh · 3 ainda rodando · 4 a PR não tem checks.
// As opções --max-seg, --intervalo-seg, --desde e --commit servem ao maestro, que espera em
// chamadas curtas: a carência conta a partir de --desde, e só valem os checks do commit pedido.

import { spawnSync } from 'node:child_process';
import { ehRepoGit, lerConfig, pastaDoRepo } from './config.mjs';

const USO = 'Uso: node harness/bin/esperar-checks.mjs <repo> [--pr <número>] [--max-min <minutos>]';
const OPCOES_COM_VALOR = { '--pr': 'pr', '--commit': 'commit' };
const OPCOES_COM_NUMERO = { '--max-min': 'maxMin', '--max-seg': 'maxSeg', '--intervalo-seg': 'intervaloSeg', '--desde': 'desde' };
const LINHAS_POR_CHECK = 25;
const ANOTACOES_POR_CHECK = 20;
const CORES_ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const SIMBOLO = { pass: '✔', fail: '✖', cancel: '✖', pending: '…', skipping: '○' };

class ErroDeUso extends Error {}

function lerArgumentos(argumentos) {
  const opcoes = { repo: null, pr: null, commit: null, maxMin: null, maxSeg: null, intervaloSeg: null, desde: null };
  for (let i = 0; i < argumentos.length; i++) {
    const argumento = argumentos[i];
    if (OPCOES_COM_VALOR[argumento]) opcoes[OPCOES_COM_VALOR[argumento]] = argumentos[++i];
    else if (OPCOES_COM_NUMERO[argumento]) opcoes[OPCOES_COM_NUMERO[argumento]] = Number(argumentos[++i]);
    else if (!opcoes.repo && !argumento.startsWith('--')) opcoes.repo = argumento;
    else throw new ErroDeUso(USO);
  }
  if (!opcoes.repo) throw new ErroDeUso(USO);
  return opcoes;
}

function criarGh(pasta) {
  return (args) => {
    const r = spawnSync('gh', args, { cwd: pasta, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error?.code === 'ENOENT') throw new ErroDeUso('O GitHub CLI (gh) não está instalado ou não está no PATH.');
    return { codigo: r.status, saida: r.stdout ?? '', erro: r.stderr ?? '' };
  };
}

function lerJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

function acharPr(gh, numero) {
  const r = gh(['pr', 'view', ...(numero ? [String(numero)] : []), '--json', 'number,url,headRefOid,isDraft']);
  const pr = lerJson(r.saida);
  if (!pr) throw new ErroDeUso(`Não achei a PR desta branch (gh disse: ${r.erro.trim() || 'nada'}). Abra a PR ou passe --pr <número>.`);
  return pr;
}

function lerChecks(gh, numero) {
  const r = gh(['pr', 'checks', String(numero), '--json', 'name,bucket,state,link,workflow,description']);
  const checks = lerJson(r.saida);
  if (Array.isArray(checks) && checks.length > 0) return checks;
  if (/no checks reported/i.test(r.erro) || Array.isArray(checks)) return [];
  throw new ErroDeUso(`gh pr checks falhou: ${r.erro.trim()}`);
}

const dormir = (ms) => new Promise((acordar) => setTimeout(acordar, ms));

// Logo depois de abrir a PR o GitHub ainda não listou os checks, e um check externo (Sonar) pode
// se registrar depois do CI. Por isso "nenhum" só vale depois da carência, e "terminou" só vale
// quando duas leituras seguidas mostram a mesma lista, toda parada.
async function esperarTerminar(gh, numero, { intervaloSeg, esperaSeg, carenciaSemChecksMin, desde }) {
  const prazo = Date.now() + esperaSeg * 1000;
  const acabouACarencia = () => Date.now() - desde > carenciaSemChecksMin * 60 * 1000;
  let paradosNaLeituraAnterior = -1;
  for (;;) {
    const checks = lerChecks(gh, numero);
    const todosParados = checks.length > 0 && checks.every((check) => check.bucket !== 'pending');
    const terminou = checks.length > 0 ? todosParados && checks.length === paradosNaLeituraAnterior : acabouACarencia();
    const resta = prazo - Date.now();
    if (terminou || resta <= 0) return { checks, terminou };
    paradosNaLeituraAnterior = todosParados ? checks.length : -1;
    await dormir(Math.min(intervaloSeg * 1000, resta));
  }
}

function limpar(texto) {
  return texto
    .replace(CORES_ANSI, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((linha) => linha.trim())
    .filter(Boolean);
}

// Check do GitHub Actions: o link traz o run (e o job); o log dos passos que falharam basta.
function detalheDoActions(gh, link) {
  const [, run, job] = /\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/.exec(link ?? '') ?? [];
  if (!run) return null;
  const alvo = job ? ['--job', job] : [run];
  const r = gh(['run', 'view', ...alvo, '--log-failed']);
  const linhas = limpar(r.saida).map((linha) => linha.replace(/^.*?\t.*?\t/, '').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ''));
  return linhas.filter(Boolean).slice(-LINHAS_POR_CHECK);
}

// Check externo (Sonar e afins): título, resumo e anotações por linha vêm da API de check runs.
function detalheDoCheckRun(gh, check, sha) {
  const lista = lerJson(gh(['api', `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`]).saida);
  const run = lista?.check_runs?.find((item) => item.name === check.name);
  if (!run) return [check.description, check.link].filter(Boolean);
  const linhas = [run.output?.title, ...limpar(run.output?.summary ?? '').slice(0, 10)].filter(Boolean);
  if ((run.output?.annotations_count ?? 0) > 0) {
    const anotacoes = lerJson(gh(['api', `repos/{owner}/{repo}/check-runs/${run.id}/annotations?per_page=${ANOTACOES_POR_CHECK}`]).saida);
    for (const a of anotacoes ?? []) linhas.push(`${a.path}:${a.start_line} — ${String(a.message).split('\n')[0]}`);
  }
  if (run.details_url) linhas.push(`detalhes: ${run.details_url}`);
  return linhas;
}

function relatar(gh, pr, checks) {
  console.log(`PR #${pr.number}${pr.isDraft ? ' (rascunho)' : ''} — ${pr.url}`);
  for (const check of checks) {
    const nome = check.workflow && check.workflow !== check.name ? `${check.workflow} / ${check.name}` : check.name;
    console.log(`${SIMBOLO[check.bucket] ?? '?'} ${nome}${check.bucket === 'cancel' ? ' (cancelado)' : ''}`);
    if (check.bucket !== 'fail') continue;
    const detalhe = detalheDoActions(gh, check.link) ?? detalheDoCheckRun(gh, check, pr.headRefOid);
    for (const linha of detalhe) console.log(`    ${linha}`);
  }
}

async function principal() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  const config = lerConfig();
  const pasta = pastaDoRepo(config, opcoes.repo);
  if (!ehRepoGit(pasta)) throw new ErroDeUso(`"${pasta}" não é um repositório git.`);

  const gh = criarGh(pasta);
  const pr = acharPr(gh, opcoes.pr);
  if (opcoes.commit && pr.headRefOid !== opcoes.commit) {
    console.log('RESULTADO: AINDA RODANDO — o GitHub ainda não registrou o último push desta PR. Rode o comando de novo.');
    return 3;
  }
  const limites = { intervaloSeg: 20, maximoMin: 25, carenciaSemChecksMin: 2, ...config.checks };
  const esperaSeg = opcoes.maxSeg ?? (opcoes.maxMin ?? limites.maximoMin) * 60;
  const { checks, terminou } = await esperarTerminar(gh, pr.number, {
    intervaloSeg: opcoes.intervaloSeg ?? limites.intervaloSeg,
    esperaSeg,
    carenciaSemChecksMin: limites.carenciaSemChecksMin,
    desde: opcoes.desde ?? Date.now(),
  });
  relatar(gh, pr, checks);

  const reprovados = checks.filter((check) => check.bucket === 'fail' || check.bucket === 'cancel').length;
  if (!terminou) {
    console.log(`RESULTADO: AINDA RODANDO depois de ${Math.round(esperaSeg)} s de espera. Rode o comando de novo.`);
    return 3;
  }
  // Check pulado não prova nada: uma PR só com checks pulados (CI que ignora rascunho) conta como sem checks.
  if (checks.every((check) => check.bucket === 'skipping')) {
    console.log('RESULTADO: SEM CHECKS — nada rodou nesta PR. Confira no GitHub se o CI ignora PR em rascunho e avise o humano.');
    return 4;
  }
  if (reprovados > 0) {
    console.log(`RESULTADO: REPROVADO — ${reprovados} de ${checks.length} checks. Conserte a causa em commit novo.`);
    return 1;
  }
  console.log(`RESULTADO: VERDE — ${checks.length} checks.`);
  return 0;
}

try {
  process.exitCode = await principal();
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 2;
}
