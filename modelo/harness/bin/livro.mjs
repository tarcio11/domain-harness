// O livro do maestro: o que já foi feito e conferido na condução de uma tarefa
// (harness/tarefas/<id>/maestro.json). Só o maestro.mjs escreve nele.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RAIZ, tarefaAtual } from './config.mjs';

export const PASTA_DE_TAREFAS = join(RAIZ, 'harness', 'tarefas');
// Sem chamada do maestro por esse tempo, a condução é considerada largada e a guarda volta ao normal.
const JANELA_DE_ATIVIDADE_MS = 90 * 60 * 1000;
const CAMINHO_DO_OPERADOR = join(RAIZ, 'harness', '.maestro', 'operador.json');

export const pastaDaTarefa = (id) => join(PASTA_DE_TAREFAS, id);
const caminhoDoLivro = (id) => join(pastaDaTarefa(id), 'maestro.json');

export function novoLivro(id) {
  return {
    versao: 2,
    tarefa: id,
    criadoEm: new Date().toISOString(),
    chamadas: 0,
    despachos: 0,
    ultimaChamada: Date.now(),
    sequencia: 0,
    tentativas: {},
    problemas: {},
    orientacoes: {},
    decisoes: [],
    respostas: [],
    feitas: [],
    concluidas: [],
    planejamento: { fase: 'plano', voltas: 0, base: null },
    planoAprovado: false,
    ambienteConferido: false,
    selos: { harness: null, plano: null },
    servicos: {},
    ajuste: null,
    repos: {},
    unidade: null,
    aguardando: null,
    parado: null,
    encerrado: null,
    diario: [],
  };
}

export function lerLivro(id = tarefaAtual()) {
  if (!id || !existsSync(caminhoDoLivro(id))) return null;
  return JSON.parse(readFileSync(caminhoDoLivro(id), 'utf8'));
}

export function gravarLivro(livro) {
  mkdirSync(pastaDaTarefa(livro.tarefa), { recursive: true });
  writeFileSync(caminhoDoLivro(livro.tarefa), `${JSON.stringify(livro, null, 2)}\n`);
}

// A condução aberta da tarefa atual, ou null. Nunca lança: é usada pelos hooks.
export function conducaoAberta() {
  try {
    const livro = lerLivro();
    return livro && !livro.encerrado ? livro : null;
  } catch {
    return null;
  }
}

// Ativo: há condução aberta, ela não espera o humano e houve chamada recente.
// É quando branch, commit, push e PR são só do maestro.
export function maestroAtivo() {
  const livro = conducaoAberta();
  return Boolean(livro && !livro.parado && Date.now() - livro.ultimaChamada < JANELA_DE_ATIVIDADE_MS);
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
