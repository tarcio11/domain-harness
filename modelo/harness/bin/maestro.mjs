#!/usr/bin/env node
// O maestro conduz uma tarefa do pedido à PR com os checks verdes, sem perguntar nada. O modelo só
// opera: este script decide cada passo e confere o anterior no disco e no git. O que um modelo
// decide fica registrado; o que não fecha vira pendência na PR; só bloqueio de ambiente para.
//
//   node harness/bin/maestro.mjs iniciar          começa uma entrega (a tarefa vem de harness/trabalho/ENTRADA.md)
//   node harness/bin/maestro.mjs revisar          começa a revisão de uma branch ou PR que já existe (idem)
//   node harness/bin/maestro.mjs proximo          confere o passo anterior e diz o próximo
//   node harness/bin/maestro.mjs retomar          libera um bloqueio, depois que o humano resolveu
//   node harness/bin/maestro.mjs estado           mostra onde a condução está
//   node harness/bin/maestro.mjs validar-plano    confere o formato do plano da tarefa atual
//   node harness/bin/maestro.mjs encerrar         larga a condução (não mexe no git)

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { limparServicosVelhos, processoVivo } from './acoes.mjs';
import { lerConfig, tarefaAtual } from './config.mjs';
import { gravarLivro, lerLivro, lerOperador, limparConducao, limparTrabalho, novoLivro, PASTA_DA_CONDUCAO, PASTA_DE_TAREFAS, PASTA_DE_TRABALHO, pastaDaTarefa } from './livro.mjs';
import {
  abrirConducao, alvoDaConducao, anotarOQueEDoHumano, anotarProblema, bloquear, COMANDO, conferirSeloDoHarness, crase, ehRevisao, emLista, ErroDeUso,
  estadoDoRepo, impressaoDoHarness, lerResultado, manterPlanoSelado, pendenciasDoAmbiente, pendenciasDosRepos, podar, registrar, repetir, reposDoPlano,
  textoDasMudancas,
} from './maestro-base.mjs';
import { conduzirRepo, entregar, receberDescricao, receberLote, receberQa } from './maestro-entrega.mjs';
import { conduzirPlano, receberCritica, receberPlano } from './maestro-plano.mjs';
import { conduzirPreparo, receberMapeamento, receberReconhecimento } from './maestro-preparo.mjs';
import { acharAlvoDaRevisao } from './maestro-revisao.mjs';
import { conduzirUnidade, receberExecucao, receberRevisao } from './maestro-unidade.mjs';
import { lerPlano, seloDoPlano, validarPlano } from './plano.mjs';

const ENTRADA = join(PASTA_DE_TRABALHO, 'ENTRADA.md');
const CARTAO = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/;
const PALAVRAS_VAZIAS = new Set(['para', 'com', 'que', 'uma', 'dos', 'das', 'nos', 'nas', 'por', 'como', 'the', 'and']);
const MAXIMO_DE_TRANSICOES = 80;
const MAXIMO_DE_ERROS_SEGUIDOS = 2;
const TRAVA_VELHA_MS = 5 * 60 * 1000;
// Uma condução com chamada mais recente que isso tem um operador ativo: outra não começa por cima.
const CONDUCAO_VIVA_MS = 10 * 60 * 1000;
const RODAPE_DO_PARE = 'Quando resolver, mande /entregar de novo, sem tarefa: a condução continua de onde parou.';

// ---------------------------------------------------------------------------------- máquina

const RECEBER = {
  mapear: receberMapeamento,
  reconhecer: receberReconhecimento,
  plano: receberPlano,
  critica: receberCritica,
  executar: receberExecucao,
  revisar: receberRevisao,
  lote: receberLote,
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
    if (pendencias) return bloquear(m, 'ambiente', pendencias);
    m.livro.ambienteConferido = true;
  }
  if (m.livro.doHumano === null) {
    const bloqueio = conferirMudancasNoComeco(m);
    if (bloqueio) return bloqueio;
  }
  if (m.livro.planoAprovado) manterPlanoSelado(m);
  if (m.livro.aguardando) return receber(m);
  if (m.livro.preparo.fase !== 'feito') return conduzirPreparo(m);
  if (!ehRevisao(m) && !m.livro.planoAprovado) return conduzirPlano(m);
  if (m.livro.unidade) return conduzirUnidade(m);
  const repo = alvoDaConducao(m).repos.find((nome) => estadoDoRepo(m, nome).fase !== 'pronto');
  return repo ? conduzirRepo(m, repo) : entregar(m);
}

// A primeira chamada de uma condução: nada rodou ainda, então o que está sem commit é do humano, e
// ele ainda está na conversa. É a hora de avisar, e não quarenta minutos depois, quando a condução
// chegar ao repositório. Numa entrega o maestro ainda não sabe em quais vai trabalhar: avisa de todos,
// e o humano pode só mandar seguir (o plano volta a conferir os que forem dele).
function conferirMudancasNoComeco(m) {
  const sujos = anotarOQueEDoHumano(m);
  const certeza = ehRevisao(m) || m.livro.planoAprovado;
  const queImportam = certeza ? sujos.filter((repo) => alvoDaConducao(m).repos.includes(repo)) : sujos;
  return queImportam.length > 0 ? bloquear(m, 'mudancas', textoDasMudancas(m, queImportam, { certeza })) : null;
}

function avancar(m) {
  if (m.livro.encerrado) return { tipo: 'FIM', texto: m.livro.encerrado.relatorio };
  if (m.livro.parado) return { tipo: 'PARE', texto: m.livro.parado.texto };
  conferirSeloDoHarness(m);
  for (let i = 0; i < MAXIMO_DE_TRANSICOES; i++) {
    const acao = umPasso(m);
    if (acao) return acao;
  }
  throw new Error('o maestro deu voltas demais sem chegar a uma ação');
}

// ------------------------------------------------------------------------------------ saída

function ondeEsta(m) {
  if (m.livro.encerrado) return m.livro.encerrado.motivo;
  if (m.livro.preparo.fase !== 'feito') return `preparo: ${m.livro.preparo.fase}`;
  if (!ehRevisao(m) && !m.livro.planoAprovado) return 'plano';
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
  const moldura = (texto) => ['===', (texto ?? '').trim(), '==='];
  const porTipo = {
    SUBAGENTE: () => [`AÇÃO: SUBAGENTE — ${acao.titulo}`, ...comoAbrirOSubagente(acao), ...moldura(acao.texto)],
    ESPERAR: () => [
      `AÇÃO: ESPERAR — o passo "${acao.titulo}" ainda não tem resultado`,
      'Escolha UMA opção, a primeira que for verdade:',
      `a) O subagente deste passo ainda está trabalhando → espere ele terminar e rode: ${COMANDO} proximo`,
      `b) Você ainda não abriu o subagente deste passo → abra agora o subagente ${crase(acao.subagente)}, em primeiro plano, com o texto entre as linhas ===; quando ele terminar, rode: ${COMANDO} proximo`,
      `c) O subagente já terminou e respondeu → rode: ${COMANDO} proximo --sem-resultado`,
      ...moldura(acao.texto),
    ],
    REPETIR: () => [`AÇÃO: REPETIR — ${acao.texto}`, `Rode de novo: ${COMANDO} proximo`],
    PARE: () => [
      'AÇÃO: PARE',
      'Isto é um bloqueio que só o humano resolve. Mostre a ele exatamente o texto entre as linhas === e encerre o seu turno. Não tente resolver nem contornar.',
      `Quando ele responder: rode ${crase(`${COMANDO} retomar`)} e depois ${crase(`${COMANDO} proximo`)}.`,
      ...moldura(`BLOQUEIO — ${acao.texto}\n\n${RODAPE_DO_PARE}`),
    ],
    FIM: () => ['AÇÃO: FIM', 'Mostre ao humano exatamente o texto entre as linhas === e encerre.', ...moldura(acao.texto)],
  };
  console.log([`MAESTRO · ${m.id} · ${ondeEsta(m)}`, ...porTipo[acao.tipo]()].join('\n'));
}

// --------------------------------------------------------------------------------- comandos

const semAcento = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const emPalavras = (texto) => (semAcento(texto).match(/[a-z0-9]+/g) ?? []).filter((palavra) => palavra.length > 2 && !PALAVRAS_VAZIAS.has(palavra));

// O maestro dá o nome da tarefa: código do card (ou a data) e as primeiras palavras dela.
function idDaTarefa(texto) {
  const cartao = CARTAO.exec(texto)?.[0];
  const base = [cartao ?? new Date().toISOString().slice(0, 10), ...emPalavras(cartao ? texto.replace(cartao, ' ') : texto).slice(0, 4)].join('-').slice(0, 60);
  for (let sufixo = 1; ; sufixo++) {
    const id = sufixo === 1 ? base : `${base}-${sufixo}`;
    if (!existsSync(pastaDaTarefa(id))) return id;
  }
}

function lerEntrada() {
  if (!existsSync(ENTRADA) || readFileSync(ENTRADA, 'utf8').trim() === '') {
    throw new ErroDeUso('Grave antes o texto do humano, sem mudar uma palavra, em harness/trabalho/ENTRADA.md.');
  }
  return readFileSync(ENTRADA, 'utf8').trim();
}

// Condução parada ou esquecida não segura a próxima: quem chama uma tarefa nova quer essa.
function liberarLugar() {
  const emCurso = lerLivro();
  if (!emCurso || emCurso.encerrado) return;
  const viva = !emCurso.parado && Date.now() - emCurso.ultimaChamada < CONDUCAO_VIVA_MS;
  if (viva) {
    throw new ErroDeUso(`Já existe uma condução em andamento (${emCurso.tarefa}), com chamada há menos de 10 minutos. Para continuar nela, mande /entregar sem tarefa. Para largá-la: ${COMANDO} encerrar.`);
  }
}

function comecar(livro, pronto) {
  rmSync(ENTRADA, { force: true });
  limparConducao();
  gravarLivro(livro);
  limparServicosVelhos();
  console.log(`${pronto} Agora rode: ${COMANDO} proximo`);
}

function iniciar() {
  liberarLugar();
  const texto = lerEntrada();
  const id = idDaTarefa(texto);
  mkdirSync(PASTA_DE_TAREFAS, { recursive: true });
  writeFileSync(join(PASTA_DE_TAREFAS, 'ATUAL'), `${id}\n`);
  comecar(novoLivro(id, 'entrega', texto), `Condução de ${id} iniciada.`);
}

function revisar() {
  liberarLugar();
  const texto = lerEntrada();
  const alvo = acharAlvoDaRevisao(lerConfig(), texto);
  const id = `revisao-${emPalavras(alvo.branch).join('-').slice(0, 60) || 'branch'}`;
  comecar({ ...novoLivro(id, 'revisao', texto), revisao: alvo }, `Revisão da branch ${alvo.branch} iniciada (${alvo.repos.join(' e ')}).`);
}

// Plano aprovado à mão (pelo /planejar) e ainda não conduzido: o maestro adota e conduz daqui em diante.
function adotarPlanoAprovado(anterior) {
  const id = tarefaAtual();
  const caminho = id ? join(pastaDaTarefa(id), 'plano.md') : null;
  if (!caminho || !existsSync(caminho) || anterior?.tarefa === id) return false;
  const texto = readFileSync(caminho, 'utf8');
  const plano = lerPlano(texto);
  if (plano.status !== 'aprovado') return false;
  const config = lerConfig();
  const erros = validarPlano(plano, config);
  if (erros.length === 0) erros.push(...pendenciasDosRepos({ config }, reposDoPlano({ config }, plano)));
  if (erros.length > 0) throw new ErroDeUso(['O plano aprovado tem pendências que impedem a condução:', ...emLista(erros)].join('\n'));
  limparConducao();
  const livro = novoLivro(id, 'entrega', plano.objetivo || plano.titulo);
  // O humano já entendeu o código e planejou: o preparo e o plano estão feitos.
  Object.assign(livro, { planoAprovado: true, concluidas: plano.fatias.filter((fatia) => fatia.feita).map((fatia) => fatia.id) });
  livro.preparo.fase = 'feito';
  livro.selos.plano = seloDoPlano(texto);
  mkdirSync(PASTA_DA_CONDUCAO, { recursive: true });
  writeFileSync(join(PASTA_DA_CONDUCAO, 'plano.selado.md'), texto);
  gravarLivro(livro);
  return true;
}

// Duas chamadas ao mesmo tempo estragariam o livro. Trava de processo morto ou velha não vale.
function comTrava(trabalho) {
  const trava = join(PASTA_DA_CONDUCAO, 'maestro.trava');
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

// Erro que o maestro não previu: tenta de novo sozinho; se insiste, vira bloqueio, não silêncio.
function avancarComRede(m) {
  try {
    const acao = avancar(m);
    m.livro.errosSeguidos = 0;
    return acao;
  } catch (erro) {
    m.livro.errosSeguidos = (m.livro.errosSeguidos ?? 0) + 1;
    registrar(m, `erro: ${erro.message}`);
    if (m.livro.errosSeguidos <= MAXIMO_DE_ERROS_SEGUIDOS) return repetir(`o maestro esbarrou num erro e vai tentar de novo (${erro.message.split('\n')[0]}).`);
    return bloquear(m, 'geral', `O maestro esbarrou num erro que não sabe tratar: ${erro.message}\nVeja ${crase(`${COMANDO} estado`)}. Para largar a condução: ${crase(`${COMANDO} encerrar`)}.`);
  }
}

function darOProximoPasso(...argumentos) {
  let m = abrirConducao();
  if ((!m || m.livro.encerrado) && adotarPlanoAprovado(m?.livro)) m = abrirConducao();
  if (!m) throw new ErroDeUso(`Não há condução aberta. Para começar: grave o pedido em harness/trabalho/ENTRADA.md e rode ${crase(`${COMANDO} iniciar`)} (ou ${crase(`${COMANDO} revisar`)}).`);
  comTrava(() => {
    m.livro.chamadas += 1;
    m.livro.ultimaChamada = Date.now();
    m.prazo = Date.now() + m.opcoes.esperaPorChamadaSeg * 1000;
    m.semResultado = argumentos.includes('--sem-resultado');
    const acao = avancarComRede(m);
    if (acao.tipo === 'PARE') anotarOndeOPareApareceu(m.livro);
    gravarLivro(m.livro);
    // A pasta de trabalho só guarda o que algum passo ainda vai ler; no fim, não guarda nada.
    if (m.livro.encerrado && !m.opcoes.guardarPassos) limparTrabalho();
    else podar(m);
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

// O humano resolveu o que bloqueava: o maestro confere o ambiente de novo e segue de onde parou.
function retomar() {
  const m = abrirConducao();
  if (!m || m.livro.encerrado) {
    console.log(`Não há condução aberta. Agora rode: ${COMANDO} proximo`);
    return;
  }
  if (!m.livro.parado) {
    console.log(`Nada está bloqueado. Agora rode: ${COMANDO} proximo`);
    return;
  }
  // O humano esteve aqui: o que ele deixou sem commit, ou mexeu durante a pausa, nos repositórios em
  // que a condução ainda não entrou, é dele.
  if (m.livro.doHumano !== null) anotarOQueEDoHumano(m, m.livro.parado.arvores ?? null);
  // Os contadores zeram e o que ele mudou no harness passa a ser o estado conhecido.
  Object.assign(m.livro, { parado: null, ambienteConferido: false, tentativas: {}, errosSeguidos: 0 });
  m.livro.selos.harness = impressaoDoHarness();
  if (m.livro.unidade) Object.assign(m.livro.unidade, { portoesRefeitos: 0, conferenciasRefeitas: 0, commitsRefeitos: 0 });
  for (const estado of Object.values(m.livro.repos)) {
    Object.assign(estado, { portoesRefeitos: 0, pushesRefeitos: 0, errosDeLeitura: 0, sincronizado: false });
    if (estado.fase === 'checks') estado.fase = 'publicar';
  }
  registrar(m, 'o humano liberou o bloqueio');
  gravarLivro(m.livro);
  console.log(`Bloqueio liberado. Agora rode: ${COMANDO} proximo`);
}

function mostrarEstado() {
  const m = abrirConducao();
  if (!m) throw new ErroDeUso('Não há condução aberta nem terminada nesta raiz.');
  const { livro } = m;
  const linhas = [`MAESTRO · ${m.id} · ${ondeEsta(m)} · ${livro.chamadas} chamadas, ${livro.despachos} subagentes`];
  if (livro.parado) linhas.push(`BLOQUEADO desde ${livro.parado.quando}:`, livro.parado.texto);
  if (livro.aguardando) linhas.push(`Esperando o resultado de: ${livro.aguardando.titulo} → ${livro.aguardando.arquivo}`);
  linhas.push(`Decisões: ${livro.decisoes.length} · Pendências: ${livro.pendencias.length} · Avisos: ${(livro.avisos ?? []).length}`);
  linhas.push('Últimos passos:', ...livro.diario.slice(-15).map((item) => `- ${item.quando.slice(11, 19)} ${item.linha}`));
  console.log(linhas.join('\n'));
}

function validarPlanoDaTarefa() {
  const m = abrirConducao();
  const id = m && !m.livro.encerrado && !ehRevisao(m) ? m.id : tarefaAtual();
  const caminho = id ? join(pastaDaTarefa(id), 'plano.md') : null;
  if (!caminho || !existsSync(caminho)) throw new ErroDeUso('Não achei o plano da tarefa atual (harness/tarefas/<id>/plano.md).');
  const erros = validarPlano(lerPlano(readFileSync(caminho, 'utf8')), lerConfig());
  if (erros.length === 0) {
    console.log('plano válido');
    return;
  }
  console.log([`O plano tem ${erros.length} erro(s):`, ...emLista(erros)].join('\n'));
  process.exitCode = 1;
}

function encerrar() {
  const m = abrirConducao();
  if (!m || m.livro.encerrado) throw new ErroDeUso('Não há condução aberta.');
  m.livro.encerrado = { quando: new Date().toISOString(), motivo: 'largada', relatorio: 'Condução largada pelo humano. O git ficou como estava.' };
  gravarLivro(m.livro);
  limparTrabalho();
  console.log(`Condução de ${m.id} largada. Branches, commits e PRs ficaram como estavam.`);
}

const COMANDOS = { iniciar, revisar, proximo: darOProximoPasso, retomar, estado: mostrarEstado, 'validar-plano': validarPlanoDaTarefa, encerrar };

try {
  const [comando, ...argumentos] = process.argv.slice(2);
  if (!COMANDOS[comando]) throw new ErroDeUso(`Uso: ${COMANDO} <${Object.keys(COMANDOS).join('|')}>`);
  COMANDOS[comando](...argumentos);
} catch (erro) {
  const mensagem = erro instanceof ErroDeUso ? erro.message : `maestro: erro inesperado: ${erro.stack ?? erro.message}`;
  console.error(mensagem);
  // Quem roda estes comandos é o operador, que só entende AÇÃO: o erro vira uma parada.
  if (['iniciar', 'revisar', 'proximo', 'retomar'].includes(process.argv[2])) {
    console.log(['AÇÃO: PARE', 'Mostre ao humano exatamente o texto entre as linhas === e encerre o seu turno. Não tente resolver.', '===', `O maestro não conseguiu rodar: ${mensagem}`, '==='].join('\n'));
  }
  process.exitCode = 2;
}
