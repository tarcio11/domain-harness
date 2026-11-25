// O chão comum da condução: o contexto de uma chamada do maestro, os pedidos aos subagentes,
// as paradas, os serviços demorados e os selos do plano e do harness.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import * as acoes from './acoes.mjs';
import { ehRepoGit, lerConfig, nomesDosRepos, pastaDoRepo, RAIZ, tarefaAtual } from './config.mjs';
import { formatarAchado } from './conferir.mjs';
import { gravarLivro, lerLivro, pastaDaTarefa } from './livro.mjs';
import { escreverSecao, lerPlano, marcarFatia, seloDoPlano } from './plano.mjs';

const PADRAO = {
  aprovarPlano: 'auto',
  maximoDeFatias: 8,
  tentativasPorPasso: 2,
  voltasDeRevisao: 2,
  voltasDeChecks: 3,
  ciclosDeQa: 2,
  qa: 'auto',
  exigirChecks: true,
  esperaPorChamadaSeg: 25,
  esperaDeChecksMin: 45,
  confirmacaoDeVerdeSeg: 30,
  maximoDeDespachos: 120,
  subagentes: { padrao: 'maestro-passo' },
};
export const COMANDO = 'node harness/bin/maestro.mjs';
const PASTA_DE_ROTEIROS = join(RAIZ, 'harness', 'roteiros');
// O papel de cada subagente e o roteiro que ele recebe dentro do pedido.
const ROTEIROS = {
  planejar: 'maestro/planejar.md',
  criticar: 'maestro/criticar-plano.md',
  executar: 'maestro/executar.md',
  revisar: 'revisor.md',
  qa: 'maestro/qa.md',
  descrever: 'maestro/descrever-pr.md',
};
const MAXIMO_DE_SERVICOS_REFEITOS = 2;
const REGRAS_DE_TODO_PEDIDO = [
  'Regras que valem para qualquer pedido:',
  '- Nunca rode `git commit`, `git push`, troca de branch, `git stash`, `git reset` nem `gh pr`: branch, commit, push e PR são do maestro.',
  '- Nunca rode `node harness/bin/maestro.mjs` com `iniciar`, `proximo`, `retomar` ou `encerrar`.',
  '- Em `harness/`, grave só os arquivos que este pedido manda gravar.',
  '- Não faça perguntas: ninguém vai responder. Se faltar informação, faça o que o roteiro manda para esse caso.',
];

// ---------------------------------------------------------------------------------- contexto

export const relativo = (caminho) => relative(RAIZ, caminho).split(sep).join('/');
export const crase = (texto) => `\`${texto}\``;
export const crases = (itens) => itens.map(crase).join(', ');
export const emLista = (itens) => itens.map((item) => `- ${item}`);
export const resumo = (texto) => createHash('sha1').update(texto).digest('hex');
export const regraDePadrao = (repo) => `.cursor/rules/padrao-${repo}.mdc`;
export const semRepetir = (itens) => Array.from(new Set(itens));

export function abrirConducao() {
  const id = tarefaAtual();
  const livro = id ? lerLivro(id) : null;
  if (!livro) return null;
  const config = lerConfig();
  const pasta = pastaDaTarefa(id);
  return {
    id,
    livro,
    config,
    opcoes: { ...PADRAO, ...config.maestro, subagentes: { ...PADRAO.subagentes, ...config.maestro?.subagentes } },
    pasta,
    caminhoDoPlano: join(pasta, 'plano.md'),
    caminhoDaTarefa: join(pasta, 'tarefa.md'),
    prazo: Date.now(),
    semResultado: false,
  };
}

export const textoDoPlano = (m) => (existsSync(m.caminhoDoPlano) ? readFileSync(m.caminhoDoPlano, 'utf8') : null);
export const gravarPlano = (m, texto) => writeFileSync(m.caminhoDoPlano, texto);
export const planoAtual = (m) => lerPlano(textoDoPlano(m) ?? '');
export const dirDoRepo = (m, repo) => m.config.repos[repo].dir;
export const rotuloDoRepo = (m, repo) => `${repo} (pasta ${crase(dirDoRepo(m, repo))})`;
export const reposDoPlano = (m, plano) => nomesDosRepos(m.config).filter((repo) => plano.fatias.some((fatia) => fatia.repo === repo));
export const ehCodigo = (m, caminho) => (m.config.extensoesDeCodigo ?? []).includes(extname(caminho).slice(1));
export const bloqueiosDe = (diff) => diff.achados.filter((achado) => achado.nivel === 'bloqueio' && !achado.liberado).map(formatarAchado);
export const avisosDe = (diff) => diff.achados.filter((achado) => achado.nivel === 'aviso').map(formatarAchado);
// A resposta do humano vale para o passo que parou; quem não tem resposta própria herda a do repositório.
export const orientacao = (m, ...chaves) => chaves.map((chave) => m.livro.orientacoes[chave]).find(Boolean) ?? '(nenhuma)';

export function registrar(m, linha) {
  m.livro.diario.push({ quando: new Date().toISOString(), linha });
  if (m.livro.diario.length > 300) m.livro.diario.shift();
}

// Cada arquivo de passo ganha um número de ordem: a pasta passos/ é a trilha de auditoria da condução.
function caminhoDoPasso(m, nome) {
  m.livro.sequencia += 1;
  const caminho = join(m.pasta, 'passos', `${String(m.livro.sequencia).padStart(2, '0')}-${nome}`);
  mkdirSync(dirname(caminho), { recursive: true });
  return caminho;
}

export function gravarNoPasso(m, nome, texto) {
  const caminho = caminhoDoPasso(m, nome);
  writeFileSync(caminho, `${texto.trim()}\n`);
  return relativo(caminho);
}

// O problema vai para um arquivo, e a próxima tentativa do mesmo passo recebe o caminho dele.
export function anotarProblema(m, chave, texto) {
  m.livro.problemas[chave] = gravarNoPasso(m, `${chave}-problema.md`, texto);
}

function ultimoProblema(m, chave) {
  const arquivo = m.livro.problemas[chave];
  return arquivo && existsSync(join(RAIZ, arquivo)) ? readFileSync(join(RAIZ, arquivo), 'utf8').trim() : null;
}

export function lerResultado(caminhoRelativo) {
  const caminho = join(RAIZ, caminhoRelativo);
  if (!existsSync(caminho)) return { existe: false };
  const texto = readFileSync(caminho, 'utf8').trim();
  // Tolera enfeite de markdown em volta do rótulo: "**RESULTADO:** ok", "# VEREDITO: APROVADO".
  const campo = (nome) => new RegExp(`^[\\s#>*_\`-]*${nome}[*_\`]*\\s*:[*_\`\\s]*(.+?)[*_\`\\s]*$`, 'mi').exec(texto)?.[1] ?? null;
  const palavra = (valor) => /[A-Za-zÀ-ú]+/.exec(valor ?? '')?.[0] ?? null;
  return {
    existe: true,
    texto,
    campo,
    resultado: palavra(campo('RESULTADO'))?.toLowerCase() ?? null,
    veredito: palavra(campo('VEREDITO'))?.toUpperCase() ?? null,
    commit: campo('COMMIT'),
    titulo: campo('TITULO') ?? campo('TÍTULO'),
  };
}

// ------------------------------------------------------------------------------------ ações

export function parar(m, tipo, passo, texto) {
  m.livro.aguardando = null;
  m.livro.parado = { tipo, passo, texto, quando: new Date().toISOString() };
  registrar(m, `parou (${tipo}): ${texto.split('\n')[0]}`);
  atualizarEstado(m, `o maestro parou e espera você (${tipo})`);
  return { tipo: 'PARE', texto };
}

export const repetir = (texto) => ({ tipo: 'REPETIR', texto });
export const segundosDesde = (quando) => Math.max(0, Math.round((Date.now() - quando) / 1000));

// As seções "Estado" e "Decisões do humano" do plano são do maestro: ele as reescreve a partir
// do livro, para que um planejador que regrave o plano não apague o que o humano decidiu.
export function atualizarEstado(m, proximo) {
  const texto = textoDoPlano(m);
  if (!texto) return;
  const estado = [`- Pronto: ${m.livro.concluidas.join(', ') || '—'}`, `- Próximo passo: ${proximo}`, `- Condução: ${crase(`${COMANDO} estado`)}`];
  const decisoes = m.livro.respostas.map((resposta) => `- ${resposta.quando} (${resposta.tipo}): ${resposta.texto}`);
  const comDecisoes = decisoes.length > 0 ? escreverSecao(texto, 'Decisões do humano', decisoes.join('\n')) : texto;
  gravarPlano(m, escreverSecao(comDecisoes, 'Estado', estado.join('\n')));
}

function montarPedido(m, numero, titulo, parametros, roteiro) {
  return [
    `# Pedido ${numero} — ${titulo}`,
    '',
    `Você é um subagente na condução da tarefa ${crase(m.id)}. Faça só o que este pedido manda, do começo ao fim. O seu trabalho só conta se você terminar gravando o arquivo de resultado, no formato que o roteiro pede.`,
    '',
    ...REGRAS_DE_TODO_PEDIDO,
    '',
    '## Parâmetros',
    '',
    ...Object.entries(parametros).map(([nome, valor]) => `- ${nome}: ${valor}`),
    '',
    '---',
    '',
    roteiro.trim(),
    '',
  ].join('\n');
}

// Um passo vira um arquivo de pedido (parâmetros e roteiro juntos) e uma linha para o operador
// repassar. Quanto menos texto passa pela mão do operador, menos chance de chegar torto.
export function despachar(m, passo) {
  const limite = passo.limite ?? 1 + m.opcoes.tentativasPorPasso;
  const feitas = m.livro.tentativas[passo.chave] ?? 0;
  if (feitas >= limite) {
    const motivo = ultimoProblema(m, passo.chave);
    const texto = [`O passo "${passo.titulo}" não fechou em ${feitas} tentativas.`, motivo && `Último problema:\n${motivo}`, 'Diga como seguir (por exemplo: "tenta de novo", ou uma orientação).'];
    return parar(m, 'falha', passo.orientacao ?? passo.chave, texto.filter(Boolean).join('\n\n'));
  }
  if (m.livro.despachos >= m.opcoes.maximoDeDespachos) {
    return parar(m, 'falha', 'geral', `Esta condução já abriu ${m.livro.despachos} subagentes. Algo está em laço: veja ${crase(`${COMANDO} estado`)} e diga como seguir.`);
  }
  const caminhoDoRoteiro = join(PASTA_DE_ROTEIROS, ROTEIROS[passo.papel]);
  if (!existsSync(caminhoDoRoteiro)) {
    return parar(m, 'humano', 'selo', `Falta o roteiro ${relativo(caminhoDoRoteiro)}. Rode o instalador do harness de novo e responda.`);
  }
  m.livro.tentativas[passo.chave] = feitas + 1;
  m.livro.despachos += 1;

  const base = caminhoDoPasso(m, passo.chave);
  const numero = String(m.livro.sequencia).padStart(2, '0');
  const arquivo = relativo(`${base}.md`);
  const pedido = relativo(`${base}.pedido.md`);
  const titulo = `${passo.titulo} (tentativa ${feitas + 1} de ${limite})`;
  const parametros = { ...passo.parametros };
  if (!('Achados a corrigir' in parametros)) {
    parametros['Problema da tentativa anterior'] = m.livro.problemas[passo.chave] ? crase(m.livro.problemas[passo.chave]) : '(nenhum)';
  }
  parametros['Arquivo de resultado'] = crase(arquivo);
  writeFileSync(join(RAIZ, pedido), montarPedido(m, numero, titulo, parametros, readFileSync(caminhoDoRoteiro, 'utf8')));

  const instrucao = `Leia o arquivo ${crase(pedido)} inteiro e faça exatamente o que ele manda, do começo ao fim. Não faça nada além disso. Quando terminar, responda só: feito.`;
  const subagente = m.opcoes.subagentes[passo.papel] ?? m.opcoes.subagentes.padrao;
  m.livro.aguardando = { ...passo.extra, tipo: passo.tipo, chave: passo.chave, titulo, arquivo, pedido, instrucao, subagente };
  return { tipo: 'SUBAGENTE', titulo, texto: instrucao, subagente };
}

// Um serviço demorado (portões, commit, push) atravessa várias chamadas do maestro.
// O livro guarda o nome dele, já gravado em disco, para a chamada seguinte reencontrá-lo.
export function comServico(m, chave, usar) {
  if (!m.livro.servicos[chave]) {
    m.livro.servicos[chave] = `${chave}-${Date.now().toString(36)}`;
    gravarLivro(m.livro);
  }
  const desfecho = usar(m.livro.servicos[chave]);
  if (desfecho.estado !== 'rodando') delete m.livro.servicos[chave];
  return desfecho;
}

// Serviço interrompido se refaz sozinho, até um limite. Devolve true quando o limite estourou.
export function estourouAsRefeitas(dono, contador) {
  dono[contador] = (dono[contador] ?? 0) + 1;
  return dono[contador] > MAXIMO_DE_SERVICOS_REFEITOS;
}

// ------------------------------------------------------------------------------------ selos
// O plano e o próprio harness só mudam com o humano por perto. Fora disso, mudança é adulteração
// (um subagente "aprovando" o próprio desvio, afrouxando um portão) e a condução para.

// O que define as regras do jogo: a lei, a configuração, os scripts, os roteiros, o padrão mapeado
// e a ligação dos hooks em cada ferramenta.
const SELADOS = ['AGENTS.md', 'CLAUDE.md', 'harness/config.json', '.cursor/hooks.json', '.claude/settings.json', '.codex/hooks.json'];
const PASTAS_SELADAS = ['harness/bin', 'harness/roteiros', '.cursor/rules', '.cursor/agents', '.claude/agents', '.agents/skills'];

export function impressaoDoHarness() {
  const arquivos = [...SELADOS, ...PASTAS_SELADAS.flatMap((pasta) => listarArquivos(join(RAIZ, pasta)).map(relativo))];
  const existentes = arquivos.filter((arquivo) => existsSync(join(RAIZ, arquivo))).sort();
  return Object.fromEntries(existentes.map((arquivo) => [arquivo, resumo(readFileSync(join(RAIZ, arquivo)))]));
}

function listarArquivos(pasta) {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta, { withFileTypes: true }).flatMap((item) => (item.isDirectory() ? listarArquivos(join(pasta, item.name)) : [join(pasta, item.name)]));
}

export function violacaoDoHarness(m) {
  const agora = impressaoDoHarness();
  const selado = m.livro.selos.harness;
  if (!selado) {
    m.livro.selos.harness = agora;
    return null;
  }
  const mudaram = semRepetir([...Object.keys(selado), ...Object.keys(agora)]).filter((arquivo) => selado[arquivo] !== agora[arquivo]);
  if (mudaram.length === 0) return null;
  return [
    'Arquivos do harness mudaram durante a condução:',
    ...emLista(mudaram.sort()),
    'Só você altera o harness. Se foi você (ou uma atualização do harness), responda "fui eu". Se não foi, rode o instalador de novo para restaurar os scripts, confira harness/config.json e responda.',
  ].join('\n');
}

const copiaSeladaDoPlano = (m) => join(m.pasta, 'plano.selado.md');

export function selarPlano(m) {
  const texto = textoDoPlano(m);
  m.livro.selos.plano = seloDoPlano(texto);
  writeFileSync(copiaSeladaDoPlano(m), texto);
}

export function violacaoDoPlano(m) {
  const texto = textoDoPlano(m);
  const copia = relativo(copiaSeladaDoPlano(m));
  if (!texto) return `O plano sumiu de ${relativo(m.caminhoDoPlano)}. Restaure a partir de ${copia} e responda.`;
  if (seloDoPlano(texto) !== m.livro.selos.plano) {
    return [
      `O plano (${relativo(m.caminhoDoPlano)}) foi alterado fora do maestro.`,
      `A versão que você aprovou está em ${copia}: compare as duas.`,
      'Se a mudança é sua, responda "fui eu". Se não é, copie a versão aprovada de volta e responda.',
    ].join('\n');
  }
  reporMarcasDoPlano(m, texto);
  return null;
}

// A marca [x] de cada fatia é do maestro: vale o que o livro registrou, não o que está no papel.
function reporMarcasDoPlano(m, texto) {
  const corrigido = lerPlano(texto).fatias.reduce((atual, fatia) => {
    const feita = m.livro.concluidas.includes(fatia.id);
    return fatia.feita === feita ? atual : marcarFatia(atual, fatia.id, feita);
  }, texto);
  if (corrigido !== texto) gravarPlano(m, corrigido);
}

// --------------------------------------------------------------------------------- ambiente

export function pendenciasDoAmbiente(m) {
  const pendencias = [acoes.ambienteDoGitHub()].filter(Boolean);
  const repos = nomesDosRepos(m.config).filter((repo) => ehRepoGit(pastaDoRepo(m.config, repo)));
  if (repos.length === 0) pendencias.push(`Nenhum repositório de harness/config.json existe como repositório git. Rode ${crase('node harness/bin/doutor.mjs')}.`);
  for (const repo of repos) {
    if (!acoes.temOrigem(pastaDoRepo(m.config, repo))) pendencias.push(`O repositório ${repo} não tem o remoto "origin".`);
  }
  if (pendencias.length === 0) return null;
  return [
    'O ambiente não está pronto para uma entrega até a PR:',
    ...emLista(pendencias),
    `Se o terminal do agente roda em sandbox sem rede (Cursor), ponha ${crase(COMANDO)} na allowlist de comandos. Corrija e responda "feito".`,
  ].join('\n');
}

export function pendenciasDosRepos(m, plano) {
  return reposDoPlano(m, plano).flatMap((repo) => {
    const pendencias = [];
    if (!ehRepoGit(pastaDoRepo(m.config, repo))) pendencias.push(`${repo}: a pasta "${dirDoRepo(m, repo)}" não é um repositório git`);
    if ((m.config.repos[repo].portoes ?? []).length === 0) pendencias.push(`${repo}: nenhum portão configurado (rode /mapear ${repo})`);
    const regra = join(RAIZ, regraDePadrao(repo));
    const mapeada = existsSync(regra) && !readFileSync(regra, 'utf8').includes('NÃO MAPEADO');
    if (!mapeada) pendencias.push(`${repo}: o padrão não está mapeado (rode /mapear ${repo})`);
    return pendencias;
  });
}
