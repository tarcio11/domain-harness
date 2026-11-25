#!/usr/bin/env node
// Instala ou atualiza o harness numa raiz de trabalho:
//   node instalar.mjs <raiz> [--com claude,codex] [--forcar] [--limpar]
// O motor (lei, roteiros, scripts) é atualizado a cada execução. O que é do projeto
// (config, padrões mapeados, tarefas) e o que você editou nunca é sobrescrito.
// --limpar apaga das pastas de tarefa os arquivos de condução que a versão 0.3 deixava lá.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSAO = '0.4.0';
const USO = 'Uso: node instalar.mjs <raiz> [--com claude,codex] [--forcar] [--limpar]';
const AQUI = dirname(fileURLToPath(import.meta.url));
const MODELO = join(AQUI, 'modelo');
const MANIFESTO = 'harness/.instalado.json';

// O Cursor é a base. As outras ferramentas só recebem arquivos quando pedidas em --com.
const ADAPTADORES = { claude: ['CLAUDE.md', '.claude/'], codex: ['.codex/'] };
const DO_PROJETO = new Set(['harness/config.json', '.cursor/rules/padrao-backend.mdc', '.cursor/rules/padrao-frontend.mdc']);
const SINAIS_DE_FRONTEND = ['react', 'react-scripts', 'next', 'vue', '@angular/core', 'svelte'];

class ErroDeUso extends Error {}

function lerArgumentos(argumentos) {
  const opcoes = { raiz: null, com: [], forcar: false, limpar: false };
  for (let i = 0; i < argumentos.length; i++) {
    const a = argumentos[i];
    if (a === '--com') opcoes.com = (argumentos[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--forcar') opcoes.forcar = true;
    else if (a === '--limpar') opcoes.limpar = true;
    else if (a.startsWith('--')) throw new ErroDeUso(`Opção desconhecida: ${a}\n${USO}`);
    else if (!opcoes.raiz) opcoes.raiz = resolve(a);
    else throw new ErroDeUso(USO);
  }
  if (!opcoes.raiz) throw new ErroDeUso(USO);
  const desconhecidas = opcoes.com.filter((nome) => !ADAPTADORES[nome]);
  if (desconhecidas.length > 0) {
    throw new ErroDeUso(`--com aceita: ${Object.keys(ADAPTADORES).join(', ')}. Não conheço: ${desconhecidas.join(', ')}.`);
  }
  if (!existsSync(opcoes.raiz) || !statSync(opcoes.raiz).isDirectory()) {
    throw new ErroDeUso(`A raiz não existe ou não é uma pasta: ${opcoes.raiz}`);
  }
  if (opcoes.raiz === AQUI || opcoes.raiz.startsWith(`${MODELO}`)) {
    throw new ErroDeUso('A raiz é a pasta do seu projeto (a que contém backend e frontend), não o repositório do harness.');
  }
  return opcoes;
}

function listarArquivos(pasta, prefixo = '') {
  return readdirSync(join(pasta, prefixo), { withFileTypes: true }).flatMap((item) => {
    const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
    return item.isDirectory() ? listarArquivos(pasta, caminho) : [caminho];
  });
}

function arquivosAInstalar(com) {
  const deOutraFerramenta = Object.entries(ADAPTADORES)
    .filter(([nome]) => !com.includes(nome))
    .flatMap(([, caminhos]) => caminhos);
  const ehDeOutraFerramenta = (arquivo) =>
    deOutraFerramenta.some((caminho) => (caminho.endsWith('/') ? arquivo.startsWith(caminho) : arquivo === caminho));
  return listarArquivos(MODELO).filter((arquivo) => !ehDeOutraFerramenta(arquivo));
}

// Backend e frontend são as pastas da raiz que são repositórios git com package.json;
// o frontend é o que depende de uma biblioteca de interface.
function detectarRepos(raiz) {
  const candidatos = readdirSync(raiz, { withFileTypes: true })
    .filter((item) => item.isDirectory() && existsSync(join(raiz, item.name, '.git')))
    .map((item) => ({ pasta: item.name, pacote: lerJson(join(raiz, item.name, 'package.json')) }))
    .filter((candidato) => candidato.pacote);
  const ehFrontend = ({ pacote }) => {
    const dependencias = { ...pacote.dependencies, ...pacote.devDependencies };
    return SINAIS_DE_FRONTEND.some((nome) => nome in dependencias);
  };
  const frontends = candidatos.filter(ehFrontend);
  const backends = candidatos.filter((candidato) => !ehFrontend(candidato));
  const decidido = frontends.length === 1 && backends.length === 1;
  return {
    backend: decidido ? backends[0].pasta : null,
    frontend: decidido ? frontends[0].pasta : null,
    candidatos: candidatos.map((candidato) => candidato.pasta),
  };
}

function lerJson(caminho) {
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
}

function conteudoParaARaiz(arquivo, raiz, repos) {
  const texto = readFileSync(join(MODELO, arquivo), 'utf8');
  if (arquivo === '.codex/hooks.json') {
    // O Codex roda o hook na pasta da sessão, que pode não ser a raiz: o caminho vai absoluto.
    return texto.split('{{RAIZ}}').join(JSON.stringify(raiz).slice(1, -1));
  }
  if (arquivo === 'harness/config.json' && repos.backend) {
    const config = JSON.parse(texto);
    config.repos.backend.dir = repos.backend;
    config.repos.frontend.dir = repos.frontend;
    return `${JSON.stringify(config, null, 2)}\n`;
  }
  const regra = /^\.cursor\/rules\/padrao-(backend|frontend)\.mdc$/.exec(arquivo);
  if (regra && repos[regra[1]]) return texto.replace(`globs: ${regra[1]}/**`, `globs: ${repos[regra[1]]}/**`);
  return texto;
}

const resumo = (texto) => createHash('sha1').update(texto).digest('hex');

function instalarArquivo(arquivo, novo, raiz, manifesto, forcar) {
  const destino = join(raiz, arquivo);
  if (!existsSync(destino)) {
    gravar(destino, novo);
    return 'criado';
  }
  const atual = readFileSync(destino, 'utf8');
  if (atual === novo) return 'igual';
  if (DO_PROJETO.has(arquivo)) return 'do projeto';
  const intocadoDesdeAInstalacao = manifesto[arquivo] === resumo(atual);
  if (intocadoDesdeAInstalacao || forcar) {
    gravar(destino, novo);
    return 'atualizado';
  }
  gravar(`${destino}.novo`, novo);
  return 'conflito';
}

function gravar(caminho, texto) {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, texto);
}

function instalar({ raiz, com, forcar }) {
  const repos = detectarRepos(raiz);
  const manifestoAnterior = lerJson(join(raiz, MANIFESTO))?.arquivos ?? {};
  const manifesto = {};
  const porSituacao = { criado: [], atualizado: [], igual: [], 'do projeto': [], conflito: [] };

  for (const arquivo of arquivosAInstalar(com)) {
    const novo = conteudoParaARaiz(arquivo, raiz, repos);
    const situacao = instalarArquivo(arquivo, novo, raiz, manifestoAnterior, forcar);
    porSituacao[situacao].push(arquivo);
    // Conflito e arquivo do projeto guardam o resumo antigo: continuam sendo "seus" na próxima vez.
    const ficouComOConteudoNovo = ['criado', 'atualizado', 'igual'].includes(situacao);
    if (ficouComOConteudoNovo) manifesto[arquivo] = resumo(novo);
    else if (manifestoAnterior[arquivo]) manifesto[arquivo] = manifestoAnterior[arquivo];
  }
  gravar(join(raiz, MANIFESTO), `${JSON.stringify({ versao: VERSAO, com, arquivos: manifesto }, null, 2)}\n`);
  return { repos, porSituacao };
}

function restosDaVersaoAnterior(raiz) {
  return readdirSync(join(MODELO, '.agents', 'skills'))
    .map((nome) => `.cursor/skills/${nome}`)
    .filter((pasta) => existsSync(join(raiz, pasta, 'SKILL.md')));
}

// Até a versão 0.3 o livro, os pedidos e as respostas de cada condução ficavam dentro da pasta da
// tarefa. Agora ela guarda só o plano, e esses arquivos são resto. Relatório que o humano pediu
// (o qa.md do /qa antigo, uma auditoria do /conferir) não é resto de condução: fica.
const DE_CONDUCAO_ANTIGA = /^(maestro\.json|maestro\.trava|plano\.selado\.md|tarefa\.md|passos|pr-[\w.-]+\.md)$/;

function restosDeConducao(raiz) {
  const tarefas = join(raiz, 'harness', 'tarefas');
  if (!existsSync(tarefas)) return [];
  const itens = readdirSync(tarefas, { withFileTypes: true });
  const soltos = itens.filter((item) => item.isFile() && ['ENTRADA.md', 'RESPOSTA.md'].includes(item.name)).map((item) => item.name);
  const dasTarefas = itens
    .filter((item) => item.isDirectory())
    .flatMap((pasta) => readdirSync(join(tarefas, pasta.name)).filter((nome) => DE_CONDUCAO_ANTIGA.test(nome)).map((nome) => `${pasta.name}/${nome}`));
  return [...soltos, ...dasTarefas].map((caminho) => `harness/tarefas/${caminho}`);
}

// O relatório fala da raiz como ela ficou, não do que o instalador detectou: numa atualização,
// os repositórios e o mapeamento já estão nos arquivos do projeto, que o instalador não toca.
function reposDaRaiz(raiz) {
  const config = lerJson(join(raiz, 'harness', 'config.json'));
  return Object.entries(config?.repos ?? {}).map(([nome, repo]) => {
    const regra = join(raiz, '.cursor', 'rules', `padrao-${nome}.mdc`);
    return {
      nome,
      dir: repo?.dir,
      noLugar: Boolean(repo?.dir) && existsSync(join(raiz, repo.dir, '.git')),
      mapeado: existsSync(regra) && !readFileSync(regra, 'utf8').includes('NÃO MAPEADO'),
    };
  });
}

function proximosPassos(daRaiz) {
  const porMapear = daRaiz.filter((repo) => !repo.mapeado).map((repo) => repo.nome);
  const passos = [
    'node harness/bin/doutor.mjs            (na raiz; lista o que falta)',
    'No Cursor: reabra a pasta como confiável e confira os três hooks em Customize → Hooks',
    'No Cursor, para o maestro andar sozinho: "node harness/bin/maestro.mjs" e "node harness/bin/portoes.mjs" na allowlist de comandos',
    '/entregar <tarefa>          do pedido à PR com os checks verdes, sem perguntar nada no meio (veja docs/exemplo.md)',
    '/revisar <branch ou PR>     revisa linha por linha uma branch que já existe, refatora, faz push e atualiza a PR',
  ];
  if (porMapear.length > 0) {
    passos.push(`Falta mapear o padrão de: ${porMapear.join(' e ')}. O maestro mapeia sozinho na primeira condução; para ler e aprovar antes, rode /mapear <repo>.`);
  }
  return passos;
}

function relatar({ raiz, com, limpar }, { repos, porSituacao }) {
  const quantos = (situacao) => porSituacao[situacao].length;
  const daRaiz = reposDaRaiz(raiz);
  console.log(`HARNESS ${VERSAO} em ${raiz} (ferramentas: ${['cursor', ...com].join(', ')})`);
  console.log(
    `  criados: ${quantos('criado')} · atualizados: ${quantos('atualizado')} · iguais: ${quantos('igual')} · ` +
      `do projeto, mantidos: ${quantos('do projeto')} · conflitos: ${quantos('conflito')}`,
  );
  if (daRaiz.length > 0 && daRaiz.every((repo) => repo.noLugar)) {
    console.log(`Repositórios: ${daRaiz.map((repo) => `${repo.nome} → ${repo.dir}`).join(' · ')}`);
  } else {
    const achados = repos.candidatos.length > 0 ? repos.candidatos.join(', ') : 'nenhum repositório git com package.json';
    console.log(`Repositórios: não deu para decidir sozinho (achei: ${achados}). O /mapear resolve, ou edite repos.*.dir em harness/config.json.`);
  }
  if (quantos('conflito') > 0) {
    console.log('CONFLITOS — o seu arquivo ficou como estava; a versão do harness está ao lado, com final .novo:');
    for (const arquivo of porSituacao.conflito) console.log(`  ${arquivo}  →  junte à mão o conteúdo de ${arquivo}.novo e apague o .novo`);
  }
  const restos = restosDaVersaoAnterior(raiz);
  if (restos.length > 0) {
    console.log('RESTOS da versão anterior — os roteiros agora ficam em .agents/skills; apague estas pastas para não ver comando duplicado:');
    for (const pasta of restos) console.log(`  ${pasta}`);
  }
  const deConducao = restosDeConducao(raiz);
  if (deConducao.length > 0 && limpar) {
    for (const caminho of deConducao) rmSync(join(raiz, caminho), { recursive: true, force: true });
    console.log(`LIMPEZA — apaguei ${deConducao.length} arquivo(s) de condução da versão anterior das pastas de tarefa. Os planos ficaram.`);
  } else if (deConducao.length > 0) {
    console.log(`RESTOS de condução — ${deConducao.length} arquivo(s) que a versão anterior deixava nas pastas de tarefa (maestro.json, passos/, pr-*.md…) e que esta não usa mais.`);
    console.log('  Para apagar (os planos ficam): rode o instalador de novo com --limpar');
  }
  console.log('Próximos passos:');
  proximosPassos(daRaiz).forEach((passo, i) => console.log(`  ${i + 1}. ${passo}`));
}

try {
  const opcoes = lerArgumentos(process.argv.slice(2));
  relatar(opcoes, instalar(opcoes));
} catch (erro) {
  console.error(erro.message);
  process.exitCode = erro instanceof ErroDeUso ? 2 : 1;
}
