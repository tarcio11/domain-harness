// A unidade de trabalho: uma fatia ou uma correção. Toda mudança de código passa pelo mesmo caminho:
// executar → o maestro confere (histórico, diff, escopo, portões) → revisar → o maestro faz o commit.

import * as acoes from './acoes.mjs';
import { branchAtual, ehRepoGit, git, nomesDosRepos, pastaDoRepo } from './config.mjs';
import { conferirRepo } from './conferir.mjs';
import {
  anotarProblema, atualizarEstado, avisosDe, bloqueiosDe, comServico, crase, crases, despachar, dirDoRepo, ehCodigo, emLista, estourouAsRefeitas,
  gravarNoPasso, gravarPlano, orientacao, parar, planoAtual, registrar, regraDePadrao, relativo, repetir, rotuloDoRepo, segundosDesde, textoDoPlano,
} from './maestro-base.mjs';
import { errosDoParecer } from './maestro-parecer.mjs';
import { marcarFatia } from './plano.mjs';
import { hashDaArvore } from './recibo.mjs';

export function abrirUnidade(m, plano, unidade) {
  const pasta = pastaDoRepo(m.config, unidade.repo);
  const entrada = entrarNaBranchDaTarefa(m, unidade.repo, plano, unidade.chave);
  if (entrada) return entrada;
  if (!acoes.arvoreLimpa(pasta)) {
    return parar(m, 'falha', unidade.chave, `Há mudanças sem commit em ${dirDoRepo(m, unidade.repo)}/ antes de começar "${unidade.rotulo}". Guarde ou desfaça e responda para o maestro continuar.`);
  }
  m.livro.unidade = { ...unidade, headAntes: acoes.cabeca(pasta), vizinhos: arvoresDosVizinhos(m, unidade.repo), fase: 'executar', voltas: 0 };
  registrar(m, `abriu: ${unidade.rotulo}`);
  return null;
}

// O retrato dos outros repositórios quando o trabalho começa: o executor só mexe no dele.
function arvoresDosVizinhos(m, repo) {
  const vizinhos = nomesDosRepos(m.config).filter((nome) => nome !== repo && ehRepoGit(pastaDoRepo(m.config, nome)));
  return Object.fromEntries(vizinhos.map((nome) => [nome, hashDaArvore(pastaDoRepo(m.config, nome))]));
}

export function entrarNaBranchDaTarefa(m, repo, plano, passo, opcoes = {}) {
  const pasta = pastaDoRepo(m.config, repo);
  const chave = `fetch-${repo}`;
  if (!opcoes.buscarSempre && branchAtual(pasta) === plano.branch && !m.livro.servicos[chave]) return null;
  const { base } = m.config.repos[repo];
  const entrada = comServico(m, chave, (nome) => acoes.entrarNaBranch(pasta, plano.branch, base, nome, m.prazo, opcoes));
  if (entrada.estado === 'rodando') return repetir(`Buscando o remoto de ${repo}.`);
  if (entrada.estado === 'erro') return parar(m, 'falha', passo, `${entrada.erro}\nResolva e responda.`);
  return null;
}

export function conduzirUnidade(m) {
  const u = m.livro.unidade;
  if (u.fase === 'executar') return despacharExecucao(m, u);
  if (u.fase === 'conferir') return conferirUnidade(m, u);
  if (u.fase === 'revisar') return despacharRevisao(m, u);
  return commitDaUnidade(m, u);
}

function despacharExecucao(m, u) {
  const chave = `${u.chave}-executar`;
  const dir = dirDoRepo(m, u.repo);
  const achados = [u.achados, m.livro.problemas[chave]].filter(Boolean);
  const trabalho = {
    semAchados: `implementar a fatia ${u.rotulo} (leia a fatia no plano)`,
    fatia: `corrigir, na fatia ${u.rotulo}, o que os arquivos de "Achados a corrigir" apontam`,
    repo: `${u.rotulo}: corrigir o que os arquivos de "Achados a corrigir" apontam`,
  };
  return despachar(m, {
    chave,
    tipo: 'executar',
    papel: 'executar',
    titulo: `${u.rotulo}: ${achados.length > 0 ? 'corrigir' : 'implementar'}`,
    orientacao: u.chave,
    limite: 2 + m.opcoes.tentativasPorPasso + m.opcoes.voltasDeRevisao,
    parametros: {
      Tarefa: m.id,
      Plano: crase(relativo(m.caminhoDoPlano)),
      Repositório: rotuloDoRepo(m, u.repo),
      'Regra de padrão': crase(regraDePadrao(u.repo)),
      Trabalho: achados.length === 0 ? trabalho.semAchados : trabalho[u.depois.tipo],
      Escopo: crases(u.escopo),
      Espelhos: u.espelhos.length > 0 ? crases(u.espelhos) : '(ache pela regra de padrão)',
      'Achados a corrigir': achados.length > 0 ? crases(achados) : '(nenhum)',
      'Formato do commit': m.config.convencoes?.commit || `(o dos últimos commits: ${crase(`git -C ${dir} log --oneline -8`)})`,
      'Resposta do humano': orientacao(m, u.chave, u.repo, 'geral'),
    },
  });
}

export function receberExecucao(m, espera, resultado) {
  const u = m.livro.unidade;
  if (resultado.resultado === 'desvio') {
    return parar(m, 'desvio', u.chave, [resultado.texto, 'Responda com a sua decisão (por exemplo: "opção A", "aprovado o desvio da opção B", ou outra instrução).'].join('\n\n'));
  }
  if (resultado.resultado === 'falhou') {
    anotarProblema(m, espera.chave, `A tentativa anterior terminou em "RESULTADO: falhou". O relato dela está em ${crase(espera.arquivo)}. O que ela fez continua nos arquivos.`);
    return null;
  }
  const mensagem = resultado.commit ?? '';
  const erros = [];
  if (resultado.resultado !== 'ok') erros.push('A primeira linha tem que ser "RESULTADO: ok", "RESULTADO: desvio" ou "RESULTADO: falhou".');
  else if (mensagem.length < 5 || mensagem.length > 200) erros.push('Falta a linha "COMMIT: <mensagem>", em uma linha, no formato de commit do repositório.');
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['O arquivo de resultado da tentativa anterior está fora do formato:', ...emLista(erros), 'O que ela fez continua nos arquivos: confira e grave o resultado certo.'].join('\n'));
    return null;
  }
  Object.assign(u, { commit: mensagem, fase: 'conferir', conferencia: null, contestou: /^\s*contesto\s*:/im.test(resultado.texto) });
  if (u.rodadaAnterior) u.rodadaAnterior.resposta = espera.arquivo;
  return null;
}

function devolverAoExecutor(m, u, titulo, itens) {
  anotarProblema(m, `${u.chave}-executar`, [titulo, ...itens].join('\n'));
  Object.assign(u, { fase: 'executar', conferencia: null });
  registrar(m, `${u.rotulo}: o maestro não aceitou (${titulo.split('.')[0]})`);
  return null;
}

// Branch trocada ou histórico reescrito não têm conserto automático seguro: é caso para o humano.
function problemaDeHistoria(m, u, pasta) {
  const { branch } = planoAtual(m);
  if (branchAtual(pasta) !== branch) return `O repositório ${u.repo} saiu da branch ${branch} durante "${u.rotulo}". O maestro não continua em outra branch: volte para ela e responda.`;
  if (!git(pasta, ['merge-base', '--is-ancestor', u.headAntes, 'HEAD']).ok) {
    return `O histórico de ${u.repo} foi reescrito durante "${u.rotulo}" (o commit ${u.headAntes.slice(0, 7)} sumiu da branch). Diga como seguir.`;
  }
  return null;
}

function conferirUnidade(m, u) {
  const pasta = pastaDoRepo(m.config, u.repo);
  const dir = dirDoRepo(m, u.repo);
  const historia = problemaDeHistoria(m, u, pasta);
  if (historia) return parar(m, 'falha', u.chave, historia);

  const diff = conferirRepo(m.config, u.repo, { modo: 'fatia', escopo: u.escopo, referencia: u.headAntes });
  const arquivos = diff.lista.map((arquivo) => arquivo.caminho);
  if (!u.conferencia) {
    const problemas = bloqueiosDe(diff);
    if (diff.arquivos === 0) problemas.push('Nenhum arquivo mudou desde o começo deste trabalho.');
    for (const [vizinho, arvore] of Object.entries(u.vizinhos ?? {})) {
      if (hashDaArvore(pastaDoRepo(m.config, vizinho)) !== arvore) {
        problemas.push(`Mudaram arquivos em ${dirDoRepo(m, vizinho)}/, que não é o repositório deste trabalho. Desfaça só o que você mexeu lá (veja com git -C ${dirDoRepo(m, vizinho)} status).`);
      }
    }
    if (u.arvoreReprovada && hashDaArvore(pasta) === u.arvoreReprovada && !u.contestou) {
      problemas.push('O revisor reprovou e nada mudou. Corrija cada achado, ou conteste no arquivo de resultado com uma linha "Contesto: <achado> — <prova>".');
    }
    if (problemas.length > 0) return devolverAoExecutor(m, u, 'O maestro conferiu o diff e não aceitou. Corrija a causa de cada item:', emLista(problemas));
    u.conferencia = { arquivos };
  }

  const rodada = comServico(m, `portoes-${u.repo}`, (nome) => acoes.portoes(u.repo, pasta, nome, m.prazo, tempoDosPortoes(m, u.repo)));
  if (rodada.estado === 'rodando') return repetir(`Os portões de ${u.repo} estão rodando há ${segundosDesde(rodada.desde)} s.`);
  if (rodada.estado === 'interrompido' || rodada.estado === 'mudou') {
    if (!estourouAsRefeitas(u, 'portoesRefeitos')) return null;
    const causa = rodada.estado === 'mudou' ? 'os arquivos mudam enquanto os portões rodam' : 'o processo dos portões some antes de terminar';
    return parar(m, 'falha', u.chave, `Não consegui uma rodada inteira dos portões de ${u.repo}: ${causa}. Rode à mão ${crase(`node harness/bin/portoes.mjs ${u.repo}`)}, veja o que acontece e responda.`);
  }
  if (rodada.estado === 'vermelho') {
    return devolverAoExecutor(m, u, 'Os portões reprovaram o que está na pasta. Conserte a causa. Saída do maestro ao rodar:', [acoes.cauda(rodada.saida)]);
  }

  // Rodar os portões pode deixar arquivo novo (relatório, build) que o .gitignore não cobre.
  const sobras = arquivos.filter((arquivo) => !u.conferencia.arquivos.includes(arquivo));
  if (sobras.length > 0) {
    const texto = [`Rodar os portões de ${u.repo} deixou arquivos que não são do trabalho:`, ...emLista(sobras.map((arquivo) => `${dir}/${arquivo}`)), 'Provavelmente falta uma linha no .gitignore do repositório. Acrescente, apague esses arquivos e responda.'];
    return parar(m, 'humano', u.chave, texto.join('\n'));
  }
  const bloqueios = bloqueiosDe(diff);
  if (bloqueios.length > 0) return devolverAoExecutor(m, u, 'Depois dos portões o diff passou a ter bloqueio. Corrija a causa de cada item:', emLista(bloqueios));

  acoes.prepararParaRevisao(pasta);
  delete m.livro.problemas[`${u.chave}-executar`];
  Object.assign(u, {
    fase: 'revisar',
    conferencia: null,
    portoesRefeitos: 0,
    achados: null,
    avisos: avisosDe(diff),
    arquivosNovos: diff.lista.filter((arquivo) => arquivo.novo && ehCodigo(m, arquivo.caminho)).map((arquivo) => arquivo.caminho),
    arvoreRevisada: hashDaArvore(pasta),
  });
  return null;
}

export const tempoDosPortoes = (m, repo) => (m.config.repos[repo].portoes?.length || 1) * (m.config.saida?.tempoMaximoPorPortaoMin ?? 15) + 5;

export function parametrosDaRevisao(m, repo, comandoDoDiff, { espelhos, novos, avisos, anterior }) {
  return {
    Repositório: rotuloDoRepo(m, repo),
    'Regra de padrão': crase(regraDePadrao(repo)),
    'Comando do diff': crase(comandoDoDiff),
    Plano: `${crase(relativo(m.caminhoDoPlano))} (para ver os desvios aprovados)`,
    Espelhos: espelhos.length > 0 ? crases(espelhos) : '(ache pela regra de padrão)',
    'Arquivos novos': novos.length > 0 ? `${crases(novos)} — cada um precisa de uma linha em COMPARAÇÃO` : '(nenhum)',
    'Avisos da catraca': avisos.length > 0 ? avisos.join(' · ') : '(nenhum)',
    'Rodada anterior': anterior ? `achados em ${crase(anterior.achados)}; resposta do autor em ${crase(anterior.resposta)}` : '(nenhuma)',
  };
}

function despacharRevisao(m, u) {
  return despachar(m, {
    chave: `${u.chave}-revisar-${u.voltas + 1}`,
    tipo: 'revisar',
    papel: 'revisar',
    titulo: `${u.rotulo}: revisar`,
    orientacao: u.chave,
    extra: { arvore: u.arvoreRevisada },
    parametros: parametrosDaRevisao(m, u.repo, `git -C ${dirDoRepo(m, u.repo)} diff --cached ${u.headAntes}`, {
      espelhos: u.espelhos,
      novos: u.arquivosNovos,
      avisos: u.avisos,
      anterior: u.rodadaAnterior?.resposta ? u.rodadaAnterior : null,
    }),
  });
}

// Se a pasta mudou depois de conferida, o que foi conferido não vale mais: confere e revisa de novo.
function refazerConferencia(m, u, quando) {
  if (estourouAsRefeitas(u, 'conferenciasRefeitas')) {
    return parar(m, 'falha', u.chave, `Os arquivos de ${u.repo} continuam mudando ${quando} em "${u.rotulo}". Veja quem está mexendo na pasta e responda.`);
  }
  Object.assign(u, { fase: 'conferir', conferencia: null });
  registrar(m, `${u.rotulo}: a pasta mudou ${quando}; o maestro confere de novo`);
  return null;
}

export function receberRevisao(m, espera, resultado) {
  const u = m.livro.unidade;
  const pasta = pastaDoRepo(m.config, u.repo);
  if (hashDaArvore(pasta) !== espera.arvore) return refazerConferencia(m, u, 'durante a revisão');
  const erros = errosDoParecer(m, resultado, { repo: u.repo, referencia: u.headAntes, novos: u.arquivosNovos });
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['O arquivo de resultado da revisão anterior não foi aceito:', ...emLista(erros)].join('\n'));
    return null;
  }
  if (resultado.veredito === 'APROVADO') {
    u.fase = 'commit';
    return null;
  }
  u.voltas += 1;
  if (u.voltas > m.opcoes.voltasDeRevisao) {
    return parar(m, 'falha', u.chave, [`O revisor reprovou "${u.rotulo}" ${u.voltas} vezes. Último parecer:`, resultado.texto, 'Diga como seguir.'].join('\n\n'));
  }
  Object.assign(u, { fase: 'executar', achados: espera.arquivo, rodadaAnterior: { achados: espera.arquivo, resposta: null }, arvoreReprovada: espera.arvore, contestou: false });
  registrar(m, `${u.rotulo}: o revisor reprovou, volta para correção`);
  return null;
}

function commitDaUnidade(m, u) {
  const pasta = pastaDoRepo(m.config, u.repo);
  const chave = `commit-${u.repo}`;
  if (!m.livro.servicos[chave] && hashDaArvore(pasta) !== u.arvoreRevisada) return refazerConferencia(m, u, 'depois da revisão');
  const feito = comServico(m, chave, (nome) => acoes.commit(pasta, u.commit, nome, m.prazo));
  if (feito.estado === 'rodando') return repetir(`O commit de "${u.rotulo}" está rodando (hooks do repositório) há ${segundosDesde(feito.desde)} s.`);
  if (feito.estado === 'interrompido') {
    if (!estourouAsRefeitas(u, 'commitsRefeitos')) return null;
    return parar(m, 'falha', u.chave, `O commit de "${u.rotulo}" foi interrompido mais de uma vez. Veja ${crase(`git -C ${dirDoRepo(m, u.repo)} status`)} e responda.`);
  }
  if (feito.codigo !== 0) {
    const recusa = gravarNoPasso(m, `${u.chave}-commit-recusado.md`, `O commit foi recusado pelos hooks do repositório. Corrija a causa (código ou mensagem de commit):\n${acoes.cauda(feito.saida)}`);
    Object.assign(u, { fase: 'executar', achados: recusa });
    return null;
  }
  if (!acoes.arvoreLimpa(pasta)) {
    return parar(m, 'falha', u.chave, `Sobrou mudança sem commit em ${u.repo} depois do commit de "${u.rotulo}". Veja com git status, resolva e responda.`);
  }
  concluirUnidade(m, u, pasta);
  return null;
}

function concluirUnidade(m, u, pasta) {
  const sha = acoes.cabeca(pasta).slice(0, 7);
  m.livro.feitas.push({ trabalho: u.rotulo, repo: u.repo, sha, mensagem: u.commit });
  registrar(m, `${u.rotulo}: commit ${sha}`);
  if (u.depois.tipo === 'fatia') {
    m.livro.concluidas.push(u.depois.id);
    gravarPlano(m, marcarFatia(textoDoPlano(m), u.depois.id, true));
  } else {
    m.livro.repos[u.repo].fase = u.depois.fase;
  }
  // A resposta do humano valia para este trabalho: não acompanha os seguintes.
  for (const chave of [u.chave, u.repo, 'geral']) delete m.livro.orientacoes[chave];
  m.livro.unidade = null;
  atualizarEstado(m, 'o maestro segue conduzindo');
}
