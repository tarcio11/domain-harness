// A revisão linha por linha. Serve aos dois comandos: no /entregar ela vem depois das fatias, antes
// de publicar; no /revisar ela é o trabalho inteiro, sobre uma branch que já existe.
// O diff é dividido em lotes que cabem numa janela de contexto. Cada lote tem um revisor de
// contexto limpo, e o que ele aponta vira um ajuste: uma unidade de trabalho com commit pequeno.

import * as acoes from './acoes.mjs';
import { branchAtual, ehBranchProtegida, ehRepoGit, git, globParaRegex, nomesDosRepos, pastaDoRepo } from './config.mjs';
import { conferirRepo, formatarAchado } from './conferir.mjs';
import {
  anotarProblema, avisar, baseDoRepo, bi, crase, crases, despachar, dirDoRepo, ehRevisao, emLista, ErroDeUso, esquecerPasso, estadoDoRepo, idiomas, limparSobras,
  ondeEstaOMapa, pedirReparo, registrar, regraDePadrao, relativo, rotuloDoRepo, semRepetir,
} from './maestro-base.mjs';
import { achadosDoParecer, errosDoParecer } from './maestro-parecer.mjs';
import { hashDaArvore } from './recibo.mjs';

export const REVISAO_TERMINADA = Symbol('revisão terminada');
const PONTOS_GUARDADOS = 8;

// ------------------------------------------------------------------------------------ lotes

function montarLotes(m, repo, referencia) {
  const pasta = pastaDoRepo(m.config, repo);
  const fora = [...(m.config.orcamento?.ignorar ?? []), ...(m.config.protegidos ?? [])].map((glob) => globParaRegex(glob));
  const arquivos = acoes
    .arquivosMudados(pasta, referencia)
    .filter((arquivo) => arquivo.linhas > 0 && !fora.some((regex) => regex.test(arquivo.caminho)))
    .sort((a, b) => a.caminho.localeCompare(b.caminho));
  const lotes = [];
  for (const arquivo of arquivos) {
    const atual = lotes[lotes.length - 1];
    const cabe = atual && atual.linhas + arquivo.linhas <= m.opcoes.linhasPorLote && atual.arquivos.length < m.opcoes.arquivosPorLote;
    if (cabe) {
      atual.arquivos.push(arquivo.caminho);
      atual.linhas += arquivo.linhas;
    } else {
      lotes.push({ arquivos: [arquivo.caminho], linhas: arquivo.linhas, status: 'pendente' });
    }
  }
  if (lotes.length > m.opcoes.maximoDeLotes) {
    const cortados = lotes.splice(m.opcoes.maximoDeLotes);
    avisar(m, `A revisão linha por linha de ${repo} cobriu os primeiros ${m.opcoes.maximoDeLotes} lotes; ${cortados.reduce((soma, lote) => soma + lote.arquivos.length, 0)} arquivos ficaram de fora (maestro.maximoDeLotes).`);
  }
  return lotes;
}

const entreAspas = (caminho) => (/^[\w@%+=:,./-]+$/.test(caminho) ? caminho : `'${caminho.replace(/'/g, `'\\''`)}'`);
// O ajuste de um lote pode criar o teste que faltava: o escopo é a pasta de cada arquivo do lote.
const pastasDoLote = (lote) => semRepetir(lote.arquivos.map((arquivo) => (arquivo.includes('/') ? arquivo.slice(0, arquivo.lastIndexOf('/')) : arquivo)));

// O que a catraca vê nos arquivos do lote vai para o revisor como fato, não como opinião.
function catracaDoLote(m, repo, lote) {
  const dir = dirDoRepo(m, repo);
  const doLote = new Set(lote.arquivos.map((arquivo) => `${dir}/${arquivo}`));
  return conferirRepo(m.config, repo, { modo: 'pr' })
    .achados.filter((achado) => achado.arquivo && doLote.has(achado.arquivo) && !achado.liberado)
    .map(formatarAchado);
}

export function revisarPr(m, repo) {
  const estado = estadoDoRepo(m, repo);
  const pasta = pastaDoRepo(m.config, repo);
  const dir = dirDoRepo(m, repo);
  const referencia = baseDoRepo(m, repo);
  if (!estado.lotes) {
    estado.lotes = montarLotes(m, repo, referencia);
    registrar(m, `${repo}: revisão linha por linha em ${estado.lotes.length} lote(s)`);
  }
  const indice = estado.lotes.findIndex((lote) => lote.status === 'pendente');
  if (indice < 0) return REVISAO_TERMINADA;
  const lote = estado.lotes[indice];
  const catraca = catracaDoLote(m, repo, lote);
  return despachar(m, {
    chave: `${repo}-leitura-${indice + 1}`,
    tipo: 'lote',
    papel: 'revisarPr',
    titulo: `${repo}: revisar linha por linha (lote ${indice + 1} de ${estado.lotes.length})`,
    extra: { repo, indice, arvore: hashDaArvore(pasta) },
    seEsgotar: () => {
      lote.status = 'sem parecer';
      avisar(m, `A revisão linha por linha de ${repo} não teve parecer válido para ${lote.arquivos.length} arquivo(s) a partir de ${lote.arquivos[0]}; esse lote ficou sem revisão.`);
      return null;
    },
    parametros: {
      Repositório: rotuloDoRepo(m, repo),
      'Regra de padrão': crase(regraDePadrao(repo)),
      'Mapa do código': ondeEstaOMapa(m),
      Plano: ehRevisao(m) ? '(não há plano)' : crase(relativo(m.caminhoDoPlano)),
      'Pedido do humano': ehRevisao(m) ? crase(m.livro.preparo.pedido) : '(nenhum além da tarefa do plano)',
      'Arquivos do lote': crases(lote.arquivos),
      'Comando do diff': crase(`git -C ${dir} diff ${referencia}...HEAD -- ${lote.arquivos.map(entreAspas).join(' ')}`),
      'O que a catraca achou neste lote': catraca.length > 0 ? catraca.join(' · ') : '(nada)',
      'Idioma dos achados': idiomas(m).pr,
    },
  });
}

export function receberLote(m, espera, resultado) {
  const { repo, indice } = espera;
  const estado = estadoDoRepo(m, repo);
  const lote = estado.lotes[indice];
  // O revisor só lê. Se mexeu em arquivo, o maestro desfaz; o parecer dele continua valendo.
  if (hashDaArvore(pastaDoRepo(m.config, repo)) !== espera.arvore) limparSobras(m, repo, 'durante a revisão linha por linha');
  const erros = errosDoParecer(m, resultado);
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['O arquivo de resultado da revisão anterior não foi aceito:', ...emLista(erros)].join('\n'));
    return null;
  }
  esquecerPasso(m, espera.chave);
  if (resultado.veredito === 'APROVADO') {
    lote.status = 'limpo';
    return null;
  }
  Object.assign(lote, { status: 'em ajuste', pontos: achadosDoParecer(resultado, PONTOS_GUARDADOS) });
  return pedirReparo(m, repo, {
    chave: `lote-${indice + 1}`,
    rotulo: `ajustes da revisão (lote ${indice + 1} de ${estado.lotes.length})`,
    nome: bi('Revisão', 'Review'),
    trabalho: 'refatorar o código da própria branch como os arquivos de "Achados a corrigir" apontam, sem mudar o que o código faz (a não ser que o achado seja um defeito) e sem tocar em código que a branch não escreveu',
    achados: espera.arquivo,
    escopo: pastasDoLote(lote),
    espelhos: [],
    depois: { tipo: 'repo', fase: 'revisao', origem: 'lote', lote: indice },
  });
}

// O resumo da revisão de um repositório, para a descrição da PR e para o relatório.
export function resumoDaRevisao(m, repo) {
  const lotes = estadoDoRepo(m, repo).lotes ?? [];
  return {
    arquivos: lotes.reduce((soma, lote) => soma + lote.arquivos.length, 0),
    lotes: lotes.length,
    commits: m.livro.feitas.filter((feita) => feita.repo === repo),
  };
}

// --------------------------------------------------------------------------- alvo do /revisar

const refDaBranch = (pasta, branch) => [branch, `origin/${branch}`].find((ref) => acoes.existeRef(pasta, ref)) ?? null;

function temTrabalho(config, repo, branch) {
  const pasta = pastaDoRepo(config, repo);
  const ref = refDaBranch(pasta, branch);
  const base = [`origin/${config.repos[repo].base}`, config.repos[repo].base].find((candidata) => acoes.existeRef(pasta, candidata));
  return Boolean(ref && base) && acoes.commitsAFrente(pasta, base, ref) > 0;
}

function numeroDaPr(texto) {
  return /\/pull\/(\d+)/.exec(texto)?.[1] ?? /(?:^|[\s(])#(\d+)\b/.exec(texto)?.[1] ?? /\bPR\s*#?\s*(\d+)\b/i.exec(texto)?.[1] ?? null;
}

// O humano apontou uma PR: a branch é a dela. Com um link, vale o repositório do link; se nenhum
// remoto bate com ele (fork, apelido de SSH), vale o repositório que tiver a PR com esse número.
function branchDaPr(config, repos, texto) {
  const numero = numeroDaPr(texto);
  if (!numero) return null;
  const doLink = /github\.com[/:]([\w.-]+\/[\w.-]+)\/pull\//.exec(texto)?.[1].toLowerCase();
  const doMesmoRemoto = repos.filter((repo) => doLink && git(pastaDoRepo(config, repo), ['remote', 'get-url', 'origin']).saida.toLowerCase().includes(doLink));
  const candidatos = (doMesmoRemoto.length > 0 ? doMesmoRemoto : repos)
    .map((repo) => acoes.prDaBranch(pastaDoRepo(config, repo), numero))
    .filter((pr) => pr && !pr.erro && pr.branch);
  const branches = semRepetir(candidatos.map((pr) => pr.branch));
  if (branches.length > 1) throw new ErroDeUso(`A PR #${numero} existe em mais de um repositório, com branches diferentes (${branches.join(', ')}). Diga o nome da branch: /revisar <branch>.`);
  return branches[0] ?? null;
}

// O humano escreveu o nome da branch no meio do pedido: vale o nome mais longo que o git conhece.
function branchCitada(config, repos, texto) {
  const conhecidas = semRepetir(repos.flatMap((repo) => acoes.ramos(pastaDoRepo(config, repo))));
  const bases = new Set(repos.map((repo) => config.repos[repo].base));
  const citada = (nome) => {
    const posicao = texto.indexOf(nome);
    if (posicao < 0) return false;
    const antes = texto[posicao - 1] ?? ' ';
    const depois = texto.slice(posicao + nome.length, posicao + nome.length + 2);
    return !/[\w./-]/.test(antes) && !/^[\w/-]/.test(depois) && !/^\.\w/.test(depois);
  };
  return (
    conhecidas
      .filter((nome) => !bases.has(nome) && !ehBranchProtegida(config, nome) && citada(nome))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

// O humano não disse a branch: vale a que está em uso, se for uma só.
function branchEmUso(config, repos) {
  const emUso = semRepetir(
    repos
      .map((repo) => ({ repo, branch: branchAtual(pastaDoRepo(config, repo)) }))
      .filter(({ repo, branch }) => branch && branch !== 'HEAD' && branch !== config.repos[repo].base && !ehBranchProtegida(config, branch) && temTrabalho(config, repo, branch))
      .map(({ branch }) => branch),
  );
  if (emUso.length > 1) throw new ErroDeUso(`Os repositórios estão em branches diferentes (${emUso.join(', ')}). Diga qual revisar: /revisar <branch>.`);
  return emUso[0] ?? null;
}

// Descobre o que o /revisar deve revisar: a branch e os repositórios em que ela tem trabalho.
export function acharAlvoDaRevisao(config, texto) {
  const repos = nomesDosRepos(config).filter((repo) => ehRepoGit(pastaDoRepo(config, repo)));
  if (repos.length === 0) throw new ErroDeUso('Nenhum repositório de harness/config.json existe como repositório git. Rode node harness/bin/doutor.mjs.');
  // Melhor esforço: sem rede, vale o que o git local já conhece, e o ambiente é conferido logo depois.
  for (const repo of repos) acoes.buscarRemoto(pastaDoRepo(config, repo));
  const branch = branchDaPr(config, repos, texto) ?? branchCitada(config, repos, texto) ?? branchEmUso(config, repos);
  if (!branch) throw new ErroDeUso('Não achei a branch para revisar. Diga o nome exato dela ou o número da PR: /revisar <branch ou PR>.');
  if (ehBranchProtegida(config, branch)) throw new ErroDeUso(`"${branch}" é branch protegida. Diga a branch da tarefa: /revisar <branch>.`);
  const comTrabalho = repos.filter((repo) => temTrabalho(config, repo, branch));
  if (comTrabalho.length === 0) throw new ErroDeUso(`A branch ${branch} não tem commit à frente da base em nenhum repositório de harness/config.json.`);
  return { branch, repos: comTrabalho };
}
