// A segunda parte da condução, por repositório: as fatias, a revisão linha por linha, o QA na
// tela, a descrição, a publicação da PR, os checks e o relatório final. Nada aqui pergunta: o que
// não fecha vira pendência, a PR fica em rascunho e a condução segue até o relatório.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as acoes from './acoes.mjs';
import { desviosAprovados, pastaDoRepo, RAIZ } from './config.mjs';
import { conferirRepo } from './conferir.mjs';
import {
  alvoDaConducao, anotarProblema, atualizarEstado, avisar, avisosDe, baseDoRepo, bi, bloqueiosDe, bloquear, comServico, crase, crases, despachar,
  dirDoRepo, doRepo, ehRevisao, emLista, encerrarConducao, esquecerPasso, estadoDoRepo, estourouAsRefeitas, gravarNoPasso, gravarPlano, idiomas,
  limparSobras, naConducao, pedirReparo, pendencia, registrar, relativo, repetir, reservarNoPasso, resumo, rotuloDoRepo, segundosDesde, semRepetir,
  sobrasNosIntocados, temPendencia, textoDoPlano,
} from './maestro-base.mjs';
import { receberLote, resumoDaRevisao, REVISAO_TERMINADA, revisarPr } from './maestro-revisao.mjs';
import { abrirUnidade, prepararRepo, tempoDosPortoes } from './maestro-unidade.mjs';
import { definirStatus } from './plano.mjs';
import { hashDaArvore } from './recibo.mjs';

export { receberLote };

const REPO_COM_TELA = 'frontend';
const LINHA_DE_QA = /^[\s>*_`-]*(CA\d+|EXTRA)[*_`]*\s*:[*_`\s]*(passou|falhou)\b(.*)$/i;
const MAXIMO_DE_ERROS_DE_LEITURA = 3;

const escopoDoRepo = (alvo, repo) => semRepetir(alvo.fatias.filter((fatia) => fatia.repo === repo).flatMap((fatia) => fatia.escopo));
const espelhosDoRepo = (alvo, repo) => semRepetir(alvo.fatias.filter((fatia) => fatia.repo === repo).flatMap((fatia) => fatia.espelho));
const temCommitDaConducao = (m, repo) => m.livro.feitas.some((feita) => feita.repo === repo);
const descricaoGuardada = (repo) => naConducao(`descricao-${repo}.md`);

export function conduzirRepo(m, repo) {
  const alvo = alvoDaConducao(m);
  const estado = estadoDoRepo(m, repo);
  const fatias = alvo.fatias.filter((fatia) => fatia.repo === repo);
  switch (estado.fase) {
    case 'fatias':
      return proximaFatia(m, repo, estado, fatias);
    case 'reparo': {
      const { chave, rotulo, nome, trabalho, achados, escopo, espelhos, depois } = estado.reparo;
      return abrirUnidade(m, {
        chave: `${repo}-${chave}`,
        repo,
        rotulo: `${repo}: ${rotulo}`,
        nome,
        trabalho,
        escopo: escopo ?? escopoDoRepo(alvo, repo),
        espelhos: espelhos ?? espelhosDoRepo(alvo, repo),
        achados,
        depois,
      });
    }
    case 'revisao': {
      // Uma fatia só já foi revisada inteira ao nascer: a segunda leitura não acha nada novo.
      const acao = !ehRevisao(m) && fatias.length < 2 ? REVISAO_TERMINADA : revisarPr(m, repo);
      if (acao !== REVISAO_TERMINADA) return acao;
      estado.fase = depoisDaRevisao(m, repo, estado);
      return null;
    }
    case 'qa':
      return despacharQa(m, repo, alvo, estado);
    case 'descricao':
      return descreverPr(m, repo, alvo, estado);
    case 'publicar':
      return publicar(m, repo, alvo, estado);
    case 'checks':
      return acompanharChecks(m, repo, estado);
    default:
      throw new Error(`Fase desconhecida no livro do maestro: ${estado.fase}.`);
  }
}

function proximaFatia(m, repo, estado, fatias) {
  // Uma fatia não fechou: as seguintes ficam de fora, e cada repositório publica o que já tem commit.
  if (m.livro.interrompida) {
    estado.fase = temCommitDaConducao(m, repo) ? 'descricao' : 'pronto';
    if (estado.fase === 'pronto') estado.semEntrega = true;
    return null;
  }
  const aberta = fatias.find((fatia) => !m.livro.concluidas.includes(fatia.id));
  if (!aberta) {
    estado.fase = 'revisao';
    return null;
  }
  return abrirUnidade(m, {
    chave: aberta.id,
    repo,
    rotulo: `${aberta.id} · ${aberta.nome}`,
    nome: aberta.id,
    escopo: aberta.escopo,
    espelhos: aberta.espelho,
    achados: null,
    depois: { tipo: 'fatia', id: aberta.id },
  });
}

// O QA vem depois da revisão, para testar o código que vai para a PR.
function depoisDaRevisao(m, repo, estado) {
  if (ehRevisao(m) || repo !== REPO_COM_TELA || estado.qa === 'passou') return 'descricao';
  if (m.opcoes.qa === 'auto') return 'qa';
  qaPendente(m, repo, estado, bi('o harness está configurado para você testar (maestro.qa)', 'the harness is set for a human to test (maestro.qa)'));
  return 'descricao';
}

// --------------------------------------------------------------------------------------- QA

function qaPendente(m, repo, estado, motivo) {
  Object.assign(estado, { qa: 'pendente', motivoDoQa: motivo });
  pendencia(m, bi(`O QA na tela não foi feito: ${motivo.pt}. Teste na tela antes de tirar a PR de rascunho.`, `On-screen QA was not done: ${motivo.en}. Test it on screen before taking the PR out of draft.`), { repo });
}

function despacharQa(m, repo, alvo, estado) {
  const arvores = Object.fromEntries(alvo.repos.map((nome) => [nome, hashDaArvore(pastaDoRepo(m.config, nome))]));
  const relatorio = estado.relatorioDoQa ?? reservarNoPasso(m, 'qa-relatorio.md');
  estado.relatorioDoQa = relatorio;
  return despachar(m, {
    chave: `qa-${estado.ciclosDeQa + 1}`,
    tipo: 'qa',
    papel: 'qa',
    titulo: 'QA na tela',
    extra: { repo, arvores },
    seEsgotar: () => {
      qaPendente(m, repo, estado, bi('o agente de QA não devolveu um resultado válido', 'the QA agent did not return a valid result'));
      estado.fase = 'descricao';
      return null;
    },
    parametros: {
      Tarefa: m.id,
      Plano: crase(relativo(m.caminhoDoPlano)),
      'Relatório do QA': crase(relatorio),
    },
  });
}

function lerLinhasDoQa(texto) {
  return texto
    .split('\n')
    .map((linha) => LINHA_DE_QA.exec(linha))
    .filter(Boolean)
    .map((achado) => ({ item: achado[1].toUpperCase(), passou: achado[2].toLowerCase() === 'passou', onde: /onde:\s*([\w-]+)/i.exec(achado[3])?.[1].toLowerCase() ?? null }));
}

function errosDoQa(resultado, linhas, alvo) {
  if (!['passou', 'falhou', 'bloqueado'].includes(resultado.resultado)) {
    return ['A primeira linha tem que ser "RESULTADO: passou", "RESULTADO: falhou" ou "RESULTADO: bloqueado".'];
  }
  if (resultado.resultado === 'bloqueado') return [];
  const erros = [];
  const semLinha = alvo.criterios.map((criterio) => criterio.id).filter((id) => !linhas.some((linha) => linha.item === id));
  if (semLinha.length > 0) erros.push(`Falta uma linha "CAn: passou — evidência" ou "CAn: falhou — onde: … — …" para: ${semLinha.join(', ')}.`);
  const falhas = linhas.filter((linha) => !linha.passou);
  if (resultado.resultado === 'passou' && falhas.length > 0) erros.push('"RESULTADO: passou" não combina com linha "falhou". Se algo falhou, o resultado é "falhou".');
  if (resultado.resultado === 'falhou' && falhas.length === 0) erros.push('"RESULTADO: falhou" precisa de pelo menos uma linha "CAn: falhou — onde: frontend|backend — …".');
  return erros;
}

export function receberQa(m, espera, resultado) {
  const { repo } = espera;
  const estado = m.livro.repos[repo];
  const alvo = alvoDaConducao(m);
  // O QA só testa. Se mexeu em arquivo, o maestro desfaz; o resultado dele continua valendo.
  for (const [nome, arvore] of Object.entries(espera.arvores)) {
    if (hashDaArvore(pastaDoRepo(m.config, nome)) !== arvore) limparSobras(m, nome, 'durante o QA na tela');
  }
  const linhas = lerLinhasDoQa(resultado.texto);
  const erros = errosDoQa(resultado, linhas, alvo);
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['O arquivo de resultado do QA anterior não foi aceito:', ...emLista(erros)].join('\n'));
    return null;
  }
  esquecerPasso(m, espera.chave);
  if (resultado.resultado === 'passou') {
    Object.assign(estado, { qa: 'passou', fase: 'descricao', linhasDoQa: linhas.length });
    registrar(m, 'QA na tela passou');
    return null;
  }
  if (resultado.resultado === 'bloqueado') {
    const motivo = (resultado.campo('MOTIVO') ?? 'o agente não conseguiu testar na tela').slice(0, 300);
    qaPendente(m, repo, estado, bi(motivo, motivo));
    estado.fase = 'descricao';
    return null;
  }
  estado.ciclosDeQa += 1;
  const falhas = linhas.filter((linha) => !linha.passou);
  const onde = semRepetir(falhas.map((linha) => linha.onde ?? repo));
  const deFora = onde.filter((nome) => !alvo.repos.includes(nome));
  if (estado.ciclosDeQa > m.opcoes.ciclosDeQa || deFora.length > 0) {
    const porque = deFora.length > 0 ? bi(`a falha está em ${deFora.join(' e ')}, fora desta tarefa`, `the failure is in ${deFora.join(' and ')}, outside this task`) : bi(`falhou ${estado.ciclosDeQa} vezes seguidas`, `it failed ${estado.ciclosDeQa} times in a row`);
    Object.assign(estado, { qa: 'falhou', fase: 'descricao' });
    pendencia(m, bi(`O QA na tela falhou e não foi corrigido: ${porque.pt}.`, `On-screen QA failed and was not fixed: ${porque.en}.`), { repo, detalhe: resultado.texto });
    return null;
  }
  // Quem já tem PR aberta recebe a correção e publica de novo; o repositório da tela volta ao QA.
  for (const nome of onde) {
    pedirReparo(m, nome, {
      chave: `qa-${estado.ciclosDeQa}`,
      rotulo: 'correção das falhas do QA',
      nome: 'QA',
      achados: espera.arquivo,
      depois: { tipo: 'repo', fase: nome === repo ? 'qa' : 'publicar', origem: 'qa', qaDe: repo },
    });
  }
  if (!onde.includes(repo)) estado.fase = 'qa';
  return null;
}

// --------------------------------------------------------------------------------- descrição

function descreverPr(m, repo, alvo, estado) {
  const pasta = pastaDoRepo(m.config, repo);
  // Numa revisão, a PR que já existe guarda a descrição dela: o maestro só acrescenta.
  if (ehRevisao(m) && !estado.prConferida) {
    const pr = acoes.prDaBranch(pasta, alvo.branch);
    if (pr?.erro) return bloquear(m, repo, pr.erro);
    estado.prConferida = true;
    if (pr && pr.estado === 'OPEN') Object.assign(estado, { prExistente: true, titulo: pr.titulo, corpoOriginal: pr.corpo });
  }
  if (estado.prExistente || (estado.titulo && existsSync(descricaoGuardada(repo)))) {
    estado.fase = 'publicar';
    return null;
  }
  const dir = dirDoRepo(m, repo);
  const arquivo = reservarNoPasso(m, `${repo}-descricao.md`);
  return despachar(m, {
    chave: `${repo}-descricao`,
    tipo: 'descricao',
    papel: 'descrever',
    titulo: `${repo}: escrever a descrição da PR`,
    extra: { repo, descricao: arquivo },
    seEsgotar: () => {
      // Sem redator, a PR sai com o que o plano já diz: melhor que não sair.
      writeFileSync(descricaoGuardada(repo), `${alvo.objetivo || alvo.titulo}\n`);
      Object.assign(estado, { titulo: alvo.titulo.slice(0, 110), fase: 'publicar' });
      avisar(m, `O redator da descrição da PR de ${repo} não devolveu um texto válido; a PR saiu com o título e o objetivo do plano.`);
      return null;
    },
    parametros: {
      Tarefa: m.id,
      Plano: ehRevisao(m) ? '(não há plano: descreva pelo diff e pelos commits da branch)' : crase(relativo(m.caminhoDoPlano)),
      Repositório: rotuloDoRepo(m, repo),
      'Resumo do diff': crase(`git -C ${dir} diff --stat ${baseDoRepo(m, repo)}...HEAD`),
      'Modelo de PR': m.config.convencoes?.modeloPr || '(sem modelo: use as seções do roteiro)',
      'Formato do título': `${m.config.convencoes?.tituloPr || 'curto, com o código do card'}, em ${idiomas(m).commit}`,
      'Idioma da descrição': idiomas(m).pr,
      'Arquivo da descrição': crase(arquivo),
    },
  });
}

export function receberDescricao(m, espera, resultado) {
  const { repo } = espera;
  const corpo = join(RAIZ, espera.descricao);
  const titulo = resultado.titulo ?? '';
  const erros = [];
  if (titulo.length < 5 || titulo.length > 120) erros.push('Falta no arquivo de resultado a linha "TITULO: <título da PR>" (de 5 a 120 caracteres, em uma linha).');
  if (!existsSync(corpo) || readFileSync(corpo, 'utf8').trim().length < 80) erros.push(`A descrição não foi gravada em ${espera.descricao}, ou está curta demais.`);
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['A descrição da PR anterior não foi aceita:', ...emLista(erros)].join('\n'));
    return null;
  }
  writeFileSync(descricaoGuardada(repo), readFileSync(corpo, 'utf8'));
  esquecerPasso(m, espera.chave);
  Object.assign(m.livro.repos[repo], { titulo, fase: 'publicar' });
  return null;
}

// --------------------------------------------------------------------------------------- PR

function reprovarPublicacao(m, repo, estado, motivo) {
  Object.assign(estado, { voltasDePublicacao: estado.voltasDePublicacao + 1, sincronizado: false });
  if (estado.voltasDePublicacao > m.opcoes.voltasDeRevisao) {
    estado.publicarComoEsta = true;
    pendencia(
      m,
      bi(
        `A branch de ${repo} não passa na prova final (catraca e portões da branch inteira), mesmo depois de ${estado.voltasDePublicacao - 1} correções.`,
        `The ${repo} branch does not pass the final proof (diff checks and gates on the whole branch), even after ${estado.voltasDePublicacao - 1} fix rounds.`,
      ),
      { repo, detalhe: motivo },
    );
    return null;
  }
  const achados = gravarNoPasso(m, `${repo}-prova-final.md`, motivo);
  return pedirReparo(m, repo, {
    chave: `prova-final-${estado.voltasDePublicacao}`,
    rotulo: 'correção da prova final',
    nome: bi('Prova final', 'Final proof'),
    achados,
    depois: { tipo: 'repo', fase: 'publicar', origem: 'prova' },
  });
}

// Numa revisão, a catraca julga só o que a condução mudou: o que a branch já trazia é assunto dos
// revisores de lote, não motivo para barrar a publicação.
const referenciaDaProva = (m, estado) => (ehRevisao(m) ? { referencia: estado.cabecaInicial } : {});

// Última prova antes de publicar: branch em dia com o remoto, diff sem bloqueio e portões verdes
// para exatamente o que vai subir. Só então push e PR.
function publicar(m, repo, alvo, estado) {
  const pasta = pastaDoRepo(m.config, repo);
  const emServico = ['portoes', 'push', 'fetch'].some((nome) => m.livro.servicos[`${nome}-${repo}`]);
  if (!emServico && !acoes.arvoreLimpa(pasta)) limparSobras(m, repo, 'na hora de publicar');
  if (!estado.sincronizado) {
    const entrada = prepararRepo(m, repo, alvo.branch, { buscarSempre: true });
    if (entrada) return entrada;
    estado.sincronizado = true;
  }

  // A prova vale para um commit: enquanto a cabeça da branch for a mesma, não se repete.
  if (!estado.publicarComoEsta && estado.provaFeita !== acoes.cabeca(pasta)) {
    const diff = conferirRepo(m.config, repo, { modo: 'pr', ...referenciaDaProva(m, estado) });
    const bloqueios = bloqueiosDe(diff);
    if (bloqueios.length > 0) return reprovarPublicacao(m, repo, estado, ['A branch tem bloqueios da catraca:', ...emLista(bloqueios)].join('\n'));

    const rodada = comServico(m, `portoes-${repo}`, (nome) => acoes.portoes(repo, pasta, nome, m.prazo, tempoDosPortoes(m, repo)));
    if (rodada.estado === 'rodando') return repetir(`Os portões de ${repo} estão rodando há ${segundosDesde(rodada.desde)} s (prova final).`);
    if (rodada.estado === 'interrompido' || rodada.estado === 'mudou') {
      if (!estourouAsRefeitas(estado, 'portoesRefeitos')) return null;
      estado.publicarComoEsta = true;
      pendencia(m, bi(`Não consegui uma rodada inteira dos portões de ${repo} antes de publicar.`, `Could not get a full run of the ${repo} gates before publishing.`), { repo });
      return null;
    }
    if (rodada.estado === 'vermelho') return reprovarPublicacao(m, repo, estado, `Os portões reprovaram a branch inteira:\n${acoes.cauda(rodada.saida)}`);
    if (!acoes.arvoreLimpa(pasta)) limparSobras(m, repo, 'depois dos portões da prova final');
    Object.assign(estado, { portoesRefeitos: 0, avisos: avisosDe(diff), provaFeita: acoes.cabeca(pasta) });
  }

  const envio = comServico(m, `push-${repo}`, (nome) => acoes.empurrar(pasta, alvo.branch, nome, m.prazo));
  if (envio.estado === 'rodando') return repetir(`O push de ${repo} está rodando há ${segundosDesde(envio.desde)} s.`);
  if (envio.estado === 'interrompido') {
    if (!estourouAsRefeitas(estado, 'pushesRefeitos')) return null;
    return bloquear(m, repo, `O push da branch ${alvo.branch} em ${repo} foi interrompido mais de uma vez. Confira a rede e o acesso ao GitHub.`);
  }
  if (envio.codigo !== 0) return bloquear(m, repo, `O push da branch ${alvo.branch} em ${repo} falhou:\n${acoes.cauda(envio.saida, 15)}`);
  estado.pushesRefeitos = 0;
  return abrirOuAtualizarPr(m, repo, alvo, estado, pasta);
}

function abrirOuAtualizarPr(m, repo, alvo, estado, pasta) {
  let pr = acoes.prDaBranch(pasta, alvo.branch);
  if (pr?.erro) return bloquear(m, repo, pr.erro);
  if (pr && pr.estado !== 'OPEN') {
    if (pr.cabeca === acoes.cabeca(pasta)) {
      avisar(m, `A PR #${pr.numero} da branch ${alvo.branch} em ${repo} já está ${pr.estado} e não há commit novo: nada foi publicado.`);
      Object.assign(estado, { pr: pr.numero, url: pr.url, rascunho: false, checks: `PR já ${pr.estado}`, fase: 'pronto' });
      return null;
    }
    // PR antiga, fechada ou incorporada: os commits novos pedem uma PR nova.
    pr = null;
  }
  const texto = corpoDaPr(m, repo, estado, pasta);
  const arquivo = naConducao(`pr-${repo}.md`);
  writeFileSync(arquivo, texto);
  if (!pr) {
    const rascunho = m.config.convencoes?.prRascunho !== false;
    const criada = acoes.criarPr(pasta, { base: m.config.repos[repo].base, branch: alvo.branch, titulo: estado.titulo, arquivoDoCorpo: arquivo, rascunho });
    pr = criada.ok ? acoes.prDaBranch(pasta, alvo.branch) : null;
    if (!pr || pr.erro) return bloquear(m, repo, `Não consegui abrir a PR de ${repo}:\n${acoes.cauda(criada.saida, 15)}`);
    registrar(m, `${repo}: PR #${pr.numero} aberta`);
  } else if (estado.corpo !== resumo(texto) && !acoes.atualizarCorpoDaPr(pasta, pr.numero, arquivo).ok) {
    avisar(m, `Não consegui atualizar a descrição da PR #${pr.numero} de ${repo}; o texto que ia para lá está em ${relativo(arquivo)}.`);
  }
  Object.assign(estado, {
    pr: pr.numero,
    url: pr.url,
    rascunho: pr.rascunho,
    corpo: resumo(texto),
    cabecaPublicada: acoes.cabeca(pasta),
    publicadoEm: Date.now(),
    verde: null,
    errosDeLeitura: 0,
    sincronizado: false,
    tentouSemRascunho: false,
    // Sem portões verdes não há o que esperar dos checks: a pendência já está escrita.
    fase: estado.publicarComoEsta ? 'pronto' : 'checks',
  });
  if (estado.publicarComoEsta) estado.checks = 'não acompanhados';
  atualizarEstado(m, 'esperar os checks da PR');
  return null;
}

// ------------------------------------------------------------------------- o texto da PR
// O que o script escreve na PR sai no idioma da PR. Este bloco é montado com o que o próprio
// script conferiu: o revisor humano não depende do relato de um modelo.

const TEXTOS = {
  pt: {
    provas: 'Provas (geradas pelo harness, não pelo modelo)',
    portoesVerdes: (nomes, sha) => `Portões locais (${nomes}): verdes para o commit ${sha}.`,
    portoesNao: (nomes) => `Portões locais (${nomes}): NÃO passam. Veja "Pendências".`,
    catraca: 'Catraca do diff: 0 bloqueios.',
    qa: (texto) => `QA na tela: ${texto}.`,
    qaPassou: 'passou',
    qaPendente: (motivo) => `PENDENTE — ${motivo}`,
    qaFalhou: 'FALHOU — veja "Pendências"',
    qaNaoSeAplica: 'não se aplica a este repositório',
    liberados: (lista) => `Desvios aprovados pelo humano: ${lista}.`,
    nenhum: 'nenhum',
    commits: 'Commits, cada um revisado por um agente de contexto limpo antes de existir:',
    decisoes: 'Decisões do agente',
    decisoesIntro: 'Tomadas sem perguntar, pela regra do projeto: primeiro o caminho dentro do padrão; sem ele, o menor desvio. Confira na revisão.',
    premissas: 'Premissas do plano:',
    pendencias: 'Pendências',
    pendenciasIntro: 'O que não fechou. Esta PR fica em rascunho até resolver.',
    detalhes: 'detalhes',
    revisao: (data) => `Revisão automática — ${data}`,
    revisaoIntro: (arquivos, lotes) => `Revisão linha por linha desta branch contra o padrão do projeto: ${arquivos} arquivo(s) em ${lotes} lote(s).`,
    mudancas: 'Mudanças enviadas:',
    semMudancas: 'Nenhuma mudança foi necessária.',
  },
  en: {
    provas: 'Proofs (generated by the harness, not by the model)',
    portoesVerdes: (nomes, sha) => `Local gates (${nomes}): green for commit ${sha}.`,
    portoesNao: (nomes) => `Local gates (${nomes}): NOT passing. See "Pending".`,
    catraca: 'Diff checks: 0 blocks.',
    qa: (texto) => `On-screen QA: ${texto}.`,
    qaPassou: 'passed',
    qaPendente: (motivo) => `PENDING — ${motivo}`,
    qaFalhou: 'FAILED — see "Pending"',
    qaNaoSeAplica: 'not applicable to this repository',
    liberados: (lista) => `Deviations approved by the human: ${lista}.`,
    nenhum: 'none',
    commits: 'Commits, each one reviewed by a clean-context agent before it existed:',
    decisoes: 'Decisions made by the agent',
    decisoesIntro: 'Made without asking, by the project rule: the path inside the pattern first; without one, the smallest deviation. Please check them in review.',
    premissas: 'Plan assumptions:',
    pendencias: 'Pending',
    pendenciasIntro: 'What did not close. This PR stays in draft until it is resolved.',
    detalhes: 'details',
    revisao: (data) => `Automated review — ${data}`,
    revisaoIntro: (arquivos, lotes) => `Line-by-line review of this branch against the project pattern: ${arquivos} file(s) in ${lotes} batch(es).`,
    mudancas: 'Changes pushed:',
    semMudancas: 'No changes were needed.',
  },
};

function linhasDeProva(m, repo, estado, pasta, t, lingua) {
  const portoes = (m.config.repos[repo].portoes ?? []).map((portao) => portao.nome).join(', ');
  const qa = { passou: t.qaPassou, pendente: t.qaPendente(estado.motivoDoQa?.[lingua] ?? ''), falhou: t.qaFalhou };
  const desvios = desviosAprovados();
  const linhas = [estado.publicarComoEsta ? t.portoesNao(portoes) : t.portoesVerdes(portoes, acoes.cabeca(pasta).slice(0, 7))];
  if (!estado.publicarComoEsta) linhas.push(t.catraca);
  if (!ehRevisao(m)) linhas.push(t.qa(qa[estado.qa] ?? t.qaNaoSeAplica), t.liberados(desvios.length > 0 ? crases(desvios) : t.nenhum));
  return linhas;
}

// Decisões e pendências, no idioma da PR. Detalhe (fim de log) vai recolhido.
function listaParaPr(itens, lingua, t) {
  return itens.flatMap((item) => {
    const linha = `- ${item[lingua] ?? item.pt}`;
    return item.detalhe ? [linha, `  <details><summary>${t.detalhes}</summary>`, '', '  ```', ...item.detalhe.split('\n').map((l) => `  ${l}`), '  ```', '  </details>'] : [linha];
  });
}

function secoesDeDecisao(m, repo, t, lingua, nivel) {
  const decisoes = doRepo(m.livro.decisoes, repo);
  const pendencias = doRepo(m.livro.pendencias, repo);
  const premissas = ehRevisao(m) ? '' : alvoDaConducao(m).premissas;
  const linhas = [];
  if (decisoes.length > 0 || premissas) {
    linhas.push('', `${nivel} ${t.decisoes}`, '', t.decisoesIntro, '');
    if (premissas) linhas.push(t.premissas, ...premissas.split('\n').filter((linha) => linha.trim() !== '').map((linha) => `  ${linha}`), '');
    linhas.push(...listaParaPr(decisoes, lingua, t));
  }
  if (pendencias.length > 0) linhas.push('', `${nivel} ${t.pendencias}`, '', t.pendenciasIntro, '', ...listaParaPr(pendencias, lingua, t));
  return linhas;
}

function corpoDaPr(m, repo, estado, pasta) {
  const lingua = idiomas(m).rotulos;
  const t = TEXTOS[lingua];
  const feitas = m.livro.feitas.filter((feita) => feita.repo === repo);
  if (ehRevisao(m)) {
    const { arquivos, lotes, commits } = resumoDaRevisao(m, repo);
    const base = estado.prExistente ? (estado.corpoOriginal ?? '').trim() : readFileSync(descricaoGuardada(repo), 'utf8').trim();
    const mudancas = commits.length > 0 ? [t.mudancas, ...commits.map((feita) => `- \`${feita.sha}\` ${feita.mensagem}${feita.feito ? ` — ${feita.feito}` : ''}`)] : [t.semMudancas];
    const secao = [
      '---',
      '',
      `## ${t.revisao(new Date().toISOString().slice(0, 10))}`,
      '',
      t.revisaoIntro(arquivos, lotes),
      '',
      ...mudancas,
      ...secoesDeDecisao(m, repo, t, lingua, '###'),
      '',
      `### ${t.provas}`,
      '',
      ...linhasDeProva(m, repo, estado, pasta, t, lingua).map((linha) => `- ${linha}`),
    ];
    return `${base}\n\n${secao.join('\n')}\n`;
  }
  const bloco = [
    '---',
    '',
    `## ${t.provas}`,
    '',
    ...linhasDeProva(m, repo, estado, pasta, t, lingua).map((linha) => `- ${linha}`),
    `- ${t.commits}`,
    ...feitas.map((feita) => `  - ${feita.sha} ${feita.mensagem}`),
    ...secoesDeDecisao(m, repo, t, lingua, '##'),
  ];
  return `${readFileSync(descricaoGuardada(repo), 'utf8').trim()}\n\n${bloco.join('\n')}\n`;
}

// ----------------------------------------------------------------------------------- checks

function acompanharChecks(m, repo, estado) {
  const segundos = Math.max(8, Math.round((m.prazo - Date.now()) / 1000));
  const intervaloSeg = Math.min(m.config.checks?.intervaloSeg ?? 20, Math.max(1, Math.floor(segundos / 2)));
  const leitura = acoes.esperarChecks(repo, { pr: estado.pr, sha: estado.cabecaPublicada, desde: estado.publicadoEm, segundos, intervaloSeg });
  if (leitura.codigo === 0) return checksVerdes(m, repo, estado, leitura);
  estado.verde = null;
  if (leitura.codigo === 3) {
    const minutos = Math.round((Date.now() - estado.publicadoEm) / 60000);
    if (minutos < m.opcoes.esperaDeChecksMin) return repetir(`Os checks da PR #${estado.pr} de ${repo} ainda estão rodando (${minutos} min).`);
    pendencia(m, bi(`Os checks da PR #${estado.pr} de ${repo} ainda estavam rodando depois de ${minutos} min; o maestro parou de esperar.`, `The checks of PR #${estado.pr} (${repo}) were still running after ${minutos} min; the run stopped waiting.`), { repo });
    return fecharChecks(m, repo, estado, 'ainda rodando');
  }
  if (leitura.codigo === 1) return checksVermelhos(m, repo, estado, leitura);
  if (leitura.codigo === 4) return semChecks(m, repo, estado);
  estado.errosDeLeitura = (estado.errosDeLeitura ?? 0) + 1;
  if (estado.errosDeLeitura <= MAXIMO_DE_ERROS_DE_LEITURA) return repetir(`Não consegui ler os checks da PR #${estado.pr} de ${repo}; tentando de novo.`);
  pendencia(m, bi(`Não consegui ler os checks da PR #${estado.pr} de ${repo}.`, `Could not read the checks of PR #${estado.pr} (${repo}).`), { repo, detalhe: leitura.saida });
  return fecharChecks(m, repo, estado, 'não lidos');
}

// Nenhum check apareceu. O motivo mais comum é CI que ignora PR em rascunho: se a PR é desta
// entrega, sai do rascunho uma vez e o maestro espera de novo. Continuando sem checks, fica o aviso.
function semChecks(m, repo, estado) {
  const pasta = pastaDoRepo(m.config, repo);
  if (estado.rascunho && !ehRevisao(m) && !estado.tentouSemRascunho && !temPendencia(m, repo)) {
    estado.tentouSemRascunho = true;
    if (acoes.marcarPronta(pasta, estado.pr).ok) {
      Object.assign(estado, { rascunho: false, publicadoEm: Date.now() });
      registrar(m, `${repo}: PR #${estado.pr} sem checks em rascunho; saiu do rascunho para o CI rodar`);
      return repetir(`A PR #${estado.pr} de ${repo} não registrou checks em rascunho; saiu do rascunho e o maestro espera de novo.`);
    }
  }
  avisar(m, `A PR #${estado.pr} de ${repo} não registrou nenhum check. Se o repositório roda CI em PR, confira no GitHub por que não disparou.`);
  return concluirChecks(m, repo, estado, 'sem checks');
}

// Um check externo (Sonar) pode se registrar depois que o CI terminou: o verde só vale se continuar
// verde, com o mesmo número de checks, depois de um intervalo.
function checksVerdes(m, repo, estado, leitura) {
  const total = Number(/VERDE — (\d+) checks/.exec(leitura.saida)?.[1] ?? 0);
  if (estado.verde?.total !== total) estado.verde = { total, quando: Date.now() };
  const falta = m.opcoes.confirmacaoDeVerdeSeg - segundosDesde(estado.verde.quando);
  if (falta > 0) return repetir(`Os checks da PR #${estado.pr} de ${repo} ficaram verdes; confirmando que nenhum check atrasado aparece (${falta} s).`);
  return concluirChecks(m, repo, estado, total === 1 ? '1 check verde' : `${total} checks verdes`);
}

function concluirChecks(m, repo, estado, comoFicou) {
  const pasta = pastaDoRepo(m.config, repo);
  if (acoes.prDaBranch(pasta, estado.pr)?.conflito) {
    pendencia(m, bi(`A PR #${estado.pr} de ${repo} tem conflito com a branch base. O maestro não faz merge nem rebase.`, `PR #${estado.pr} (${repo}) conflicts with the base branch. The run does not merge or rebase.`), { repo });
  }
  // Numa revisão o maestro não muda o estado de rascunho: a PR é de quem abriu.
  if (estado.rascunho && !ehRevisao(m) && !temPendencia(m, repo)) {
    if (acoes.marcarPronta(pasta, estado.pr).ok) estado.rascunho = false;
    else avisar(m, `Não consegui tirar a PR #${estado.pr} de ${repo} de rascunho.`);
  }
  return fecharChecks(m, repo, estado, comoFicou);
}

function fecharChecks(m, repo, estado, comoFicou) {
  Object.assign(estado, { checks: comoFicou, fase: 'pronto' });
  registrar(m, `${repo}: PR #${estado.pr} — ${comoFicou}`);
  return null;
}

function checksVermelhos(m, repo, estado, leitura) {
  estado.voltasDeChecks += 1;
  if (estado.voltasDeChecks > m.opcoes.voltasDeChecks) {
    pendencia(
      m,
      bi(
        `Os checks da PR #${estado.pr} de ${repo} continuam vermelhos depois de ${estado.voltasDeChecks - 1} correções.`,
        `The checks of PR #${estado.pr} (${repo}) are still red after ${estado.voltasDeChecks - 1} fix rounds.`,
      ),
      { repo, detalhe: leitura.saida },
    );
    return fecharChecks(m, repo, estado, 'vermelhos');
  }
  const achados = gravarNoPasso(m, `${repo}-checks.md`, leitura.saida || '(sem saída)');
  return pedirReparo(m, repo, {
    chave: `checks-${estado.voltasDeChecks}`,
    rotulo: 'correção dos checks da PR',
    nome: 'Checks',
    achados,
    depois: { tipo: 'repo', fase: 'publicar', origem: 'checks' },
  });
}

// ---------------------------------------------------------------------------------- entrega

function linhaDaPr(m, repo) {
  const estado = m.livro.repos[repo];
  if (estado.semEntrega || !estado.pr) return `${repo}: nada foi publicado.`;
  const situacao = estado.rascunho ? 'em rascunho' : 'pronta para revisão';
  return `PR de ${repo}: #${estado.pr} — ${estado.checks}, ${situacao} — ${estado.url}`;
}

const comDetalhe = (itens) => itens.flatMap((item) => [`- ${item.repo ? `${item.repo}: ` : ''}${item.pt}`, ...(item.detalhe ? item.detalhe.split('\n').map((linha) => `    | ${linha}`) : [])]);

// O relatório final é a única coisa que o humano precisa ler na conversa.
export function entregar(m) {
  const alvo = alvoDaConducao(m);
  // O maestro não mexe em repositório no qual não trabalhou. Se algo mudou lá sem ser do humano, ele diz.
  for (const repo of sobrasNosIntocados(m)) {
    const dir = dirDoRepo(m, repo);
    avisar(m, `Há mudanças sem commit em ${dir}/ que não estavam lá quando você passou a vez. A condução não trabalhou nesse repositório, e o maestro não mexeu nelas. Se não foi você, um subagente editou onde não devia: confira com git -C ${dir} status.`);
  }
  const { decisoes, pendencias, feitas } = m.livro;
  const avisos = m.livro.avisos ?? [];
  const linhas = [`${ehRevisao(m) ? 'REVISÃO' : 'ENTREGA'} — ${alvo.titulo}`, '', ...alvo.repos.map((repo) => linhaDaPr(m, repo))];
  if (feitas.length > 0) linhas.push('', 'Commits:', ...feitas.map((feita) => `- ${feita.repo} ${feita.sha} ${feita.mensagem}`));
  else linhas.push('', 'Nenhum commit novo.');
  if (alvo.premissas) linhas.push('', 'Premissas do plano (estão na descrição da PR; confira):', alvo.premissas);
  if (decisoes.length > 0) linhas.push('', 'Decisões que o agente tomou sozinho (estão na descrição da PR; confira):', ...comDetalhe(decisoes));
  if (pendencias.length > 0) linhas.push('', 'PENDÊNCIAS — o que não fechou (por isso a PR ficou em rascunho):', ...comDetalhe(pendencias));
  if (avisos.length > 0) linhas.push('', 'Avisos da condução:', ...emLista(avisos));
  const avisosDaCatraca = semRepetir(alvo.repos.flatMap((repo) => m.livro.repos[repo].avisos ?? []));
  if (avisosDaCatraca.length > 0) linhas.push('', 'Avisos da catraca:', ...emLista(avisosDaCatraca));
  linhas.push('', `Falta de você: ${pendencias.length > 0 ? 'resolver as pendências acima e, depois, ' : ''}revisar e fazer o merge.`);
  const relatorio = linhas.join('\n');
  if (!ehRevisao(m)) gravarPlano(m, definirStatus(textoDoPlano(m), pendencias.length > 0 ? 'com pendências' : 'em revisão'));
  atualizarEstado(m, pendencias.length > 0 ? 'resolver as pendências; depois, revisão humana e merge' : 'revisão humana e merge');
  return encerrarConducao(m, pendencias.length > 0 ? 'entregue com pendências' : 'entregue', relatorio);
}
