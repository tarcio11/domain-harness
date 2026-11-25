#!/usr/bin/env node
// O maestro conduz uma tarefa do plano à PR com os checks verdes. O modelo só opera: este script
// decide cada passo, confere o anterior no disco e no git, e para quando a decisão é do humano.
//
//   node harness/bin/maestro.mjs iniciar [id]     começa (o texto da tarefa vem de harness/tarefas/ENTRADA.md)
//   node harness/bin/maestro.mjs proximo          confere o passo anterior e diz o próximo
//   node harness/bin/maestro.mjs retomar          continua depois de um PARE (resposta em harness/tarefas/RESPOSTA.md)
//   node harness/bin/maestro.mjs estado           mostra onde a condução está
//   node harness/bin/maestro.mjs validar-plano    confere o formato do plano da tarefa atual
//   node harness/bin/maestro.mjs encerrar         larga a condução (não mexe no git)

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { limparServicosVelhos, processoVivo } from './acoes.mjs';
import { extrairDesvios, lerConfig, tarefaAtual } from './config.mjs';
import { gravarLivro, lerLivro, lerOperador, novoLivro, PASTA_DE_TAREFAS, pastaDaTarefa } from './livro.mjs';
import {
  abrirConducao, anotarProblema, atualizarEstado, COMANDO, crase, emLista, impressaoDoHarness, lerResultado, parar, pendenciasDoAmbiente,
  pendenciasDosRepos, planoAtual, registrar, reposDoPlano, selarPlano, violacaoDoHarness, violacaoDoPlano,
} from './maestro-base.mjs';
import { conduzirRepo, entregar, estadoDoRepo, receberConjunto, receberDescricao, receberQa, temFatiaAberta } from './maestro-entrega.mjs';
import { aprovarPlano, conduzirAjuste, conduzirPlano, receberAjuste, receberCritica, receberPlano } from './maestro-plano.mjs';
import { conduzirUnidade, receberExecucao, receberRevisao } from './maestro-unidade.mjs';
import { lerPlano, seloDoPlano, validarPlano } from './plano.mjs';

const ENTRADA = join(PASTA_DE_TAREFAS, 'ENTRADA.md');
const RESPOSTA = join(PASTA_DE_TAREFAS, 'RESPOSTA.md');
const ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
const CARTAO = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/;
const PALAVRAS_VAZIAS = new Set(['para', 'com', 'que', 'uma', 'dos', 'das', 'nos', 'nas', 'por', 'como', 'the', 'and']);
const APROVACAO = /^\s*aprovad[oa]\s*[.!]?\s*$/i;
const MAXIMO_DE_TRANSICOES = 60;
const TRAVA_VELHA_MS = 5 * 60 * 1000;

class ErroDeUso extends Error {}

// ---------------------------------------------------------------------------------- máquina

const RECEBER = {
  plano: receberPlano,
  critica: receberCritica,
  ajuste: receberAjuste,
  executar: receberExecucao,
  revisar: receberRevisao,
  conjunto: receberConjunto,
  qa: receberQa,
  descricao: receberDescricao,
};

// Sem o arquivo de resultado, o maestro não adivinha se o subagente ainda trabalha ou se terminou
// sem gravar: só o operador sabe. Chamar "proximo" de novo é sempre seguro; quem declara que o
// subagente terminou sem resultado é o operador, com --sem-resultado.
function receber(m) {
  const espera = m.livro.aguardando;
  const resultado = lerResultado(espera.arquivo);
  if (!resultado.existe && !m.semResultado) return { tipo: 'ESPERAR', titulo: espera.titulo, texto: espera.instrucao, subagente: espera.subagente };
  m.livro.aguardando = null;
  if (!resultado.existe) {
    anotarProblema(m, espera.chave, 'A tentativa anterior terminou sem gravar o arquivo de resultado. O que ela fez pode estar nos arquivos: confira antes de refazer, e termine gravando o arquivo de resultado.');
    registrar(m, `${espera.titulo}: terminou sem resultado`);
    return null;
  }
  return RECEBER[espera.tipo](m, espera, resultado);
}

function umPasso(m) {
  if (!m.livro.ambienteConferido) {
    const pendencias = pendenciasDoAmbiente(m);
    if (pendencias) return parar(m, 'humano', 'ambiente', pendencias);
    m.livro.ambienteConferido = true;
  }
  if (m.livro.planoAprovado && !m.livro.ajuste) {
    const violacao = violacaoDoPlano(m);
    if (violacao) return parar(m, 'humano', 'plano', violacao);
  }
  if (m.livro.aguardando) return receber(m);
  if (m.livro.ajuste) return conduzirAjuste(m);
  if (!m.livro.planoAprovado) return conduzirPlano(m);
  if (m.livro.unidade) return conduzirUnidade(m);
  const plano = planoAtual(m);
  const repo = reposDoPlano(m, plano).find((nome) => estadoDoRepo(m, nome).fase !== 'pronto' || temFatiaAberta(m, plano, nome));
  return repo ? conduzirRepo(m, repo, plano) : entregar(m, plano);
}

function avancar(m) {
  if (m.livro.encerrado) return { tipo: 'FIM', texto: m.livro.encerrado.relatorio };
  if (m.livro.parado) return { tipo: 'PARE', texto: m.livro.parado.texto };
  const violacao = violacaoDoHarness(m);
  if (violacao) return parar(m, 'humano', 'selo', violacao);
  for (let i = 0; i < MAXIMO_DE_TRANSICOES; i++) {
    const acao = umPasso(m);
    if (acao) return acao;
  }
  return parar(m, 'falha', 'geral', 'O maestro deu voltas demais sem chegar a uma ação. Veja o diário em maestro.json e diga como seguir.');
}

// ------------------------------------------------------------------------------------ saída

function ondeEsta(m) {
  if (m.livro.encerrado) return m.livro.encerrado.motivo;
  if (!m.livro.planoAprovado) return 'plano';
  if (m.livro.unidade) return m.livro.unidade.rotulo;
  const emCurso = Object.entries(m.livro.repos).find(([, estado]) => estado.fase !== 'pronto');
  return emCurso ? `${emCurso[0]}: ${emCurso[1].fase}` : 'entrega';
}

function comoAbrirOSubagente(acao) {
  return [
    `1. Abra o subagente ${crase(acao.subagente)}, em primeiro plano (o que bloqueia até terminar). Se a sua ferramenta não tem esse subagente, use um de uso geral que possa editar arquivos e rodar comandos; nunca um só de leitura.`,
    '2. Passe a ele exatamente o texto entre as linhas ===, sem mudar nem acrescentar nada.',
    '3. Espere ele terminar. Não leia arquivos nem confira o trabalho dele: quem confere é o maestro.',
    `4. Rode de novo: ${COMANDO} proximo`,
    'Sua ferramenta não abre subagentes? Faça você mesmo o que o texto manda e siga para o item 4.',
  ];
}

function imprimir(m, acao) {
  const moldura = ['===', (acao.texto ?? '').trim(), '==='];
  const porTipo = {
    SUBAGENTE: () => [`AÇÃO: SUBAGENTE — ${acao.titulo}`, ...comoAbrirOSubagente(acao), ...moldura],
    ESPERAR: () => [
      `AÇÃO: ESPERAR — o passo "${acao.titulo}" ainda não tem resultado`,
      'Escolha UMA opção, a primeira que for verdade:',
      `a) O subagente deste passo ainda está trabalhando → espere ele terminar e rode: ${COMANDO} proximo`,
      `b) Você ainda não abriu o subagente deste passo → abra agora o subagente ${crase(acao.subagente)}, em primeiro plano, com o texto entre as linhas ===; quando ele terminar, rode: ${COMANDO} proximo`,
      `c) O subagente já terminou e respondeu → rode: ${COMANDO} proximo --sem-resultado`,
      ...moldura,
    ],
    REPETIR: () => [`AÇÃO: REPETIR — ${acao.texto}`, `Rode de novo: ${COMANDO} proximo`],
    PARE: () => [
      'AÇÃO: PARE',
      'Mostre ao humano exatamente o texto entre as linhas === e encerre o seu turno. Não tente resolver.',
      `Quando ele responder: grave a resposta dele, sem mudar uma palavra, em harness/tarefas/RESPOSTA.md; rode ${crase(`${COMANDO} retomar`)}; depois rode ${crase(`${COMANDO} proximo`)}.`,
      ...moldura,
    ],
    FIM: () => ['AÇÃO: FIM', 'Mostre ao humano exatamente o texto entre as linhas === e encerre.', ...moldura],
  };
  console.log([`MAESTRO · ${m.id} · ${ondeEsta(m)}`, ...porTipo[acao.tipo]()].join('\n'));
}

// --------------------------------------------------------------------------------- comandos

// Sem id, o maestro dá o nome: código do card (ou a data) e as primeiras palavras da tarefa.
function idDaTarefa(texto) {
  const cartao = CARTAO.exec(texto)?.[0];
  const semAcento = (cartao ? texto.replace(cartao, ' ') : texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const palavras = (semAcento.match(/[a-z0-9]+/g) ?? []).filter((palavra) => palavra.length > 2 && !PALAVRAS_VAZIAS.has(palavra));
  const base = [cartao ?? new Date().toISOString().slice(0, 10), ...palavras.slice(0, 4)].join('-').slice(0, 60);
  for (let sufixo = 1; ; sufixo++) {
    const id = sufixo === 1 ? base : `${base}-${sufixo}`;
    if (!existsSync(pastaDaTarefa(id))) return id;
  }
}

function iniciar(idPedido) {
  const emCurso = tarefaAtual() ? lerLivro() : null;
  if (emCurso && !emCurso.encerrado) {
    throw new ErroDeUso(`Já existe uma condução aberta (${emCurso.tarefa}). Continue com ${crase(`${COMANDO} proximo`)} ou largue com ${crase(`${COMANDO} encerrar`)}.`);
  }
  if (!existsSync(ENTRADA) || readFileSync(ENTRADA, 'utf8').trim() === '') {
    throw new ErroDeUso('Grave antes o texto da tarefa, sem mudar uma palavra do que o humano escreveu, em harness/tarefas/ENTRADA.md.');
  }
  if (idPedido && !ID_VALIDO.test(idPedido)) throw new ErroDeUso(`Id inválido: "${idPedido}". Use só letras, números e hífen, ou rode sem id: ${COMANDO} iniciar`);
  if (idPedido && existsSync(pastaDaTarefa(idPedido))) throw new ErroDeUso(`Já existe a tarefa ${idPedido}. Rode sem id (${COMANDO} iniciar) para o maestro escolher um nome livre.`);
  const id = idPedido ?? idDaTarefa(readFileSync(ENTRADA, 'utf8'));
  mkdirSync(pastaDaTarefa(id), { recursive: true });
  renameSync(ENTRADA, join(pastaDaTarefa(id), 'tarefa.md'));
  writeFileSync(join(PASTA_DE_TAREFAS, 'ATUAL'), `${id}\n`);
  gravarLivro(novoLivro(id));
  limparServicosVelhos();
  console.log(`Condução de ${id} iniciada. Agora rode: ${COMANDO} proximo`);
}

// Plano aprovado à mão (pelo /planejar) e sem livro: o maestro adota e conduz daqui em diante.
function adotarPlanoAprovado() {
  const id = tarefaAtual();
  const caminho = id ? join(pastaDaTarefa(id), 'plano.md') : null;
  if (!caminho || !existsSync(caminho) || lerLivro(id)) return false;
  const plano = lerPlano(readFileSync(caminho, 'utf8'));
  if (plano.status !== 'aprovado') return false;
  const config = lerConfig();
  const erros = validarPlano(plano, config);
  if (erros.length === 0) erros.push(...pendenciasDosRepos({ config }, plano));
  if (erros.length > 0) throw new ErroDeUso(['O plano aprovado tem pendências que impedem a condução:', ...emLista(erros)].join('\n'));
  const livro = novoLivro(id);
  Object.assign(livro, { planoAprovado: true, concluidas: plano.fatias.filter((fatia) => fatia.feita).map((fatia) => fatia.id) });
  livro.selos.plano = seloDoPlano(readFileSync(caminho, 'utf8'));
  writeFileSync(join(pastaDaTarefa(id), 'plano.selado.md'), readFileSync(caminho, 'utf8'));
  livro.decisoes.push('Plano escrito e aprovado por você antes da condução.');
  gravarLivro(livro);
  return true;
}

// Duas chamadas ao mesmo tempo estragariam o livro. Trava de processo morto ou velha não vale.
function comTrava(id, trabalho) {
  const trava = join(pastaDaTarefa(id), 'maestro.trava');
  const dona = existsSync(trava) ? lerJson(trava) : null;
  if (dona && processoVivo(dona.pid) && Date.now() - dona.quando < TRAVA_VELHA_MS) {
    console.log(`AÇÃO: REPETIR — outra chamada do maestro ainda está rodando.\nRode de novo: ${COMANDO} proximo`);
    return;
  }
  writeFileSync(trava, JSON.stringify({ pid: process.pid, quando: Date.now() }));
  try {
    trabalho();
  } finally {
    rmSync(trava, { force: true });
  }
}

function lerJson(caminho) {
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
}

function darOProximoPasso(...argumentos) {
  let m = abrirConducao();
  if (!m && adotarPlanoAprovado()) m = abrirConducao();
  if (!m) throw new ErroDeUso(`Não há condução aberta. Para começar: grave a tarefa em harness/tarefas/ENTRADA.md e rode ${crase(`${COMANDO} iniciar`)}.`);
  comTrava(m.id, () => {
    m.livro.chamadas += 1;
    m.livro.ultimaChamada = Date.now();
    m.prazo = Date.now() + m.opcoes.esperaPorChamadaSeg * 1000;
    m.semResultado = argumentos.includes('--sem-resultado');
    let acao;
    try {
      acao = avancar(m);
    } catch (erro) {
      acao = parar(m, 'falha', 'geral', `O maestro esbarrou num erro que não sabe tratar: ${erro.message}\nResolva e responda, ou largue com ${crase(`${COMANDO} encerrar`)}.`);
    }
    if (acao.tipo === 'PARE') anotarOndeOPareApareceu(m.livro);
    gravarLivro(m.livro);
    imprimir(m, acao);
  });
}

// O hook de shell só deixa "retomar" num turno do humano posterior àquele em que o PARE apareceu
// na conversa. Para isso o livro guarda o primeiro turno de cada conversa que viu esta parada.
function anotarOndeOPareApareceu(livro) {
  const operador = lerOperador();
  if (!operador?.turno || !livro.parado) return;
  livro.parado.mostradoEm ??= {};
  livro.parado.mostradoEm[operador.conversa] ??= operador.turno;
}

// A resposta do humano fica registrada no plano e vai, inteira, para o próximo pedido do passo que parou.
function retomar() {
  const m = abrirConducao();
  if (!m) throw new ErroDeUso('Não há condução aberta.');
  if (!m.livro.parado) {
    console.log(`Nada está parado esperando resposta. Agora rode: ${COMANDO} proximo`);
    return;
  }
  if (!existsSync(RESPOSTA) || readFileSync(RESPOSTA, 'utf8').trim() === '') {
    throw new ErroDeUso('Grave antes a resposta do humano, sem mudar uma palavra, em harness/tarefas/RESPOSTA.md.');
  }
  const resposta = readFileSync(RESPOSTA, 'utf8').trim();
  rmSync(RESPOSTA, { force: true });
  const { tipo, passo } = m.livro.parado;
  m.livro.respostas.push({ quando: new Date().toISOString().slice(0, 10), tipo, texto: resposta.replace(/\s+/g, ' ') });
  atualizarEstado(m, 'o maestro retoma a condução');

  // O humano esteve aqui: os contadores zeram e o que ele mudou à mão passa a ser o estado aprovado.
  Object.assign(m.livro, { parado: null, tentativas: {}, problemas: {} });
  m.livro.selos.harness = impressaoDoHarness();
  if (m.livro.unidade) Object.assign(m.livro.unidade, { voltas: 0, portoesRefeitos: 0, conferenciasRefeitas: 0, commitsRefeitos: 0 });
  for (const estado of Object.values(m.livro.repos)) {
    Object.assign(estado, { voltasDeConjunto: 0, voltasDePublicacao: 0, voltasDeChecks: 0, ciclosDeQa: 0, portoesRefeitos: 0, pushesRefeitos: 0, sincronizado: false });
    if (estado.fase === 'checks') estado.fase = 'publicar';
  }

  const pendentes = planoAtual(m).desviosPendentes;
  const novoAjuste = (respostaDoAjuste) => ({ passo, resposta: respostaDoAjuste, arquivo: null, numero: m.livro.sequencia });
  if (tipo === 'plano' && !m.livro.planoAprovado && APROVACAO.test(resposta)) {
    aprovarPlano(m, 'por você');
    if (pendentes) m.livro.ajuste = novoAjuste('aprovado: os desvios que estavam em "Desvios pendentes" foram aprovados como propostos');
  } else if (tipo === 'plano' && !m.livro.planoAprovado) {
    Object.assign(m.livro.planejamento, { fase: 'plano', voltas: 0, base: null });
    m.livro.orientacoes.plano = resposta;
  } else {
    m.livro.orientacoes[passo] = resposta;
    if (tipo === 'desvio') m.livro.ajuste = novoAjuste(resposta);
  }
  registrar(m, `o humano respondeu (${tipo})`);

  const erros = m.livro.planoAprovado ? validarPlano(planoAtual(m), m.config) : [];
  if (erros.length > 0) {
    m.livro.parado = { tipo: 'humano', passo: 'plano', texto: ['O plano está com erros que impedem a condução. Corrija e responda:', ...emLista(erros)].join('\n'), quando: new Date().toISOString() };
  } else if (m.livro.planoAprovado) {
    selarPlano(m);
  }
  gravarLivro(m.livro);
  console.log(`Resposta registrada. Agora rode: ${COMANDO} proximo`);
}

function mostrarEstado() {
  const m = abrirConducao();
  if (!m) throw new ErroDeUso('Não há condução aberta.');
  const linhas = [`MAESTRO · ${m.id} · ${ondeEsta(m)} · ${m.livro.chamadas} chamadas, ${m.livro.despachos} subagentes`];
  if (m.livro.parado) linhas.push(`PARADO (${m.livro.parado.tipo}) desde ${m.livro.parado.quando}:`, m.livro.parado.texto);
  if (m.livro.aguardando) linhas.push(`Esperando o resultado de: ${m.livro.aguardando.titulo} → ${m.livro.aguardando.arquivo}`);
  linhas.push('Últimos passos:', ...m.livro.diario.slice(-12).map((item) => `- ${item.quando.slice(11, 19)} ${item.linha}`));
  console.log(linhas.join('\n'));
}

function validarPlanoDaTarefa() {
  const id = tarefaAtual();
  const caminho = id ? join(pastaDaTarefa(id), 'plano.md') : null;
  if (!caminho || !existsSync(caminho)) throw new ErroDeUso('Não achei o plano da tarefa atual (harness/tarefas/ATUAL aponta para a pasta da tarefa).');
  const texto = readFileSync(caminho, 'utf8');
  const erros = validarPlano(lerPlano(texto), lerConfig());
  const livro = lerLivro(id);
  if (livro && !livro.planoAprovado && !livro.orientacoes.plano && extrairDesvios(texto).length > 0) {
    erros.push('A seção "Desvios aprovados" só recebe o que o humano aprovou. Mova o que está lá para "Desvios pendentes".');
  }
  if (erros.length === 0) {
    console.log('plano válido');
    return;
  }
  console.log([`O plano tem ${erros.length} erro(s):`, ...emLista(erros)].join('\n'));
  process.exitCode = 1;
}

function encerrar() {
  const m = abrirConducao();
  if (!m) throw new ErroDeUso('Não há condução aberta.');
  m.livro.encerrado = { quando: new Date().toISOString(), motivo: 'largada', relatorio: 'Condução largada pelo humano. O git ficou como estava.' };
  gravarLivro(m.livro);
  console.log(`Condução de ${m.id} largada. Branches, commits e PRs ficaram como estavam.`);
}

const COMANDOS = { iniciar, proximo: darOProximoPasso, retomar, estado: mostrarEstado, 'validar-plano': validarPlanoDaTarefa, encerrar };

try {
  const [comando, ...argumentos] = process.argv.slice(2);
  if (!COMANDOS[comando]) throw new ErroDeUso(`Uso: ${COMANDO} <${Object.keys(COMANDOS).join('|')}>`);
  COMANDOS[comando](...argumentos);
} catch (erro) {
  const mensagem = erro instanceof ErroDeUso ? erro.message : `maestro: erro inesperado: ${erro.stack ?? erro.message}`;
  console.error(mensagem);
  // Quem roda "proximo" e "retomar" é o operador, que só entende AÇÃO: o erro vira uma parada.
  if (['proximo', 'retomar'].includes(process.argv[2])) {
    console.log(['AÇÃO: PARE', 'Mostre ao humano exatamente o texto entre as linhas === e encerre o seu turno. Não tente resolver.', '===', `O maestro não conseguiu rodar: ${mensagem}`, '==='].join('\n'));
  }
  process.exitCode = 2;
}
