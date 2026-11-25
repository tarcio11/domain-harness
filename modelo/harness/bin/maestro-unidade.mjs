// A unidade de trabalho: uma fatia ou uma correção. Toda mudança de código passa pelo mesmo caminho:
// executar → o maestro confere (histórico, diff, escopo, portões) → revisar → o maestro faz o commit.
// Nenhum desfecho daqui vira pergunta: ou a unidade fecha num commit, ou o maestro desiste dela,
// desfaz o que ela deixou e a condução segue com o que já tem commit.

import * as acoes from './acoes.mjs';
import { branchAtual, ehRepoGit, git, nomesDosRepos, pastaDoRepo } from './config.mjs';
import { conferirRepo } from './conferir.mjs';
import {
  alvoDaConducao, anotarProblema, atualizarEstado, avisar, avisosDe, bi, bloqueiosDe, bloquear, comServico, crase, crases, decidir, despachar, dirDoRepo,
  descartarTrabalho, ehCodigo, ehRevisao, emLista, esquecerPasso, estadoDoRepo, estourouAsRefeitas, gravarNoPasso, gravarPlano, idiomas,
  limparSobras, ondeEstaOMapa, pendencia, registrar, regraDePadrao, relativo, repetir, respeitarOQueEDoHumano, rotuloDoRepo, segundosDesde, semRepetir, textoDoPlano,
} from './maestro-base.mjs';
import { achadosDoParecer, errosDoParecer } from './maestro-parecer.mjs';
import { marcarFatia } from './plano.mjs';
import { hashDaArvore } from './recibo.mjs';

// Sinais de mensagem de commit em português, para quando o repositório pede inglês.
const PARECE_PORTUGUES = /[áàâãéêíóôõúç]|\b(adiciona|adicionar|corrige|corrigir|ajusta|ajustar|cria|criar|altera|alterar|atualiza|atualizar|implementa|implementar|para|não|nao|uma)\b/i;
const entreCrases = (texto) => Array.from(String(texto).matchAll(/`([^`]+)`/g), (achado) => achado[1].trim());

// A primeira entrada num repositório é a hora de respeitar o que é do humano: mudança sem commit
// que era dele bloqueia. Depois dela, o que aparecer na pasta foi a condução que deixou, e o maestro limpa.
export function prepararRepo(m, repo, branch, { buscarSempre = false } = {}) {
  const pasta = pastaDoRepo(m.config, repo);
  const estado = estadoDoRepo(m, repo);
  const chave = `fetch-${repo}`;
  if (!m.livro.servicos[chave]) {
    if (!estado.entrou) {
      const bloqueio = respeitarOQueEDoHumano(m, [repo], repo);
      if (bloqueio) return bloqueio;
    } else if (!acoes.arvoreLimpa(pasta)) {
      limparSobras(m, repo, 'entre um passo e outro');
    }
    if (estado.entrou && !buscarSempre && branchAtual(pasta) === branch) return null;
  }
  const { base } = m.config.repos[repo];
  const entrada = comServico(m, chave, (nome) => acoes.entrarNaBranch(pasta, branch, base, nome, m.prazo, { sempre: buscarSempre || !estado.entrou }));
  if (entrada.estado === 'rodando') return repetir(`Buscando o remoto de ${repo}.`);
  if (entrada.estado === 'erro') return bloquear(m, repo, entrada.erro);
  estado.entrou = true;
  return null;
}

export function abrirUnidade(m, unidade) {
  const pasta = pastaDoRepo(m.config, unidade.repo);
  const entrada = prepararRepo(m, unidade.repo, alvoDaConducao(m).branch);
  if (entrada) return entrada;
  m.livro.unidade = {
    ...unidade,
    headAntes: acoes.cabeca(pasta),
    vizinhos: arvoresDosVizinhos(m, unidade.repo),
    fase: 'executar',
    voltas: 0,
    decisoes: [],
    pendencias: [],
    escopoExtra: [],
  };
  registrar(m, `abriu: ${unidade.rotulo}`);
  return null;
}

// O retrato dos outros repositórios quando o trabalho começa: o executor só mexe no dele.
function arvoresDosVizinhos(m, repo) {
  const vizinhos = nomesDosRepos(m.config).filter((nome) => nome !== repo && ehRepoGit(pastaDoRepo(m.config, nome)));
  return Object.fromEntries(vizinhos.map((nome) => [nome, hashDaArvore(pastaDoRepo(m.config, nome))]));
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
    repo: u.trabalho ?? `${u.rotulo}: corrigir o que os arquivos de "Achados a corrigir" apontam`,
  };
  const formato = m.config.convencoes?.commit || `o dos últimos commits (${crase(`git -C ${dir} log --oneline -8`)})`;
  return despachar(m, {
    chave,
    tipo: 'executar',
    papel: 'executar',
    titulo: `${u.rotulo}: ${achados.length > 0 ? 'corrigir' : 'implementar'}`,
    limite: 2 + m.opcoes.tentativasPorPasso + m.opcoes.voltasDeRevisao,
    seEsgotar: (_, esgotado) => desistirDaUnidade(m, esgotado),
    parametros: {
      Tarefa: m.id,
      Plano: ehRevisao(m) ? '(não há plano: o trabalho é o que os achados pedem)' : crase(relativo(m.caminhoDoPlano)),
      'Mapa do código': ondeEstaOMapa(m),
      Repositório: rotuloDoRepo(m, u.repo),
      'Regra de padrão': crase(regraDePadrao(u.repo)),
      Trabalho: achados.length === 0 ? trabalho.semAchados : trabalho[u.depois.tipo],
      Escopo: crases(semRepetir([...u.escopo, ...u.escopoExtra])),
      Espelhos: u.espelhos.length > 0 ? crases(u.espelhos) : '(ache pelo mapa do código e pela regra de padrão)',
      'Achados a corrigir': achados.length > 0 ? crases(achados) : '(nenhum)',
      'Formato do commit': `${formato}, em ${idiomas(m).commit}`,
      'Idioma das decisões': idiomas(m).pr,
    },
  });
}

function caminhoNoRepo(m, repo, caminho) {
  const dir = dirDoRepo(m, repo);
  const limpo = caminho.replace(/^\.\//, '').replace(/\/+$/, '');
  return limpo.startsWith(`${dir}/`) ? limpo.slice(dir.length + 1) : limpo;
}

export function receberExecucao(m, espera, resultado) {
  const u = m.livro.unidade;
  if (resultado.resultado === 'falhou') {
    anotarProblema(m, espera.chave, `A tentativa anterior terminou em "RESULTADO: falhou". O relato dela está em ${crase(espera.arquivo)}. O que ela fez continua nos arquivos: parta dali e tente outro caminho.`);
    return null;
  }
  const mensagem = resultado.commit ?? '';
  const erros = [];
  // O que o autor declarou acompanha o trabalho, mesmo que a linha COMMIT ainda precise ser refeita.
  if (resultado.resultado === 'ok') guardarODeclarado(m, u, resultado);
  if (resultado.resultado !== 'ok') {
    erros.push('A primeira linha tem que ser "RESULTADO: ok" ou "RESULTADO: falhou". Desvio não é resultado e não espera ninguém: decida pela seção 2 da lei, implemente e registre a escolha numa linha "DECISÃO: …".');
  } else if (mensagem.length < 5 || mensagem.length > 200) {
    erros.push('Falta a linha "COMMIT: <mensagem>", em uma linha, no formato de commit do repositório.');
  } else if (idiomas(m).commit === 'inglês' && PARECE_PORTUGUES.test(mensagem)) {
    erros.push(`A mensagem de commit ("${mensagem}") tem que ser em inglês, no formato dos commits do repositório. Reescreva a linha COMMIT.`);
  }
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['O arquivo de resultado da tentativa anterior está fora do formato:', ...emLista(erros), 'O que ela fez continua nos arquivos: confira e grave o resultado certo.'].join('\n'));
    return null;
  }
  Object.assign(u, { commit: mensagem, fase: 'conferir', conferencia: null, contestou: /^\s*contesto\s*:/im.test(resultado.texto) });
  if (u.rodadaAnterior) u.rodadaAnterior.resposta = espera.arquivo;
  return null;
}

// Decisões, pendências e escopo extra que o executor declarou no resultado. Acumulam entre as
// tentativas do mesmo trabalho, porque o que cada tentativa fez continua nos arquivos.
function guardarODeclarado(m, u, resultado) {
  const extras = resultado
    .linhas('ESCOPO EXTRA')
    .flatMap(entreCrases)
    .map((caminho) => caminhoNoRepo(m, u.repo, caminho))
    .filter((caminho) => caminho && !caminho.startsWith('/') && !caminho.split('/').includes('..'));
  Object.assign(u, {
    feito: resultado.campo('FEITO') ?? u.feito ?? null,
    decisoes: semRepetir([...u.decisoes, ...resultado.linhas('DECIS[ÃA]O')]),
    pendencias: semRepetir([...u.pendencias, ...resultado.linhas('PEND[ÊE]NCIA')]),
    escopoExtra: semRepetir([...u.escopoExtra, ...extras]),
  });
}

function devolverAoExecutor(m, u, titulo, itens) {
  anotarProblema(m, `${u.chave}-executar`, [titulo, ...itens].join('\n'));
  Object.assign(u, { fase: 'executar', conferencia: null });
  registrar(m, `${u.rotulo}: o maestro não aceitou (${titulo.split('.')[0]})`);
  return null;
}

// Branch trocada ou histórico reescrito: o maestro desfaz e o trabalho recomeça do último commit dele.
function problemaDeHistoria(m, u, pasta) {
  const { branch } = alvoDaConducao(m);
  if (branchAtual(pasta) !== branch) return `O repositório ${u.repo} saiu da branch ${branch} durante "${u.rotulo}".`;
  if (!git(pasta, ['merge-base', '--is-ancestor', u.headAntes, 'HEAD']).ok) {
    return `O histórico de ${u.repo} foi reescrito durante "${u.rotulo}" (o commit ${u.headAntes.slice(0, 7)} sumiu da branch).`;
  }
  return null;
}

const desfazerUnidade = (m, u) => descartarTrabalho(m, u.repo, alvoDaConducao(m).branch, u.headAntes, u.chave);

// O executor só escreve no repositório dele. Se outro repositório mudou enquanto ele trabalhava:
//   - um em que a condução já entrou é do maestro, e volta ao último commit;
//   - um ainda intocado pode ter sido mexido pelo humano: o maestro não toca. Se for da tarefa, o que
//     estiver lá sai do caminho quando a condução precisar dele; se não for, o relatório final avisa.
// Em nenhum dos casos o executor é cobrado: o trabalho dele é julgado no repositório dele.
function conferirVizinhos(m, u) {
  for (const [vizinho, arvore] of Object.entries(u.vizinhos ?? {})) {
    const pasta = pastaDoRepo(m.config, vizinho);
    if (hashDaArvore(pasta) === arvore) continue;
    if (m.livro.repos[vizinho]?.entrou && !acoes.arvoreLimpa(pasta)) limparSobras(m, vizinho, `durante "${u.rotulo}", que é de ${u.repo}`);
    u.vizinhos[vizinho] = hashDaArvore(pasta);
  }
}

function conferirUnidade(m, u) {
  const pasta = pastaDoRepo(m.config, u.repo);
  const historia = problemaDeHistoria(m, u, pasta);
  if (historia) {
    desfazerUnidade(m, u);
    return devolverAoExecutor(m, u, `${historia} O maestro desfez tudo e o trabalho recomeça do último commit dele. Não troque de branch, não faça commit e não reescreva o histórico.`, []);
  }

  const escopo = semRepetir([...u.escopo, ...u.escopoExtra]);
  const lerDiff = () => conferirRepo(m.config, u.repo, { modo: 'fatia', escopo, referencia: u.headAntes });
  if (!u.conferencia) {
    const antes = lerDiff();
    const problemas = bloqueiosDe(antes);
    if (antes.arquivos === 0) problemas.push('Nenhum arquivo mudou desde o começo deste trabalho.');
    conferirVizinhos(m, u);
    if (u.arvoreReprovada && hashDaArvore(pasta) === u.arvoreReprovada && !u.contestou) {
      problemas.push('O revisor reprovou e nada mudou. Corrija cada achado, ou conteste no arquivo de resultado com uma linha "Contesto: <achado> — <prova>".');
    }
    if (problemas.length > 0) return devolverAoExecutor(m, u, 'O maestro conferiu o diff e não aceitou. Corrija a causa de cada item:', emLista(problemas));
    u.conferencia = { arquivos: antes.lista.map((arquivo) => arquivo.caminho) };
  }

  const rodada = comServico(m, `portoes-${u.repo}`, (nome) => acoes.portoes(u.repo, pasta, nome, m.prazo, tempoDosPortoes(m, u.repo)));
  if (rodada.estado === 'rodando') return repetir(`Os portões de ${u.repo} estão rodando há ${segundosDesde(rodada.desde)} s.`);
  if (rodada.estado === 'interrompido' || rodada.estado === 'mudou') {
    if (!estourouAsRefeitas(u, 'portoesRefeitos')) return null;
    const causa =
      rodada.estado === 'mudou'
        ? bi('os arquivos mudam enquanto os portões rodam', 'files keep changing while the gates run')
        : bi('o processo dos portões some antes de terminar', 'the gates process dies before it finishes');
    return desistirDaUnidade(m, { resumo: bi(`não consegui uma rodada inteira dos portões de ${u.repo}: ${causa.pt}`, `could not get a full run of the ${u.repo} gates: ${causa.en}`), detalhe: null });
  }
  if (rodada.estado === 'vermelho') {
    return devolverAoExecutor(m, u, 'Os portões reprovaram o que está na pasta. Conserte a causa. Saída do maestro ao rodar:', [acoes.cauda(rodada.saida)]);
  }

  // Rodar os portões pode deixar arquivo novo (relatório, build) que o .gitignore não cobre:
  // o diff é lido de novo, agora com o que eles deixaram.
  const diff = lerDiff();
  const sobras = diff.lista.map((arquivo) => arquivo.caminho).filter((arquivo) => !u.conferencia.arquivos.includes(arquivo));
  if (sobras.length > 0) return tratarSobrasDosPortoes(m, u, pasta, sobras);
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

// Arquivo novo gerado pelos portões fica ignorado só nesta máquina, e os portões rodam de novo
// para o recibo valer. Arquivo versionado que os portões alteram é assunto do executor.
function tratarSobrasDosPortoes(m, u, pasta, sobras) {
  const dir = dirDoRepo(m, u.repo);
  const versionado = (arquivo) => git(pasta, ['ls-files', '--error-unmatch', '--', arquivo]).ok;
  const alterados = sobras.filter(versionado);
  if (alterados.length > 0) {
    return devolverAoExecutor(
      m,
      u,
      'Rodar os portões alterou arquivos versionados que não estavam no seu diff. Se a mudança faz parte do trabalho, inclua e declare com "ESCOPO EXTRA"; se não faz, ajuste o trabalho para os portões não mexerem neles:',
      emLista(alterados.map((arquivo) => `${dir}/${arquivo}`)),
    );
  }
  acoes.ignorarLocalmente(pasta, sobras);
  avisar(m, `Os portões de ${u.repo} geram arquivos que o .gitignore não cobre (${crases(sobras.map((arquivo) => `${dir}/${arquivo}`))}). Ficaram ignorados só nesta máquina, em .git/info/exclude; vale uma linha no .gitignore do repositório.`);
  u.conferencia = null;
  return null;
}

export const tempoDosPortoes = (m, repo) => (m.config.repos[repo].portoes?.length || 1) * (m.config.saida?.tempoMaximoPorPortaoMin ?? 15) + 5;

function despacharRevisao(m, u) {
  const declarado = [...u.decisoes.map((texto) => `DECISÃO: ${texto}`), ...u.escopoExtra.map((caminho) => `ESCOPO EXTRA: ${caminho}`)];
  return despachar(m, {
    chave: `${u.chave}-revisar-${u.voltas + 1}`,
    tipo: 'revisar',
    papel: 'revisar',
    titulo: `${u.rotulo}: revisar`,
    extra: { arvore: u.arvoreRevisada },
    seEsgotar: () => {
      decidir(
        m,
        bi(
          `Ponto em aberto (${u.rotulo}): o revisor interno não devolveu um parecer válido; o commit entrou com os portões verdes e a conferência do diff.`,
          `Open point (${u.rotulo}): the internal reviewer did not return a valid verdict; the commit went in with green gates and the diff checks.`,
        ),
        u.repo,
      );
      u.fase = 'commit';
      return null;
    },
    parametros: {
      Repositório: rotuloDoRepo(m, u.repo),
      'Regra de padrão': crase(regraDePadrao(u.repo)),
      'Comando do diff': crase(`git -C ${dirDoRepo(m, u.repo)} diff --cached ${u.headAntes}`),
      Plano: ehRevisao(m) ? '(não há plano)' : `${crase(relativo(m.caminhoDoPlano))} (mapa do código e desvios aprovados)`,
      Espelhos: u.espelhos.length > 0 ? crases(u.espelhos) : '(ache pelo mapa do código e pela regra de padrão)',
      'Arquivos novos': u.arquivosNovos.length > 0 ? `${crases(u.arquivosNovos)} — cada um precisa de uma linha em COMPARAÇÃO` : '(nenhum)',
      'Avisos da catraca': u.avisos.length > 0 ? u.avisos.join(' · ') : '(nenhum)',
      'Declarado pelo autor': declarado.length > 0 ? declarado.join(' · ') : '(nada)',
      'Rodada anterior': u.rodadaAnterior?.resposta ? `achados em ${crase(u.rodadaAnterior.achados)}; resposta do autor em ${crase(u.rodadaAnterior.resposta)}` : '(nenhuma)',
      'Idioma dos achados': idiomas(m).pr,
    },
  });
}

// Se a pasta mudou depois de conferida, o que foi conferido não vale mais: confere e revisa de novo.
function refazerConferencia(m, u, quando) {
  if (estourouAsRefeitas(u, 'conferenciasRefeitas')) {
    return desistirDaUnidade(m, { resumo: bi(`os arquivos de ${u.repo} continuam mudando ${quando.pt}`, `files in ${u.repo} keep changing ${quando.en}`), detalhe: null });
  }
  Object.assign(u, { fase: 'conferir', conferencia: null });
  registrar(m, `${u.rotulo}: a pasta mudou ${quando.pt}; o maestro confere de novo`);
  return null;
}

export function receberRevisao(m, espera, resultado) {
  const u = m.livro.unidade;
  const pasta = pastaDoRepo(m.config, u.repo);
  if (hashDaArvore(pasta) !== espera.arvore) return refazerConferencia(m, u, bi('durante a revisão', 'during the review'));
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
    // Os portões estão verdes e a catraca não tem bloqueio: o que sobra é julgamento, e quem arbitra é o revisor humano.
    const pontos = achadosDoParecer(resultado).join(' · ');
    decidir(
      m,
      bi(
        `Ponto em aberto (${u.rotulo}): depois de ${u.voltas} rodadas, o revisor interno ainda apontava: ${pontos}`,
        `Open point (${u.rotulo}): after ${u.voltas} rounds, the internal reviewer still flagged: ${pontos}`,
      ),
      u.repo,
    );
    u.fase = 'commit';
    return null;
  }
  Object.assign(u, { fase: 'executar', achados: espera.arquivo, rodadaAnterior: { achados: espera.arquivo, resposta: null }, arvoreReprovada: espera.arvore, contestou: false });
  registrar(m, `${u.rotulo}: o revisor reprovou, volta para correção`);
  return null;
}

function commitDaUnidade(m, u) {
  const pasta = pastaDoRepo(m.config, u.repo);
  const chave = `commit-${u.repo}`;
  if (!m.livro.servicos[chave] && hashDaArvore(pasta) !== u.arvoreRevisada) return refazerConferencia(m, u, bi('depois da revisão', 'after the review'));
  const feito = comServico(m, chave, (nome) => acoes.commit(pasta, u.commit, nome, m.prazo));
  if (feito.estado === 'rodando') return repetir(`O commit de "${u.rotulo}" está rodando (hooks do repositório) há ${segundosDesde(feito.desde)} s.`);
  if (feito.estado === 'interrompido') {
    if (!estourouAsRefeitas(u, 'commitsRefeitos')) return null;
    return desistirDaUnidade(m, { resumo: bi(`o commit em ${u.repo} foi interrompido mais de uma vez`, `the commit in ${u.repo} was interrupted more than once`), detalhe: null });
  }
  if (feito.codigo !== 0) {
    const recusa = gravarNoPasso(m, `${u.chave}-commit-recusado.md`, `O commit foi recusado pelos hooks do repositório. Corrija a causa (código ou mensagem de commit):\n${acoes.cauda(feito.saida)}`);
    Object.assign(u, { fase: 'executar', achados: recusa });
    return null;
  }
  if (!acoes.arvoreLimpa(pasta)) limparSobras(m, u.repo, `depois do commit de "${u.rotulo}"`);
  concluirUnidade(m, u, pasta);
  return null;
}

function concluirUnidade(m, u, pasta) {
  const sha = acoes.cabeca(pasta).slice(0, 7);
  m.livro.feitas.push({ trabalho: u.rotulo, repo: u.repo, sha, mensagem: u.commit, feito: u.feito, tipo: u.depois.tipo === 'fatia' ? 'fatia' : u.depois.origem });
  registrar(m, `${u.rotulo}: commit ${sha}`);
  // O que o executor declarou já vem no idioma da PR; o nome do trabalho, na frente, acompanha.
  const nome = typeof u.nome === 'object' && u.nome ? u.nome : bi(u.nome ?? u.rotulo, u.nome ?? u.rotulo);
  for (const texto of u.decisoes) decidir(m, bi(`${nome.pt}: ${texto}`, `${nome.en}: ${texto}`), u.repo);
  for (const texto of u.pendencias) pendencia(m, bi(`${nome.pt}: ${texto}`, `${nome.en}: ${texto}`), { repo: u.repo });
  if (u.depois.tipo === 'fatia') {
    m.livro.concluidas.push(u.depois.id);
    gravarPlano(m, marcarFatia(textoDoPlano(m), u.depois.id, true));
  } else {
    const estado = estadoDoRepo(m, u.repo);
    if (u.depois.origem === 'lote') estado.lotes[u.depois.lote].status = 'corrigido';
    estado.fase = u.depois.fase;
  }
  esquecerPasso(m, u.chave);
  m.livro.unidade = null;
  atualizarEstado(m, 'o maestro segue conduzindo');
}

// Desistir de uma unidade: o que ela deixou vai para um patch, o repositório volta ao último commit
// do maestro e fica escrito o que não fechou. Fatia que não fecha encerra a execução das fatias,
// porque as seguintes dependem dela; correção que não fecha vira ponto em aberto ou pendência.
export function desistirDaUnidade(m, { resumo, detalhe }) {
  const u = m.livro.unidade;
  const patch = desfazerUnidade(m, u);
  const onde = patch ? bi(` O que foi tentado está em ${patch}.`, ` What was tried is saved in ${patch}.`) : bi('', '');
  esquecerPasso(m, u.chave);
  m.livro.unidade = null;
  registrar(m, `${u.rotulo}: desistiu (${resumo.pt})`);
  if (u.depois.tipo === 'fatia') {
    pendencia(
      m,
      bi(
        `A fatia ${u.rotulo} não fechou e ficou de fora da entrega, com as fatias que vinham depois dela: ${resumo.pt}.${onde.pt}`,
        `Slice ${u.rotulo} did not close and was left out of this delivery, along with the slices after it: ${resumo.en}.${onde.en}`,
      ),
      { repo: u.repo, detalhe },
    );
    m.livro.interrompida = true;
  } else {
    desistirDoReparo(m, u, { resumo, detalhe, onde });
  }
  atualizarEstado(m, 'o maestro segue com o que já tem commit');
  return null;
}

function desistirDoReparo(m, u, { resumo, detalhe, onde }) {
  const estado = estadoDoRepo(m, u.repo);
  const { origem } = u.depois;
  if (origem === 'lote') {
    const lote = estado.lotes[u.depois.lote];
    const pontos = (lote.pontos ?? []).join(' · ');
    lote.status = 'aberto';
    estado.fase = 'revisao';
    decidir(
      m,
      bi(
        `Ponto em aberto da revisão (${lote.arquivos.length} arquivo(s) a partir de ${lote.arquivos[0]}): os ajustes não fecharam (${resumo.pt}). O revisor apontava: ${pontos}`,
        `Open point from the review (${lote.arquivos.length} file(s) starting at ${lote.arquivos[0]}): the fixes did not close (${resumo.en}). The reviewer flagged: ${pontos}`,
      ),
      u.repo,
    );
  } else if (origem === 'qa') {
    // O repositório da correção segue o caminho dele; o da tela para de esperar por ela.
    estado.fase = u.depois.fase;
    const tela = estadoDoRepo(m, u.depois.qaDe);
    tela.qa = 'falhou';
    if (tela.fase === 'qa') tela.fase = 'descricao';
    pendencia(
      m,
      bi(
        `O QA na tela achou falhas e a correção em ${u.repo} não fechou: ${resumo.pt}.${onde.pt}`,
        `On-screen QA found failures and the fix in ${u.repo} did not close: ${resumo.en}.${onde.en}`,
      ),
      { repo: u.depois.qaDe, detalhe },
    );
  } else if (origem === 'prova') {
    Object.assign(estado, { publicarComoEsta: true, fase: 'publicar' });
    pendencia(
      m,
      bi(
        `A branch de ${u.repo} não passa na prova final (catraca e portões da branch inteira) e a correção não fechou: ${resumo.pt}.${onde.pt}`,
        `The ${u.repo} branch does not pass the final proof (diff checks and gates on the whole branch) and the fix did not close: ${resumo.en}.${onde.en}`,
      ),
      { repo: u.repo, detalhe },
    );
  } else {
    estado.fase = 'pronto';
    pendencia(
      m,
      bi(
        `Os checks da PR #${estado.pr} de ${u.repo} continuam vermelhos e a correção não fechou: ${resumo.pt}.${onde.pt}`,
        `The checks of PR #${estado.pr} (${u.repo}) are still red and the fix did not close: ${resumo.en}.${onde.en}`,
      ),
      { repo: u.repo, detalhe },
    );
  }
}
