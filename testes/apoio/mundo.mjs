// Apoio dos testes do maestro: um mundo temporário (raiz com dois repositórios, remotos de
// mentira e um gh falso), um operador que obedece à AÇÃO, e subagentes simulados por funções.

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO_DO_HARNESS = join(AQUI, '..', '..');
const AUTOR = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev' };
export const BRANCH = 'feature/PARC-482-parser-vendas';

// O portão de mentira: reprova se algum arquivo de src/ contém a palavra QUEBRADO.
const PORTAO = `const fs = require('fs');
const path = require('path');
const listar = (pasta) => fs.readdirSync(pasta, { withFileTypes: true }).flatMap((item) => (item.isDirectory() ? listar(path.join(pasta, item.name)) : [path.join(pasta, item.name)]));
const ruins = listar('src').filter((arquivo) => fs.readFileSync(arquivo, 'utf8').includes('QUEBRADO'));
if (ruins.length > 0) {
  console.error('FALHOU: ' + ruins.join(', '));
  process.exit(1);
}
console.log('testes ok');
`;

const ARQUIVOS = {
  api: {
    'package.json': JSON.stringify({ name: 'api', dependencies: { express: '^4.0.0' } }),
    '.gitignore': 'node_modules/\n',
    'conferir.js': PORTAO,
    'src/parsers/estoque.parser.js': 'exports.parseEstoque = (linha) => ({ id: linha.id, total: linha.total });\n',
    'src/parsers/estoque.parser.test.js': "const { parseEstoque } = require('./estoque.parser');\nparseEstoque({ id: 1, total: 2 });\n",
    'src/routes/index.js': "exports.rotas = ['estoque'];\n",
  },
  web: {
    'package.json': JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0', 'react-scripts': '5.0.1' } }),
    '.gitignore': 'node_modules/\n',
    'conferir.js': PORTAO,
    'src/telas/Estoque.jsx': 'export const Estoque = () => null;\n',
    'src/telas/Estoque.test.jsx': "import { Estoque } from './Estoque';\nEstoque();\n",
  },
};

export const fatia = (id, repo, nome, escopo, espelhos) =>
  [`- [ ] **${id} · ${repo} · ${nome}**`, `  - Escopo: ${escopo}`, `  - Espelho: ${espelhos}`, `  - Entrega: ${nome}`, '  - Prova: `node conferir.js`'].join('\n');

export const F1 = fatia('F1', 'backend', 'parser de vendas', '`src/parsers/`, `src/routes/index.js`', '`src/parsers/estoque.parser.js`, `src/parsers/estoque.parser.test.js`');
export const F2 = fatia('F2', 'frontend', 'tela de vendas', '`src/telas/`', '`src/telas/Estoque.jsx`, `src/telas/Estoque.test.jsx`');

export function plano({ fatias = [F1, F2], aprovados = '', status = 'rascunho', secoesAntigas = '' } = {}) {
  return `# PARC-482 — parser de vendas

Status: ${status}
Card: PARC-482
Branch: \`${BRANCH}\` (o mesmo nos dois repositórios)

## Objetivo

Expor as vendas por parceiro na API e mostrar na tela de vendas.

## Critérios de aceite

- [ ] CA1 — dado um parceiro com vendas, quando a tela abre, então a lista aparece
- [ ] CA2 — dado um período, quando o filtro muda, então a lista é refeita

## Contrato

GET /vendas?parceiro=:id → 200 [{ id, total }] · 400 { erro }

## Fatias

${fatias.join('\n')}

## Premissas

- O total vem em centavos, como no estoque.
${secoesAntigas}
## Desvios aprovados

${aprovados}

## Decisões no caminho

## Pendências

## Estado

- Pronto: —
`;
}

function rodar(programa, args, opcoes = {}) {
  const r = spawnSync(programa, args, { encoding: 'utf8', ...opcoes, env: { ...process.env, ...AUTOR, ...opcoes.env } });
  return { codigo: r.status, saida: r.stdout ?? '', erro: r.stderr ?? '' };
}

export function git(pasta, ...args) {
  const r = rodar('git', args, { cwd: pasta });
  if (r.codigo !== 0) throw new Error(`git ${args.join(' ')} falhou em ${pasta}: ${r.erro}`);
  return r.saida.trim();
}

function gravarArquivos(pasta, arquivos) {
  for (const [caminho, texto] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(pasta, caminho)), { recursive: true });
    writeFileSync(join(pasta, caminho), texto);
  }
}

function alterarJson(caminho, mudar) {
  const dados = JSON.parse(readFileSync(caminho, 'utf8'));
  mudar(dados);
  writeFileSync(caminho, `${JSON.stringify(dados, null, 2)}\n`);
}

// O molde é montado uma vez: dois repositórios com remoto, e o harness instalado e mapeado.
// Cada teste trabalha numa cópia dele.
export function criarMolde() {
  const molde = mkdtempSync(join(tmpdir(), 'maestro-molde-'));
  const raiz = join(molde, 'raiz');
  mkdirSync(join(molde, 'bin'), { recursive: true });
  cpSync(join(AQUI, 'gh-falso.js'), join(molde, 'bin', 'gh'));
  chmodSync(join(molde, 'bin', 'gh'), 0o755);
  for (const [repo, arquivos] of Object.entries(ARQUIVOS)) {
    const pasta = join(raiz, repo);
    const remoto = join(molde, 'remotos', `${repo}.git`);
    gravarArquivos(pasta, arquivos);
    git(pasta, 'init', '-q', '-b', 'main');
    git(pasta, 'add', '-A');
    git(pasta, 'commit', '-q', '-m', 'base');
    mkdirSync(remoto, { recursive: true });
    git(remoto, 'init', '-q', '--bare', '-b', 'main');
    git(pasta, 'remote', 'add', 'origin', remoto);
    git(pasta, 'push', '-q', 'origin', 'main');
    git(pasta, 'fetch', '-q', 'origin');
  }
  const instalacao = rodar(process.execPath, [join(REPO_DO_HARNESS, 'instalar.mjs'), raiz, '--com', 'claude']);
  if (instalacao.codigo !== 0) throw new Error(instalacao.erro);
  alterarJson(join(raiz, 'harness', 'config.json'), (config) => {
    for (const repo of ['backend', 'frontend']) config.repos[repo].portoes = [{ nome: 'testes', cmd: 'node conferir.js' }];
    config.convencoes.commit = 'tipo: descrição curta';
    // Os testes leem a PR em português; o padrão (inglês) tem o teste dele.
    config.convencoes.idiomaDaPr = 'pt';
    config.checks = { intervaloSeg: 0.05, maximoMin: 1, carenciaSemChecksMin: 0.002 };
    Object.assign(config.maestro, { esperaPorChamadaSeg: 8, confirmacaoDeVerdeSeg: 0 });
  });
  for (const [repo, dir] of [['backend', 'api'], ['frontend', 'web']]) {
    const regra = join(raiz, '.cursor', 'rules', `padrao-${repo}.mdc`);
    writeFileSync(regra, `---\ndescription: padrão do ${repo}\nglobs: ${dir}/**\nalwaysApply: false\n---\n\n# Padrão do ${repo}\n\nReceita: imite o arquivo vizinho.\n`);
  }
  return molde;
}

export function novoMundo(molde, { maestro: opcoesDoMaestro = {}, config = null } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'maestro-mundo-'));
  cpSync(molde, pasta, { recursive: true });
  const raiz = join(pasta, 'raiz');
  const remotos = {};
  for (const repo of ['api', 'web']) {
    remotos[repo] = join(pasta, 'remotos', `${repo}.git`);
    git(join(raiz, repo), 'remote', 'set-url', 'origin', remotos[repo]);
  }
  const ghEstado = join(pasta, 'gh.json');
  writeFileSync(ghEstado, JSON.stringify({ autenticado: true, prs: {}, checks: {}, cabecas: {}, leituras: {}, chamadas: [], remotos }));
  // Os testes leem os arquivos de passo depois da corrida: por padrão, o mundo de teste não poda.
  alterarJson(join(raiz, 'harness', 'config.json'), (dados) => {
    Object.assign(dados.maestro, { guardarPassos: true }, opcoesDoMaestro);
    config?.(dados);
  });
  const env = { ...process.env, ...AUTOR, GH_ESTADO: ghEstado, PATH: `${join(pasta, 'bin')}${delimiter}${process.env.PATH}` };
  return { pasta, raiz, ghEstado, env, api: join(raiz, 'api'), web: join(raiz, 'web') };
}

export const destruir = (pasta) => rmSync(pasta, { recursive: true, force: true });
export const gh = (mundo) => JSON.parse(readFileSync(mundo.ghEstado, 'utf8'));
export const mudarGh = (mundo, mudar) => alterarJson(mundo.ghEstado, mudar);
export const mudarConfig = (mundo, mudar) => alterarJson(join(mundo.raiz, 'harness', 'config.json'), mudar);
export const ler = (mundo, caminho) => readFileSync(join(mundo.raiz, caminho), 'utf8');
export const existe = (mundo, caminho) => existsSync(join(mundo.raiz, caminho));

export function gravar(mundo, caminho, texto) {
  mkdirSync(dirname(join(mundo.raiz, caminho)), { recursive: true });
  writeFileSync(join(mundo.raiz, caminho), texto);
}

export const CAMINHO_DO_LIVRO = 'harness/.maestro/conducao/livro.json';
export const livro = (mundo) => JSON.parse(ler(mundo, CAMINHO_DO_LIVRO));
export const mudarLivro = (mundo, mudar) => alterarJson(join(mundo.raiz, CAMINHO_DO_LIVRO), mudar);
export const tarefaAtual = (mundo) => livro(mundo).tarefa;
export const planoDaTarefa = (mundo) => ler(mundo, `harness/tarefas/${tarefaAtual(mundo)}/plano.md`);
export const pastaDaTarefa = (mundo) => readdirSync(join(mundo.raiz, 'harness', 'tarefas', tarefaAtual(mundo)));
// Os arquivos de passo que estão na pasta de trabalho agora.
export const trabalho = (mundo) => (existsSync(join(mundo.raiz, 'harness', 'trabalho')) ? readdirSync(join(mundo.raiz, 'harness', 'trabalho')) : []);

export function maestro(mundo, ...args) {
  return rodar(process.execPath, [join(mundo.raiz, 'harness', 'bin', 'maestro.mjs'), ...args], { cwd: mundo.raiz, env: mundo.env });
}

export function hook(mundo, evento, formato, entrada) {
  const r = rodar(process.execPath, [join(mundo.raiz, 'harness', 'bin', 'hook.mjs'), evento, '--formato', formato], {
    cwd: mundo.raiz,
    env: mundo.env,
    input: JSON.stringify(entrada),
  });
  if (r.codigo !== 0) throw new Error(r.erro);
  return JSON.parse(r.saida);
}

export function iniciar(mundo, tarefa = 'PARC-482: expor as vendas por parceiro na API e mostrar na tela de vendas.') {
  gravar(mundo, 'harness/trabalho/ENTRADA.md', tarefa);
  const r = maestro(mundo, 'iniciar');
  if (r.codigo !== 0) throw new Error(`iniciar falhou: ${r.erro}`);
  return r;
}

export function revisar(mundo, pedido) {
  gravar(mundo, 'harness/trabalho/ENTRADA.md', pedido);
  return maestro(mundo, 'revisar');
}

const PAPEIS = [
  [/^# Roteiro: mapear o padrão de um repositório/m, 'mapear'],
  [/^# Roteiro: reconhecer o código/m, 'reconhecer'],
  [/^# Roteiro: revisar linha por linha/m, 'revisarPr'],
  [/^# Roteiro: escrever o plano/m, 'planejar'],
  [/^# Roteiro: criticar o plano/m, 'criticar'],
  [/^# Roteiro: executar um trabalho/m, 'executar'],
  [/^# Roteiro do revisor/m, 'revisar'],
  [/^# Roteiro: QA na tela/m, 'qa'],
  [/^# Roteiro: escrever a descrição da PR/m, 'descrever'],
];
const entreCrases = (texto) => Array.from(String(texto ?? '').matchAll(/`([^`]+)`/g), (achado) => achado[1]);

// Lê o pedido que a saída do maestro manda repassar, como um subagente leria.
export function lerPedido(mundo, saida) {
  const caminho = /`(harness\/trabalho\/[^`]+\.pedido\.md)`/.exec(saida)?.[1];
  if (!caminho) throw new Error(`a saída não aponta um pedido:\n${saida}`);
  const texto = ler(mundo, caminho);
  const [cabecalho, roteiro] = texto.split('\n---\n');
  const bloco = cabecalho.split('## Parâmetros')[1];
  const parametros = Object.fromEntries(Array.from(bloco.matchAll(/^- ([^:\n]+): (.*)$/gm), (achado) => [achado[1], achado[2]]));
  const papel = PAPEIS.find(([marca]) => marca.test(roteiro))?.[1];
  const caminhos = (nome) => entreCrases(parametros[nome]);
  return {
    caminho,
    texto,
    papel,
    parametros,
    caminhos,
    resultado: caminhos('Arquivo de resultado')[0],
    repo: /^(\w+)/.exec(parametros['Repositório'] ?? '')?.[1] ?? null,
    dir: caminhos('Repositório')[0] ?? null,
    subagente: /subagente `([^`]+)`/.exec(saida)?.[1] ?? null,
  };
}

const textoDaAcao = (saida) => saida.split('\n===\n')[1] ?? '';

// O operador de mentira: roda o maestro e obedece à AÇÃO, sem pensar. É o que a skill /entregar manda.
// "humano" resolve um bloqueio (devolve true) ou deixa a condução parada (devolve null).
export function operar(mundo, subagentes, { humano = () => null, limite = 150 } = {}) {
  const acoes = [];
  const pedidos = [];
  let semResultado = false;
  for (let i = 0; i < limite; i++) {
    const r = maestro(mundo, 'proximo', ...(semResultado ? ['--sem-resultado'] : []));
    semResultado = false;
    const acao = /^AÇÃO: ([A-Z]+)/m.exec(r.saida)?.[1];
    acoes.push(acao);
    if (acao === 'SUBAGENTE') {
      const pedido = lerPedido(mundo, r.saida);
      pedidos.push(pedido);
      if (!subagentes[pedido.papel]) throw new Error(`não há subagente de mentira para o pedido:\n${pedido.texto.slice(0, 400)}`);
      subagentes[pedido.papel](pedido);
    } else if (acao === 'ESPERAR') {
      // O subagente de mentira já voltou: o operador declara que não houve resultado.
      semResultado = true;
    } else if (acao === 'PARE') {
      const pare = textoDaAcao(r.saida);
      const resolveu = humano(pare, acoes.filter((item) => item === 'PARE').length);
      if (resolveu === null || resolveu === undefined) return { fim: 'PARE', texto: pare, acoes, pedidos };
      const retomada = maestro(mundo, 'retomar');
      if (retomada.codigo !== 0) throw new Error(`retomar falhou: ${retomada.erro}`);
    } else if (acao === 'FIM') {
      return { fim: 'FIM', texto: textoDaAcao(r.saida), acoes, pedidos };
    } else if (acao !== 'REPETIR') {
      throw new Error(`saída inesperada do maestro:\n${r.saida}\n${r.erro}`);
    }
  }
  throw new Error(`o operador deu ${limite} voltas sem chegar a PARE nem a FIM: ${acoes.slice(-12).join(' ')}`);
}

// ------------------------------------------------------------------- subagentes de mentira

const listarArquivos = (pasta) =>
  readdirSync(pasta, { withFileTypes: true }).flatMap((item) => (item.isDirectory() ? listarArquivos(join(pasta, item.name)) : [join(pasta, item.name)]));

export function consertar(pasta) {
  for (const arquivo of listarArquivos(join(pasta, 'src'))) {
    const texto = readFileSync(arquivo, 'utf8');
    if (texto.includes('QUEBRADO')) writeFileSync(arquivo, texto.replace(/QUEBRADO/g, 'consertado'));
  }
}

const NOVOS = {
  backend: {
    'src/parsers/vendas.parser.js': 'exports.parseVendas = (linha) => ({ id: linha.id, total: linha.total });\n',
    'src/parsers/vendas.parser.test.js': "const { parseVendas } = require('./vendas.parser');\nparseVendas({ id: 1, total: 2 });\n",
  },
  frontend: {
    'src/telas/Vendas.jsx': 'export const Vendas = () => null;\n',
    'src/telas/Vendas.test.jsx': "import { Vendas } from './Vendas';\nVendas();\n",
  },
};

// O executor de mentira bem-comportado: cria o que a fatia pede (ou mexe um pouco, numa correção)
// e conserta o que estiver quebrado.
export function implementar(mundo, pedido, vez) {
  const pasta = join(mundo.raiz, pedido.dir);
  const [principal] = Object.keys(NOVOS[pedido.repo]);
  consertar(pasta);
  if (!existsSync(join(pasta, principal))) {
    gravarArquivos(pasta, NOVOS[pedido.repo]);
    if (pedido.repo === 'backend') writeFileSync(join(pasta, 'src/routes/index.js'), "exports.rotas = ['estoque', 'vendas'];\n");
  } else {
    writeFileSync(join(pasta, principal), `${readFileSync(join(pasta, principal), 'utf8')}exports.ajuste${vez} = ${vez};\n`);
  }
}

export function aprovacao(pedido) {
  const espelhos = pedido.caminhos('Espelhos');
  const ehTeste = (caminho) => /\.test\./.test(caminho);
  const comparacoes = pedido.caminhos('Arquivos novos').map((novo) => `- ${novo} ↔ ${espelhos.find((espelho) => ehTeste(espelho) === ehTeste(novo)) ?? espelhos[0]}`);
  return ['VEREDITO: APROVADO', 'ACHADOS: 0', 'COMPARAÇÃO:', ...comparacoes].join('\n');
}

// Monta os subagentes de um cenário. Cada papel pode ser trocado por uma função
// (pedido, vez, padrao) => void, em que "vez" conta as chamadas daquele papel.
export const responder = (mundo, pedido, texto) => gravar(mundo, pedido.resultado, `${texto}\n`);

export const MAPA = `# Mapa do código

## Pedido
Expor as vendas por parceiro na API e mostrar na tela de vendas.

## Entrega mais parecida
Estoque por parceiro — mesma forma: um parser, uma rota e uma tela de listagem.

## Fio da entrada ao dado
1. Entrada: \`api/src/routes/index.js\` — a lista de rotas
2. \`api/src/parsers/estoque.parser.js\` — o parser da linha
3. \`web/src/telas/Estoque.jsx\` — a tela

Testes: \`api/src/parsers/estoque.parser.test.js\`, \`web/src/telas/Estoque.test.jsx\`

## Peças e espelhos
| Peça que o pedido cria ou altera | Espelho | Observação |
|---|---|---|
| parser de vendas (novo) | \`api/src/parsers/estoque.parser.js\` | mesmo esqueleto |
| tela de vendas (nova) | \`web/src/telas/Estoque.jsx\` | mesma estrutura |

## Sem parecido
- nada
`;

export function agentes(mundo, trocas = {}, { planoDoCenario = plano() } = {}) {
  const padrao = {
    mapear: (pedido) => {
      const regra = pedido.caminhos('Regra de padrão')[0];
      gravar(mundo, regra, ler(mundo, regra).replace('NÃO MAPEADO', 'mapeado pelo maestro'));
      alterarJson(join(mundo.raiz, 'harness', 'config.json'), (config) => {
        config.repos[pedido.repo].portoes = [{ nome: 'testes', cmd: 'node conferir.js' }];
      });
      responder(mundo, pedido, 'RESULTADO: ok\nEntrega de referência: estoque\nPortões: testes');
    },
    reconhecer: (pedido) => {
      gravar(mundo, pedido.caminhos('Arquivo do mapa')[0], MAPA);
      responder(mundo, pedido, 'RESULTADO: ok\nA entrega mais parecida é o estoque; o fio passa por 3 arquivos.');
    },
    planejar: (pedido) => {
      gravar(mundo, pedido.caminhos('Plano')[0], planoDoCenario);
      responder(mundo, pedido, 'RESULTADO: ok\n2 fatias\n1 premissa');
    },
    revisarPr: (pedido) => responder(mundo, pedido, 'VEREDITO: APROVADO\nACHADOS: 0'),
    criticar: (pedido) => responder(mundo, pedido, 'VEREDITO: APROVADO\nACHADOS: 0'),
    executar: (pedido, vez) => {
      implementar(mundo, pedido, vez);
      responder(mundo, pedido, `RESULTADO: ok\nCOMMIT: feat: work ${vez} on ${pedido.repo}\n\nFeito: o que o trabalho pedia.`);
    },
    revisar: (pedido) => responder(mundo, pedido, aprovacao(pedido)),
    qa: (pedido) => {
      gravar(mundo, pedido.caminhos('Relatório do QA')[0], '| critério | resultado |\n| CA1 | passou |\n| CA2 | passou |\n');
      responder(mundo, pedido, 'RESULTADO: passou\nCA1: passou — a lista aparece\nCA2: passou — o filtro refaz a lista');
    },
    descrever: (pedido) => {
      gravar(mundo, pedido.caminhos('Arquivo da descrição')[0], `## O que e por quê\n\nPARC-482: vendas por parceiro no ${pedido.repo}.\n\n## Como revisar\n\nComece pelo arquivo novo e compare com o espelho do estoque.\n`);
      responder(mundo, pedido, `RESULTADO: ok\nTITULO: PARC-482 vendas por parceiro (${pedido.repo})`);
    },
  };
  const vezes = {};
  return Object.fromEntries(
    Object.keys(padrao).map((papel) => [
      papel,
      (pedido) => {
        vezes[papel] = (vezes[papel] ?? 0) + 1;
        const comportamento = trocas[papel] ?? ((p, vez, fazer) => fazer(p, vez));
        return comportamento(pedido, vezes[papel], padrao[papel]);
      },
    ]),
  );
}

export const tamanho = (caminho) => statSync(caminho).size;

// ------------------------------------------------------------------- apoio dos arquivos de teste

export const papeis = (corrida) => corrida.pedidos.map((pedido) => pedido.papel);
export const dos = (corrida, papel, repo = null) => corrida.pedidos.filter((pedido) => pedido.papel === papel && (!repo || pedido.repo === repo));
export const commitsDaBranch = (pasta, branch = BRANCH) => git(pasta, 'log', '--format=%s', `origin/main..${branch}`).split('\n').filter(Boolean);
// O problema (ou o achado) que um pedido recebeu da tentativa anterior.
export const problemaDe = (mundo, pedido) => ler(mundo, pedido.caminhos('Problema da tentativa anterior')[0] ?? pedido.caminhos('Achados a corrigir').pop());
export const REPROVADO = (achado) => `VEREDITO: REPROVADO\nACHADOS: 1\n1. ${achado}`;
