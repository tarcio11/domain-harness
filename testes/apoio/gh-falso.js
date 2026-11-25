#!/usr/bin/env node
// Um `gh` de mentira para os testes do maestro. O estado fica no arquivo de GH_ESTADO:
// PRs por repositório, a fila de checks de cada push e tudo o que foi chamado.
// A cabeça de uma PR aberta é lida do remoto de mentira, como o GitHub faz depois de um push.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ARQUIVO = process.env.GH_ESTADO;
const estado = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
const args = process.argv.slice(2);
const repo = path.basename(process.cwd());
estado.chamadas.push(`${repo}: ${args.join(' ')}`);

const valor = (nome) => (args.includes(nome) ? args[args.indexOf(nome) + 1] : null);

function sair(codigo, saida = '', erro = '') {
  fs.writeFileSync(ARQUIVO, JSON.stringify(estado, null, 2));
  process.stdout.write(saida);
  process.stderr.write(erro);
  process.exit(codigo);
}

function cabecaRemota(branch) {
  try {
    return execFileSync('git', ['--git-dir', estado.remotos[repo], 'rev-parse', `refs/heads/${branch}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const prDe = (alvo) => (estado.prs[repo] ?? []).filter((pr) => String(pr.number) === String(alvo) || pr.branch === alvo).pop();

function verPr() {
  const pr = prDe(args[2]);
  if (!pr) sair(1, '', `no pull requests found for branch "${args[2]}"\n`);
  if (pr.state === 'OPEN') pr.headRefOid = cabecaRemota(pr.branch) ?? pr.headRefOid;
  const { number, url, isDraft, state, headRefOid } = pr;
  const mergeable = pr.mergeable ?? (estado.conflitoAoCriar ? 'CONFLICTING' : 'MERGEABLE');
  sair(0, JSON.stringify({ number, url, isDraft, state, headRefOid, mergeable }));
}

function criarPr() {
  if (estado.falharAoCriar) sair(1, '', 'pull request create failed: GraphQL: Resource not accessible\n');
  estado.proximoNumero = (estado.proximoNumero ?? 100) + 1;
  const pr = {
    number: estado.proximoNumero,
    url: `https://github.example/${repo}/pull/${estado.proximoNumero}`,
    branch: valor('--head'),
    base: valor('--base'),
    title: valor('--title'),
    body: fs.readFileSync(valor('--body-file'), 'utf8'),
    isDraft: args.includes('--draft'),
    state: 'OPEN',
  };
  (estado.prs[repo] ??= []).push(pr);
  sair(0, `${pr.url}\n`);
}

// Cada push novo (uma cabeça ainda não vista) consome a rodada seguinte da fila de checks do repositório.
function verChecks() {
  const pr = prDe(args[2]);
  const cabeca = cabecaRemota(pr.branch);
  const vistas = (estado.cabecas[repo] ??= []);
  if (!vistas.includes(cabeca)) vistas.push(cabeca);
  const rodada = (estado.checks[repo] ?? [])[vistas.indexOf(cabeca)] ?? { checks: [{ name: 'ci', bucket: 'pass' }] };
  const chave = `${repo}:${cabeca}`;
  estado.leituras[chave] = (estado.leituras[chave] ?? 0) + 1;
  const pendente = estado.leituras[chave] <= (rodada.pendentePor ?? 0);
  const checks = rodada.checks.map((check) => ({ state: '', link: '', workflow: '', description: '', ...check, bucket: pendente ? 'pending' : check.bucket }));
  if (checks.length === 0) sair(1, '', "no checks reported on the 'x' branch\n");
  sair(checks.some((check) => check.bucket === 'fail') ? 1 : pendente ? 8 : 0, JSON.stringify(checks));
}

if (args[0] === '--version') sair(0, 'gh version 2.99.0 (falso)\n');
if (args[0] === 'auth') sair(estado.autenticado ? 0 : 1, '', estado.autenticado ? '' : 'You are not logged into any GitHub hosts. Run gh auth login to authenticate.\n');
if (args[0] === 'pr' && args[1] === 'view') verPr();
if (args[0] === 'pr' && args[1] === 'create') criarPr();
if (args[0] === 'pr' && args[1] === 'checks') verChecks();
if (args[0] === 'pr' && args[1] === 'ready') {
  prDe(args[2]).isDraft = false;
  sair(0);
}
if (args[0] === 'pr' && args[1] === 'edit') {
  prDe(args[2]).body = fs.readFileSync(valor('--body-file'), 'utf8');
  sair(0);
}
if (args[0] === 'run') sair(0, 'job\tpasso\t2026-01-01T00:00:00.000Z erro no passo de lint\n');
if (args[0] === 'api') sair(0, JSON.stringify({ check_runs: [] }));
sair(1, '', `gh falso: comando não previsto: ${args.join(' ')}\n`);
