// As mãos do maestro: tudo que muda o git ou o GitHub durante a condução passa por aqui.
// O modelo escreve código; quem cria branch, faz commit, push e PR é este módulo.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { branchAtual, git, RAIZ } from './config.mjs';
import { reciboValePara } from './recibo.mjs';

const BIN = join(RAIZ, 'harness', 'bin');
const PASTA_DE_SERVICOS = join(RAIZ, 'harness', '.maestro');
const CORES_ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const TETO_DE_COMANDO_CURTO_MS = 45 * 1000;
const BUSCA_CURTA_MS = 12 * 1000;
const SERVICO_SEM_SINAL_MS = 15 * 1000;
const SERVICO_VELHO_MS = 24 * 60 * 60 * 1000;
const MINUTO = 60 * 1000;
const CAMPOS_DA_PR = 'number,url,isDraft,state,headRefOid,mergeable,headRefName,title,body';

function rodar(programa, args, pasta, tetoMs = TETO_DE_COMANDO_CURTO_MS) {
  const r = spawnSync(programa, args, { cwd: pasta, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: tetoMs });
  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(CORES_ANSI, '').trim();
  return { ok: r.status === 0, codigo: r.status, saida, stdout: r.stdout ?? '', ausente: r.error?.code === 'ENOENT' };
}

export function cauda(texto, linhas = 40) {
  return String(texto ?? '')
    .split('\n')
    .filter((linha) => linha.trim() !== '')
    .slice(-linhas)
    .join('\n');
}

export const cabeca = (pasta) => git(pasta, ['rev-parse', 'HEAD']).saida.trim();
export const arvoreLimpa = (pasta) => git(pasta, ['status', '--porcelain']).saida.trim() === '';
export const prepararParaRevisao = (pasta) => git(pasta, ['add', '-A']).ok;
export const existeNoCommit = (pasta, referencia, caminho) => git(pasta, ['cat-file', '-e', `${referencia}:${caminho}`]).ok;
export const temOrigem = (pasta) => git(pasta, ['remote', 'get-url', 'origin']).ok;
export const existeRef = (pasta, ref) => git(pasta, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok;
export const commitsAFrente = (pasta, base, ref) => Number(git(pasta, ['rev-list', '--count', `${base}..${ref}`]).saida) || 0;
// Busca curta, de melhor esforço: quem precisa da busca completa usa entrarNaBranch, que espera em segundo plano.
export const buscarRemoto = (pasta) => rodar('git', ['fetch', 'origin'], pasta, BUSCA_CURTA_MS).ok;

// Os nomes de branch que o repositório conhece, locais e do GitHub.
export function ramos(pasta) {
  const refs = git(pasta, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin']).saida.split('\n');
  const nomes = refs.map((ref) => ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/origin\//, '')).filter((nome) => nome && nome !== 'HEAD');
  return Array.from(new Set(nomes));
}

// Arquivos que a branch mudou desde a referência, com o tamanho da mudança de cada um.
export function arquivosMudados(pasta, referencia) {
  return git(pasta, ['diff', '--numstat', '--diff-filter=d', '--no-renames', `${referencia}...HEAD`])
    .saida.split('\n')
    .filter(Boolean)
    .map((linha) => {
      const [mais, menos, ...caminho] = linha.split('\t');
      return { caminho: caminho.join('\t'), linhas: (Number(mais) || 0) + (Number(menos) || 0) };
    });
}

// Desfaz tudo o que mudou desde a referência, na branch da tarefa: o que estava sem commit e os
// commits que não são do maestro. Antes, guarda o que vai jogar fora num patch, para ninguém perder trabalho.
export function descartar(pasta, branch, referencia, arquivoDoPatch) {
  git(pasta, ['add', '-A']);
  const diff = rodar('git', ['diff', '--cached', '--binary', referencia], pasta).stdout;
  const guardou = diff.trim() !== '';
  if (guardou) {
    mkdirSync(dirname(arquivoDoPatch), { recursive: true });
    writeFileSync(arquivoDoPatch, diff);
  }
  if (branchAtual(pasta) !== branch) rodar('git', ['checkout', '-f', branch], pasta);
  rodar('git', ['reset', '--hard', referencia], pasta);
  rodar('git', ['clean', '-fd'], pasta);
  return guardou;
}

// Arquivo que os portões geram e o .gitignore do repositório não cobre: fica ignorado só nesta
// máquina (.git/info/exclude), sem tocar em arquivo versionado.
export function ignorarLocalmente(pasta, caminhos) {
  const arquivo = join(pasta, '.git', 'info', 'exclude');
  mkdirSync(dirname(arquivo), { recursive: true });
  appendFileSync(arquivo, `${['', '# harness: gerado pelos portões', ...caminhos.map((caminho) => `/${caminho}`)].join('\n')}\n`);
}

// ------------------------------------------------------------------ serviços em segundo plano
// Uma chamada do maestro tem que voltar em segundos. O que pode demorar roda num processo solto
// (fundo.mjs), e cada chamada espera por ele só até o prazo dela.

const arquivoDoServico = (nome) => join(PASTA_DE_SERVICOS, `${nome}.json`);
const servicoPendente = (nome) => existsSync(arquivoDoServico(nome));

function dormir(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lerServico(arquivo) {
  try {
    return JSON.parse(readFileSync(arquivo, 'utf8'));
  } catch {
    return null;
  }
}

export function processoVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro.code === 'EPERM';
  }
}

function disparar(arquivo, criar) {
  mkdirSync(PASTA_DE_SERVICOS, { recursive: true });
  writeFileSync(arquivo, JSON.stringify({ ...criar, inicio: Date.now() }));
  const filho = spawn(process.execPath, [join(BIN, 'fundo.mjs'), arquivo], {
    cwd: RAIZ,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  filho.unref();
}

function sumiu(lido) {
  if (!lido) return false;
  if (!lido.pid) return Date.now() - lido.inicio > SERVICO_SEM_SINAL_MS;
  return !processoVivo(lido.pid);
}

// Devolve { estado: 'terminou', codigo, saida } | { estado: 'rodando', desde } | { estado: 'interrompido' }.
// Se o serviço ainda não existe, começa agora com o que vier em "criar".
export function servico(nome, criar, prazo) {
  const arquivo = arquivoDoServico(nome);
  if (!existsSync(arquivo)) disparar(arquivo, criar);
  for (let pausa = 40; ; pausa = Math.min(pausa * 2, 500)) {
    let atual = lerServico(arquivo);
    // O processo pode ter terminado entre a leitura e a checagem: relê antes de dar por sumido.
    if (!atual?.fim && sumiu(atual)) atual = lerServico(arquivo);
    if (atual?.fim) {
      rmSync(arquivo, { force: true });
      return { estado: 'terminou', codigo: atual.codigo, saida: atual.saida ?? '', estourouOTempo: atual.estourouOTempo };
    }
    if (sumiu(atual)) {
      rmSync(arquivo, { force: true });
      return { estado: 'interrompido' };
    }
    const resta = prazo - Date.now();
    if (resta <= 0) return { estado: 'rodando', desde: atual?.inicio ?? Date.now() };
    dormir(Math.min(pausa, resta));
  }
}

export function limparServicosVelhos() {
  if (!existsSync(PASTA_DE_SERVICOS)) return;
  for (const nome of readdirSync(PASTA_DE_SERVICOS)) {
    const caminho = join(PASTA_DE_SERVICOS, nome);
    const ehServico = nome.endsWith('.json') && nome !== 'operador.json';
    if (ehServico && Date.now() - statSync(caminho).mtimeMs > SERVICO_VELHO_MS) rmSync(caminho, { force: true });
  }
}

// --------------------------------------------------------------------------------------- git

// Entra na branch da tarefa. Antes busca o remoto: é também o primeiro teste de que o git
// alcança o GitHub, feito antes de qualquer código ser escrito. Com "sempre", busca e acerta a
// branch com a do GitHub mesmo que o repositório já esteja nela.
export function entrarNaBranch(pasta, branch, base, nome, prazo, { sempre = false } = {}) {
  if (!sempre && branchAtual(pasta) === branch && !servicoPendente(nome)) return { estado: 'ok' };
  if (!arvoreLimpa(pasta)) {
    return { estado: 'erro', erro: `Há mudanças sem commit em ${pasta}. O maestro não troca de branch com a árvore suja.` };
  }
  const busca = servico(nome, { programa: 'git', args: ['fetch', 'origin'], pasta, tempoMaximoMs: 5 * MINUTO }, prazo);
  if (busca.estado === 'rodando') return { estado: 'rodando' };
  if (busca.estado === 'interrompido' || busca.codigo !== 0) {
    const detalhe = busca.estado === 'interrompido' ? 'o git fetch foi interrompido' : cauda(busca.saida, 10);
    return { estado: 'erro', erro: `Não consegui falar com o remoto "origin" de ${pasta}:\n${detalhe}` };
  }
  const existe = (ref) => git(pasta, ['rev-parse', '--verify', '--quiet', ref]).ok;
  const remota = `refs/remotes/origin/${branch}`;
  let troca;
  if (branchAtual(pasta) === branch) troca = { ok: true };
  else if (existe(`refs/heads/${branch}`)) troca = rodar('git', ['checkout', branch], pasta);
  else if (existe(remota)) troca = rodar('git', ['checkout', '--no-track', '-b', branch, `origin/${branch}`], pasta);
  else if (existe(`refs/remotes/origin/${base}`)) troca = rodar('git', ['checkout', '--no-track', '-b', branch, `origin/${base}`], pasta);
  else return { estado: 'erro', erro: `A branch base origin/${base} não existe em ${pasta}. Corrija repos.*.base em harness/config.json.` };
  if (!troca.ok) return { estado: 'erro', erro: `Não consegui entrar na branch ${branch}:\n${cauda(troca.saida, 10)}` };
  return existe(remota) ? alcancarARemota(pasta, branch) : { estado: 'ok' };
}

// A branch já existe no GitHub: a local só segue se estiver igual, à frente, ou puder avançar sem merge.
function alcancarARemota(pasta, branch) {
  const remota = `origin/${branch}`;
  if (git(pasta, ['merge-base', '--is-ancestor', remota, 'HEAD']).ok) return { estado: 'ok' };
  const atrasada = git(pasta, ['merge-base', '--is-ancestor', 'HEAD', remota]).ok;
  if (atrasada && rodar('git', ['merge', '--ff-only', remota], pasta).ok) return { estado: 'ok' };
  return { estado: 'erro', erro: `A branch ${branch} local e a do GitHub seguiram caminhos diferentes em ${pasta}. Junte as duas à mão.` };
}

// Se o executor já fez o commit (não devia), ou uma chamada anterior já concluiu, não há o que commitar.
export function commit(pasta, mensagem, nome, prazo) {
  if (!servicoPendente(nome)) {
    git(pasta, ['add', '-A']);
    if (git(pasta, ['diff', '--cached', '--quiet']).ok) return { estado: 'terminou', codigo: 0, saida: 'nada a commitar' };
  }
  return servico(nome, { programa: 'git', args: ['commit', '-m', mensagem], pasta, tempoMaximoMs: 10 * MINUTO }, prazo);
}

// Sem "-u": gravar o upstream mexe em .git/config, que o sandbox de algumas ferramentas protege.
export function empurrar(pasta, branch, nome, prazo) {
  return servico(nome, { programa: 'git', args: ['push', 'origin', branch], pasta, tempoMaximoMs: 10 * MINUTO }, prazo);
}

// Verde: há recibo para exatamente esta árvore. Sem recibo, o maestro roda os portões ele mesmo.
// Devolve { estado: 'verde' | 'vermelho' | 'mudou' | 'rodando' | 'interrompido', saida }.
export function portoes(repo, pasta, nome, prazo, tempoMaximoMin) {
  if (reciboValePara(repo, pasta)) return { estado: 'verde' };
  const criar = { programa: process.execPath, args: [join(BIN, 'portoes.mjs'), repo], pasta: RAIZ, tempoMaximoMs: tempoMaximoMin * MINUTO };
  const rodada = servico(nome, criar, prazo);
  if (rodada.estado !== 'terminou') return rodada;
  if (reciboValePara(repo, pasta)) return { estado: 'verde' };
  // Saiu sem erro e o recibo não confere: alguém mexeu nos arquivos enquanto os portões rodavam.
  return rodada.codigo === 0 ? { estado: 'mudou' } : { estado: 'vermelho', saida: rodada.saida };
}

// ------------------------------------------------------------------------------------ GitHub

export function ambienteDoGitHub() {
  if (rodar('gh', ['--version'], RAIZ).ausente) return 'O GitHub CLI (gh) não está instalado ou não está no PATH do terminal do agente.';
  const sessao = rodar('gh', ['auth', 'status'], RAIZ);
  return sessao.ok ? null : `O gh não está autenticado, ou o terminal do agente não alcança o GitHub:\n${cauda(sessao.saida, 6)}`;
}

export function prDaBranch(pasta, alvo) {
  const r = rodar('gh', ['pr', 'view', String(alvo), '--json', CAMPOS_DA_PR], pasta);
  if (r.ausente) return { erro: 'O GitHub CLI (gh) não está instalado ou não está no PATH.' };
  try {
    const pr = JSON.parse(r.stdout);
    return {
      numero: pr.number,
      url: pr.url,
      rascunho: pr.isDraft,
      estado: pr.state,
      cabeca: pr.headRefOid,
      conflito: pr.mergeable === 'CONFLICTING',
      branch: pr.headRefName ?? null,
      titulo: pr.title ?? '',
      corpo: pr.body ?? '',
    };
  } catch {
    return null;
  }
}

export function criarPr(pasta, { base, branch, titulo, arquivoDoCorpo, rascunho }) {
  const args = ['pr', 'create', '--base', base, '--head', branch, '--title', titulo, '--body-file', arquivoDoCorpo];
  return rodar('gh', rascunho ? [...args, '--draft'] : args, pasta);
}

// "gh pr edit" falha em algumas versões do gh por motivos alheios à descrição (campos de projeto
// que o GitHub aposentou). A API REST troca só o corpo, e serve de segundo caminho.
export function atualizarCorpoDaPr(pasta, numero, arquivoDoCorpo) {
  const editada = rodar('gh', ['pr', 'edit', String(numero), '--body-file', arquivoDoCorpo], pasta);
  if (editada.ok) return editada;
  return rodar('gh', ['api', '--method', 'PATCH', `repos/{owner}/{repo}/pulls/${numero}`, '-F', `body=@${arquivoDoCorpo}`, '--silent'], pasta);
}
export const marcarPronta = (pasta, numero) => rodar('gh', ['pr', 'ready', String(numero)], pasta);

// Uma leitura curta dos checks: o maestro chama de novo até terminar (códigos de saída no esperar-checks.mjs).
export function esperarChecks(repo, { pr, sha, desde, segundos, intervaloSeg }) {
  const args = [join(BIN, 'esperar-checks.mjs'), repo, '--pr', String(pr), '--commit', sha, '--desde', String(desde)];
  args.push('--max-seg', String(segundos), '--intervalo-seg', String(intervaloSeg));
  return rodar(process.execPath, args, RAIZ, (segundos + 60) * 1000);
}
