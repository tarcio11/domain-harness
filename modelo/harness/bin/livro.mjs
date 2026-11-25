// O livro do maestro: o que já foi feito e conferido na condução em curso. Só o maestro.mjs escreve nele.
// Nada disso mora na pasta da tarefa, que guarda só o plano:
//   harness/.maestro/conducao/     o que é do script (livro, cópia selada do plano, corpo da PR)
//   harness/.maestro/descartados/  o que o maestro tirou de um repositório, em patch, por tarefa
//   harness/trabalho/              os arquivos que os subagentes leem e gravam; podados a cada passo, apagados no fim

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CAMINHO_DO_LIVRO, RAIZ } from './config.mjs';

export const PASTA_DE_TAREFAS = join(RAIZ, 'harness', 'tarefas');
export const PASTA_DA_CONDUCAO = dirname(CAMINHO_DO_LIVRO);
export const PASTA_DE_TRABALHO = join(RAIZ, 'harness', 'trabalho');
export const PASTA_DOS_DESCARTES = join(RAIZ, 'harness', '.maestro', 'descartados');
// O que foi descartado nas últimas tarefas continua à mão; o resto sai quando uma condução nova começa.
const TAREFAS_COM_DESCARTE_GUARDADO = 5;
export const TRABALHO = 'harness/trabalho';
// Sem chamada do maestro por esse tempo, a condução é considerada largada e a guarda volta ao normal.
const JANELA_DE_ATIVIDADE_MS = 90 * 60 * 1000;
const CAMINHO_DO_OPERADOR = join(RAIZ, 'harness', '.maestro', 'operador.json');
const ARQUIVO_DE_PASSO = /^\d+-/;
const CITACAO = /harness\/trabalho\/([\w.-]+)/g;

export const pastaDaTarefa = (id) => join(PASTA_DE_TAREFAS, id);

export function novoLivro(id, tipo, pedido) {
  return {
    versao: 3,
    tarefa: id,
    tipo,
    pedido,
    criadoEm: new Date().toISOString(),
    chamadas: 0,
    despachos: 0,
    ultimaChamada: Date.now(),
    sequencia: 0,
    tentativas: {},
    problemas: {},
    decisoes: [],
    pendencias: [],
    avisos: [],
    feitas: [],
    concluidas: [],
    preparo: { fase: 'mapear', pedido: null, arquivoDoMapa: null, mapaNoPlano: false },
    planejamento: { fase: 'plano', voltas: 0, base: null },
    planoAprovado: false,
    ambienteConferido: false,
    // Os repositórios que tinham mudança sem commit quando o humano passou a vez (null: ainda não olhei).
    doHumano: null,
    selos: { harness: null, plano: null },
    servicos: {},
    revisao: null,
    interrompida: false,
    errosSeguidos: 0,
    repos: {},
    unidade: null,
    aguardando: null,
    parado: null,
    encerrado: null,
    diario: [],
  };
}

export function lerLivro() {
  if (!existsSync(CAMINHO_DO_LIVRO)) return null;
  return JSON.parse(readFileSync(CAMINHO_DO_LIVRO, 'utf8'));
}

export function gravarLivro(livro) {
  mkdirSync(PASTA_DA_CONDUCAO, { recursive: true });
  writeFileSync(CAMINHO_DO_LIVRO, `${JSON.stringify(livro, null, 2)}\n`);
}

// A condução aberta, ou null. Nunca lança: é usada pelos hooks.
export function conducaoAberta() {
  try {
    const livro = lerLivro();
    return livro && !livro.encerrado ? livro : null;
  } catch {
    return null;
  }
}

// Ativo: há condução aberta, ela não está bloqueada e houve chamada recente.
// É quando branch, commit, push e PR são só do maestro.
export function maestroAtivo() {
  const livro = conducaoAberta();
  return Boolean(livro && !livro.parado && Date.now() - livro.ultimaChamada < JANELA_DE_ATIVIDADE_MS);
}

// Uma condução nova começa de pasta vazia: o que sobrou da anterior não se mistura.
export function limparConducao() {
  rmSync(PASTA_DA_CONDUCAO, { recursive: true, force: true });
  limparTrabalho();
  podarDescartes();
}

function podarDescartes() {
  if (!existsSync(PASTA_DOS_DESCARTES)) return;
  const pastas = readdirSync(PASTA_DOS_DESCARTES)
    .map((nome) => ({ nome, quando: statSync(join(PASTA_DOS_DESCARTES, nome)).mtimeMs }))
    .sort((a, b) => b.quando - a.quando);
  for (const { nome } of pastas.slice(TAREFAS_COM_DESCARTE_GUARDADO)) rmSync(join(PASTA_DOS_DESCARTES, nome), { recursive: true, force: true });
}

// Apaga os arquivos de passo. A entrada do operador (ENTRADA.md) não é arquivo de passo.
export function limparTrabalho() {
  for (const nome of arquivosDeTrabalho()) rmSync(join(PASTA_DE_TRABALHO, nome), { force: true });
  if (existsSync(PASTA_DE_TRABALHO) && readdirSync(PASTA_DE_TRABALHO).length === 0) rmSync(PASTA_DE_TRABALHO, { recursive: true, force: true });
}

function arquivosDeTrabalho() {
  if (!existsSync(PASTA_DE_TRABALHO)) return [];
  return readdirSync(PASTA_DE_TRABALHO).filter((nome) => ARQUIVO_DE_PASSO.test(nome));
}

// A poda: fica o arquivo de passo que o livro cita, e o que um arquivo que fica cita. O resto já
// cumpriu o papel e sai da pasta.
export function podarTrabalho(livro) {
  const citados = (texto) => Array.from(texto.matchAll(CITACAO), (achado) => achado[1].replace(/\.+$/, ''));
  const emUso = new Set();
  const fila = citados(JSON.stringify({ ...livro, diario: null }));
  while (fila.length > 0) {
    const nome = fila.pop();
    const caminho = join(PASTA_DE_TRABALHO, nome);
    if (emUso.has(nome) || !existsSync(caminho)) continue;
    emUso.add(nome);
    fila.push(...citados(readFileSync(caminho, 'utf8')));
  }
  for (const nome of arquivosDeTrabalho()) {
    if (!emUso.has(nome)) rmSync(join(PASTA_DE_TRABALHO, nome), { force: true });
  }
}

// O operador é a conversa que roda o maestro. O hook de fim de turno só empurra essa conversa.
export function lerOperador() {
  try {
    return JSON.parse(readFileSync(CAMINHO_DO_OPERADOR, 'utf8'));
  } catch {
    return null;
  }
}

export function gravarOperador(operador) {
  mkdirSync(dirname(CAMINHO_DO_OPERADOR), { recursive: true });
  writeFileSync(CAMINHO_DO_OPERADOR, JSON.stringify(operador));
}
