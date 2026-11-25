// A segunda parte da condução, por repositório: as fatias, a revisão do conjunto, o QA na tela,
// a descrição, a publicação da PR, os checks e o relatório final.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as acoes from './acoes.mjs';
import { desviosAprovados, git, pastaDoRepo } from './config.mjs';
import { conferirRepo } from './conferir.mjs';
import {
  anotarProblema, atualizarEstado, avisosDe, bloqueiosDe, comServico, crase, crases, despachar, dirDoRepo, ehCodigo, emLista, estourouAsRefeitas,
  gravarNoPasso, gravarPlano, orientacao, parar, planoAtual, registrar, relativo, repetir, reposDoPlano, resumo, rotuloDoRepo,
  segundosDesde, semRepetir, textoDoPlano,
} from './maestro-base.mjs';
import { errosDoParecer } from './maestro-parecer.mjs';
import { abrirUnidade, entrarNaBranchDaTarefa, parametrosDaRevisao, tempoDosPortoes } from './maestro-unidade.mjs';
import { definirStatus } from './plano.mjs';
import { hashDaArvore } from './recibo.mjs';

const REPO_COM_TELA = 'frontend';
const LINHA_DE_QA = /^[\s>*_`-]*(CA\d+|EXTRA)[*_`]*\s*:[*_`\s]*(passou|falhou)\b(.*)$/i;
const MAXIMO_DE_ERROS_DE_LEITURA = 3;

export function estadoDoRepo(m, repo) {
  m.livro.repos[repo] ??= { fase: 'fatias', qa: null, ciclosDeQa: 0, conjuntoAprovado: false, voltasDeConjunto: 0, voltasDePublicacao: 0, voltasDeChecks: 0 };
  return m.livro.repos[repo];
}

export const temFatiaAberta = (m, plano, repo) => plano.fatias.some((fatia) => fatia.repo === repo && !m.livro.concluidas.includes(fatia.id));
const escopoDoRepo = (plano, repo) => semRepetir(plano.fatias.filter((fatia) => fatia.repo === repo).flatMap((fatia) => fatia.escopo));
const espelhosDoRepo = (plano, repo) => semRepetir(plano.fatias.filter((fatia) => fatia.repo === repo).flatMap((fatia) => fatia.espelho));

// Uma correção depois das fatias (revisão do conjunto, QA, prova final, checks) vira uma unidade
// de trabalho com o escopo do repositório inteiro. O pedido fica no livro até a unidade abrir.
function pedirReparo(m, repo, reparo) {
  Object.assign(estadoDoRepo(m, repo), { fase: 'reparo', reparo });
  registrar(m, `${repo}: ${reparo.rotulo}`);
  return null;
}

export function conduzirRepo(m, repo, plano) {
  const estado = estadoDoRepo(m, repo);
  const fatias = plano.fatias.filter((fatia) => fatia.repo === repo);
  // Um ajuste do plano pode dar trabalho novo a um repositório que já tinha passado das fatias.
  if (!['fatias', 'reparo'].includes(estado.fase) && temFatiaAberta(m, plano, repo)) {
    Object.assign(estado, { fase: 'fatias', conjuntoAprovado: false, qa: null });
  }
  switch (estado.fase) {
    case 'fatias': {
      const aberta = fatias.find((fatia) => !m.livro.concluidas.includes(fatia.id));
      if (!aberta) {
        estado.fase = 'conjunto';
        return null;
      }
      return abrirUnidade(m, plano, {
        chave: aberta.id,
        repo,
        rotulo: `${aberta.id} · ${aberta.nome}`,
        escopo: aberta.escopo,
        espelhos: aberta.espelho,
        achados: null,
        depois: { tipo: 'fatia', id: aberta.id },
      });
    }
    case 'reparo': {
      const { chave, rotulo, achados, depois } = estado.reparo;
      return abrirUnidade(m, plano, {
        chave: `${repo}-${chave}`,
        repo,
        rotulo: `${repo}: ${rotulo}`,
        escopo: escopoDoRepo(plano, repo),
        espelhos: espelhosDoRepo(plano, repo),
        achados,
        depois: { tipo: 'repo', fase: depois },
      });
    }
    case 'conjunto':
      return revisarConjunto(m, repo, plano, estado, fatias);
    case 'qa':
      return despacharQa(m, repo, plano, estado);
    case 'descricao':
      return descreverPr(m, repo, estado);
    case 'publicar':
      return publicar(m, repo, plano);
    case 'checks':
      return acompanharChecks(m, repo);
    default:
      return parar(m, 'falha', repo, `Fase desconhecida no livro do maestro: ${estado.fase}.`);
  }
}

// O QA vem depois da revisão do conjunto, para testar o código que vai para a PR.
function depoisDoConjunto(m, repo, estado) {
  if (repo !== REPO_COM_TELA || estado.qa === 'passou') return 'descricao';
  if (m.opcoes.qa === 'auto') return 'qa';
  Object.assign(estado, { qa: 'pendente', motivoDoQa: 'o harness está configurado para você testar (maestro.qa)' });
  return 'descricao';
}

function baseDoRepo(m, repo) {
  const pasta = pastaDoRepo(m.config, repo);
  const { base } = m.config.repos[repo];
  const comum = [`origin/${base}`, base].map((candidata) => git(pasta, ['merge-base', 'HEAD', candidata])).find((r) => r.ok);
  if (!comum) throw new Error(`Não achei a branch base "${base}" em ${dirDoRepo(m, repo)}/. Rode "git fetch origin" ou corrija repos.${repo}.base em harness/config.json.`);
  return comum.saida.trim();
}

function revisarConjunto(m, repo, plano, estado, fatias) {
  if (fatias.length < 2 || estado.conjuntoAprovado) {
    estado.fase = depoisDoConjunto(m, repo, estado);
    return null;
  }
  const pasta = pastaDoRepo(m.config, repo);
  const referencia = baseDoRepo(m, repo);
  const diff = conferirRepo(m.config, repo, { modo: 'pr' });
  const novos = diff.lista.filter((arquivo) => arquivo.novo && ehCodigo(m, arquivo.caminho)).map((arquivo) => arquivo.caminho);
  return despachar(m, {
    chave: `${repo}-conjunto-${estado.voltasDeConjunto + 1}`,
    tipo: 'conjunto',
    papel: 'revisar',
    titulo: `${repo}: revisar o conjunto das fatias`,
    orientacao: repo,
    extra: { repo, arvore: hashDaArvore(pasta), referencia, novos },
    parametros: parametrosDaRevisao(m, repo, `git -C ${dirDoRepo(m, repo)} diff ${referencia}...HEAD`, {
      espelhos: espelhosDoRepo(plano, repo),
      novos,
      avisos: avisosDe(diff),
      anterior: null,
    }),
  });
}

export function receberConjunto(m, espera, resultado) {
  const { repo } = espera;
  const estado = m.livro.repos[repo];
  if (hashDaArvore(pastaDoRepo(m.config, repo)) !== espera.arvore) {
    return parar(m, 'falha', repo, `Os arquivos de ${repo} mudaram durante a revisão do conjunto, e o revisor só pode ler. Veja com git status, desfaça o que não é do trabalho e responda.`);
  }
  const erros = errosDoParecer(m, resultado, { repo, referencia: espera.referencia, novos: espera.novos });
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['O arquivo de resultado da revisão anterior não foi aceito:', ...emLista(erros)].join('\n'));
    return null;
  }
  if (resultado.veredito === 'APROVADO') {
    Object.assign(estado, { conjuntoAprovado: true, fase: depoisDoConjunto(m, repo, estado) });
    return null;
  }
  estado.voltasDeConjunto += 1;
  if (estado.voltasDeConjunto > m.opcoes.voltasDeRevisao) {
    return parar(m, 'falha', repo, [`O revisor reprovou o conjunto de ${repo} ${estado.voltasDeConjunto} vezes. Último parecer:`, resultado.texto, 'Diga como seguir.'].join('\n\n'));
  }
  return pedirReparo(m, repo, { chave: `conjunto-${estado.voltasDeConjunto}`, rotulo: 'correção da revisão do conjunto', achados: espera.arquivo, depois: 'conjunto' });
}

// --------------------------------------------------------------------------------------- QA

function despacharQa(m, repo, plano, estado) {
  const arvores = Object.fromEntries(reposDoPlano(m, plano).map((nome) => [nome, hashDaArvore(pastaDoRepo(m.config, nome))]));
  return despachar(m, {
    chave: `qa-${estado.ciclosDeQa + 1}`,
    tipo: 'qa',
    papel: 'qa',
    titulo: 'QA na tela',
    orientacao: 'qa',
    extra: { repo, arvores },
    parametros: {
      Tarefa: m.id,
      Plano: crase(relativo(m.caminhoDoPlano)),
      'Relatório do QA': crase(relativo(join(m.pasta, 'qa.md'))),
      'Resposta do humano': orientacao(m, 'qa'),
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

function errosDoQa(resultado, linhas, plano) {
  if (!['passou', 'falhou', 'bloqueado'].includes(resultado.resultado)) {
    return ['A primeira linha tem que ser "RESULTADO: passou", "RESULTADO: falhou" ou "RESULTADO: bloqueado".'];
  }
  if (resultado.resultado === 'bloqueado') return [];
  const erros = [];
  const semLinha = plano.criterios.map((criterio) => criterio.id).filter((id) => !linhas.some((linha) => linha.item === id));
  if (semLinha.length > 0) erros.push(`Falta uma linha "CAn: passou — evidência" ou "CAn: falhou — onde: … — …" para: ${semLinha.join(', ')}.`);
  const falhas = linhas.filter((linha) => !linha.passou);
  if (resultado.resultado === 'passou' && falhas.length > 0) erros.push('"RESULTADO: passou" não combina com linha "falhou". Se algo falhou, o resultado é "falhou".');
  if (resultado.resultado === 'falhou' && falhas.length === 0) erros.push('"RESULTADO: falhou" precisa de pelo menos uma linha "CAn: falhou — onde: frontend|backend — …".');
  return erros;
}

export function receberQa(m, espera, resultado) {
  const { repo } = espera;
  const estado = m.livro.repos[repo];
  const plano = planoAtual(m);
  const mexidos = Object.entries(espera.arvores).filter(([nome, arvore]) => hashDaArvore(pastaDoRepo(m.config, nome)) !== arvore).map(([nome]) => nome);
  if (mexidos.length > 0) {
    return parar(m, 'falha', 'qa', `O QA alterou arquivos em ${mexidos.join(' e ')}, e ele só pode testar. Veja com git status, desfaça e responda.`);
  }
  const linhas = lerLinhasDoQa(resultado.texto);
  const erros = errosDoQa(resultado, linhas, plano);
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['O arquivo de resultado do QA anterior não foi aceito:', ...emLista(erros)].join('\n'));
    return null;
  }
  delete m.livro.orientacoes.qa;
  if (resultado.resultado === 'passou') {
    Object.assign(estado, { qa: 'passou', fase: 'descricao' });
    registrar(m, 'QA na tela passou');
    return null;
  }
  if (resultado.resultado === 'bloqueado') {
    const motivo = resultado.campo('MOTIVO') ?? 'o agente não conseguiu testar na tela';
    Object.assign(estado, { qa: 'pendente', motivoDoQa: motivo.slice(0, 300), fase: 'descricao' });
    m.livro.decisoes.push(`O QA na tela ficou pendente (${motivo.slice(0, 200)}): a PR do ${repo} fica em rascunho até você testar.`);
    registrar(m, 'QA na tela bloqueado: segue com a PR em rascunho');
    return null;
  }
  estado.ciclosDeQa += 1;
  if (estado.ciclosDeQa > m.opcoes.ciclosDeQa) {
    return parar(m, 'falha', 'qa', [`O QA na tela falhou ${estado.ciclosDeQa} vezes seguidas. Último resultado:`, resultado.texto, 'Diga como seguir.'].join('\n\n'));
  }
  const onde = semRepetir(linhas.filter((linha) => !linha.passou).map((linha) => linha.onde ?? repo));
  const deFora = onde.filter((nome) => !reposDoPlano(m, plano).includes(nome));
  if (deFora.length > 0) {
    return parar(m, 'humano', 'qa', [`O QA apontou falha em ${deFora.join(' e ')}, que não faz parte deste plano:`, resultado.texto, 'Diga como seguir.'].join('\n\n'));
  }
  // Quem já tem PR aberta recebe a correção e publica de novo; o repositório da tela volta ao QA.
  for (const nome of onde) {
    pedirReparo(m, nome, { chave: `qa-${estado.ciclosDeQa}`, rotulo: 'correção das falhas do QA', achados: espera.arquivo, depois: nome === repo ? 'qa' : 'publicar' });
  }
  if (!onde.includes(repo)) estado.fase = 'qa';
  return null;
}

// --------------------------------------------------------------------------------------- PR

const descricaoDaPr = (m, repo) => join(m.pasta, `pr-${repo}.md`);

function descreverPr(m, repo, estado) {
  if (estado.titulo && existsSync(descricaoDaPr(m, repo))) {
    estado.fase = 'publicar';
    return null;
  }
  const dir = dirDoRepo(m, repo);
  return despachar(m, {
    chave: `${repo}-descricao`,
    tipo: 'descricao',
    papel: 'descrever',
    titulo: `${repo}: escrever a descrição da PR`,
    orientacao: repo,
    extra: { repo },
    parametros: {
      Tarefa: m.id,
      Plano: crase(relativo(m.caminhoDoPlano)),
      Repositório: rotuloDoRepo(m, repo),
      'Resumo do diff': crase(`git -C ${dir} diff --stat ${baseDoRepo(m, repo)}...HEAD`),
      'Modelo de PR': m.config.convencoes?.modeloPr || '(sem modelo: use as seções do roteiro)',
      'Formato do título': m.config.convencoes?.tituloPr || '(curto, com o código do card)',
      'Arquivo da descrição': crase(relativo(descricaoDaPr(m, repo))),
    },
  });
}

export function receberDescricao(m, espera, resultado) {
  const { repo } = espera;
  const corpo = descricaoDaPr(m, repo);
  const titulo = resultado.titulo ?? '';
  const erros = [];
  if (titulo.length < 5 || titulo.length > 120) erros.push('Falta no arquivo de resultado a linha "TITULO: <título da PR>" (de 5 a 120 caracteres, em uma linha).');
  if (!existsSync(corpo) || readFileSync(corpo, 'utf8').trim().length < 80) erros.push(`A descrição não foi gravada em ${relativo(corpo)}, ou está curta demais.`);
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['A descrição da PR anterior não foi aceita:', ...emLista(erros)].join('\n'));
    return null;
  }
  Object.assign(m.livro.repos[repo], { titulo, fase: 'publicar' });
  return null;
}

function reprovarPublicacao(m, repo, motivo) {
  const estado = m.livro.repos[repo];
  Object.assign(estado, { voltasDePublicacao: estado.voltasDePublicacao + 1, sincronizado: false });
  if (estado.voltasDePublicacao > m.opcoes.voltasDeRevisao) return parar(m, 'falha', repo, `${motivo}\n\nDiga como seguir.`);
  const achados = gravarNoPasso(m, `${repo}-prova-final.md`, motivo);
  return pedirReparo(m, repo, { chave: `prova-final-${estado.voltasDePublicacao}`, rotulo: 'correção da prova final', achados, depois: 'publicar' });
}

// Última prova antes de publicar: branch em dia com o remoto, diff inteiro sem bloqueio e
// portões verdes para exatamente o que vai subir. Só então push e PR.
function publicar(m, repo, plano) {
  const estado = m.livro.repos[repo];
  const pasta = pastaDoRepo(m.config, repo);
  const dir = dirDoRepo(m, repo);
  if (!acoes.arvoreLimpa(pasta)) {
    return parar(m, 'falha', repo, `Há mudanças sem commit em ${dir}/ na hora de publicar. Veja com git status, resolva e responda.`);
  }
  if (!estado.sincronizado) {
    const entrada = entrarNaBranchDaTarefa(m, repo, plano, repo, { buscarSempre: true });
    if (entrada) return entrada;
    estado.sincronizado = true;
  }

  const diff = conferirRepo(m.config, repo, { modo: 'pr' });
  const bloqueios = bloqueiosDe(diff);
  if (bloqueios.length > 0) return reprovarPublicacao(m, repo, ['A branch inteira tem bloqueios da catraca:', ...emLista(bloqueios)].join('\n'));

  const rodada = comServico(m, `portoes-${repo}`, (nome) => acoes.portoes(repo, pasta, nome, m.prazo, tempoDosPortoes(m, repo)));
  if (rodada.estado === 'rodando') return repetir(`Os portões de ${repo} estão rodando há ${segundosDesde(rodada.desde)} s (prova final).`);
  if (rodada.estado === 'interrompido' || rodada.estado === 'mudou') {
    if (!estourouAsRefeitas(estado, 'portoesRefeitos')) return null;
    return parar(m, 'falha', repo, `Não consegui uma rodada inteira dos portões de ${repo} antes de publicar. Rode à mão ${crase(`node harness/bin/portoes.mjs ${repo} --pr`)}, veja o que acontece e responda.`);
  }
  if (rodada.estado === 'vermelho') return reprovarPublicacao(m, repo, `Os portões reprovaram a branch inteira:\n${acoes.cauda(rodada.saida)}`);
  if (!acoes.arvoreLimpa(pasta)) {
    return parar(m, 'humano', repo, `Rodar os portões de ${repo} deixou arquivos novos na pasta (veja com git status). Provavelmente falta uma linha no .gitignore. Resolva e responda.`);
  }
  Object.assign(estado, { portoesRefeitos: 0, avisos: avisosDe(diff) });

  const envio = comServico(m, `push-${repo}`, (nome) => acoes.empurrar(pasta, plano.branch, nome, m.prazo));
  if (envio.estado === 'rodando') return repetir(`O push de ${repo} está rodando há ${segundosDesde(envio.desde)} s.`);
  if (envio.estado === 'interrompido') {
    if (!estourouAsRefeitas(estado, 'pushesRefeitos')) return null;
    return parar(m, 'falha', repo, `O push da branch ${plano.branch} em ${repo} foi interrompido mais de uma vez. Tente à mão e responda.`);
  }
  if (envio.codigo !== 0) return parar(m, 'falha', repo, `O push da branch ${plano.branch} em ${repo} falhou:\n${acoes.cauda(envio.saida, 15)}\nResolva e responda.`);
  estado.pushesRefeitos = 0;
  return abrirOuAtualizarPr(m, repo, plano, estado, pasta);
}

function abrirOuAtualizarPr(m, repo, plano, estado, pasta) {
  let pr = acoes.prDaBranch(pasta, plano.branch);
  if (pr?.erro) return parar(m, 'falha', repo, `${pr.erro}\nResolva e responda.`);
  if (pr && pr.estado !== 'OPEN') {
    if (pr.cabeca === acoes.cabeca(pasta)) {
      return parar(m, 'humano', repo, `A PR #${pr.numero} da branch ${plano.branch} em ${repo} está ${pr.estado} e não há commit novo para publicar. Diga como seguir.`);
    }
    // PR antiga, fechada ou incorporada: os commits novos pedem uma PR nova.
    pr = null;
  }
  const corpo = join(m.pasta, `pr-${repo}.final.md`);
  const texto = `${readFileSync(descricaoDaPr(m, repo), 'utf8').trim()}\n${provasDaPr(m, repo, pasta)}\n`;
  writeFileSync(corpo, texto);
  if (!pr) {
    const rascunho = m.config.convencoes?.prRascunho !== false;
    const criada = acoes.criarPr(pasta, { base: m.config.repos[repo].base, branch: plano.branch, titulo: estado.titulo, arquivoDoCorpo: corpo, rascunho });
    pr = criada.ok ? acoes.prDaBranch(pasta, plano.branch) : null;
    if (!pr || pr.erro) return parar(m, 'falha', repo, `Não consegui abrir a PR de ${repo}:\n${acoes.cauda(criada.saida, 15)}\nResolva e responda.`);
    registrar(m, `${repo}: PR #${pr.numero} aberta`);
  } else if (estado.corpo !== resumo(texto) && !acoes.atualizarCorpoDaPr(pasta, pr.numero, corpo).ok) {
    registrar(m, `${repo}: não consegui atualizar a descrição da PR #${pr.numero}`);
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
    fase: 'checks',
  });
  return null;
}

// Este bloco é escrito pelo script com o que ele mesmo conferiu: o revisor não depende do relato do modelo.
function provasDaPr(m, repo, pasta) {
  const estado = m.livro.repos[repo];
  const portoes = (m.config.repos[repo].portoes ?? []).map((portao) => portao.nome).join(', ');
  const qa = {
    passou: 'passou (o relatório está em qa.md, na pasta da tarefa)',
    pendente: `PENDENTE — ${estado.motivoDoQa}`,
  };
  const desvios = desviosAprovados();
  const commits = m.livro.feitas.filter((feita) => feita.repo === repo).map((feita) => `  - ${feita.sha} ${feita.mensagem}`);
  return [
    '',
    '---',
    '',
    '## Provas (geradas pelo harness, não pelo modelo)',
    '',
    `- Portões locais (${portoes}): verdes para o commit ${acoes.cabeca(pasta).slice(0, 7)}.`,
    `- Catraca do diff: 0 bloqueios.${estado.avisos.length > 0 ? ` Avisos: ${estado.avisos.join(' · ')}` : ''}`,
    `- QA na tela: ${qa[estado.qa] ?? 'não se aplica a este repositório'}.`,
    `- Desvios aprovados pelo humano: ${desvios.length > 0 ? crases(desvios) : 'nenhum'}.`,
    '- Commits, cada um revisado por um agente de contexto limpo antes de existir:',
    ...commits,
  ].join('\n');
}

function acompanharChecks(m, repo) {
  const estado = m.livro.repos[repo];
  const segundos = Math.max(8, Math.round((m.prazo - Date.now()) / 1000));
  const intervaloSeg = Math.min(m.config.checks?.intervaloSeg ?? 20, Math.max(1, Math.floor(segundos / 2)));
  const leitura = acoes.esperarChecks(repo, { pr: estado.pr, sha: estado.cabecaPublicada, desde: estado.publicadoEm, segundos, intervaloSeg });
  if (leitura.codigo === 0) return checksVerdes(m, repo, estado, leitura);
  estado.verde = null;
  if (leitura.codigo === 3) {
    const minutos = Math.round((Date.now() - estado.publicadoEm) / 60000);
    if (minutos < m.opcoes.esperaDeChecksMin) return repetir(`Os checks da PR #${estado.pr} de ${repo} ainda estão rodando (${minutos} min).`);
    return parar(m, 'humano', repo, `Os checks da PR #${estado.pr} de ${repo} ainda estão rodando depois de ${minutos} min. Responda quando quiser que o maestro volte a olhar.`);
  }
  if (leitura.codigo === 1) return checksVermelhos(m, repo, estado, leitura);
  if (leitura.codigo === 4) {
    if (!m.opcoes.exigirChecks) return concluirChecks(m, repo, estado, 'sem checks (maestro.exigirChecks está desligado)');
    const texto = [
      `A PR #${estado.pr} de ${repo} não registrou nenhum check.`,
      'Se o CI ignora PR em rascunho: mude convencoes.prRascunho para false em harness/config.json, tire esta PR de rascunho no GitHub e responda.',
      'Se este repositório não roda checks em PR: mude maestro.exigirChecks para false em harness/config.json e responda.',
    ];
    return parar(m, 'humano', repo, texto.join('\n'));
  }
  estado.errosDeLeitura = (estado.errosDeLeitura ?? 0) + 1;
  if (estado.errosDeLeitura <= MAXIMO_DE_ERROS_DE_LEITURA) return repetir(`Não consegui ler os checks da PR #${estado.pr} de ${repo}; tentando de novo.`);
  return parar(m, 'falha', repo, `Não consegui ler os checks da PR #${estado.pr} de ${repo}:\n${acoes.cauda(leitura.saida, 15)}\nResolva e responda.`);
}

// Um check externo (Sonar) pode se registrar depois que o CI terminou: o verde só vale se continuar
// verde, com o mesmo número de checks, depois de um intervalo.
function checksVerdes(m, repo, estado, leitura) {
  const total = Number(/VERDE — (\d+) checks/.exec(leitura.saida)?.[1] ?? 0);
  if (estado.verde?.total !== total) estado.verde = { total, quando: Date.now() };
  const falta = m.opcoes.confirmacaoDeVerdeSeg - segundosDesde(estado.verde.quando);
  if (falta > 0) return repetir(`Os checks da PR #${estado.pr} de ${repo} ficaram verdes; confirmando que nenhum check atrasado aparece (${falta} s).`);
  gravarNoPasso(m, `${repo}-checks.md`, leitura.saida || '(sem saída)');
  return concluirChecks(m, repo, estado, total === 1 ? '1 check verde' : `${total} checks verdes`);
}

function concluirChecks(m, repo, estado, comoFicou) {
  const pasta = pastaDoRepo(m.config, repo);
  if (acoes.prDaBranch(pasta, estado.pr)?.conflito) {
    return parar(m, 'humano', repo, `A PR #${estado.pr} de ${repo} tem conflito com a branch base. O maestro não faz merge nem rebase: resolva o conflito e responda.`);
  }
  if (estado.rascunho && estado.qa !== 'pendente') {
    if (acoes.marcarPronta(pasta, estado.pr).ok) estado.rascunho = false;
    else registrar(m, `${repo}: não consegui tirar a PR #${estado.pr} de rascunho`);
  }
  Object.assign(estado, { checks: comoFicou, fase: 'pronto' });
  registrar(m, `${repo}: PR #${estado.pr} — ${comoFicou}`);
  return null;
}

function checksVermelhos(m, repo, estado, leitura) {
  estado.voltasDeChecks += 1;
  const achados = gravarNoPasso(m, `${repo}-checks.md`, leitura.saida || '(sem saída)');
  if (estado.voltasDeChecks > m.opcoes.voltasDeChecks) {
    return parar(m, 'falha', repo, [`Os checks da PR #${estado.pr} de ${repo} reprovaram ${estado.voltasDeChecks} vezes. Último resumo:`, leitura.saida, 'Diga como seguir.'].join('\n\n'));
  }
  return pedirReparo(m, repo, { chave: `checks-${estado.voltasDeChecks}`, rotulo: 'correção dos checks da PR', achados, depois: 'publicar' });
}

// ---------------------------------------------------------------------------------- entrega

export function entregar(m, plano) {
  const repos = reposDoPlano(m, plano);
  const linhas = [`ENTREGA — ${plano.titulo}`, ''];
  for (const repo of repos) {
    const estado = m.livro.repos[repo];
    linhas.push(`PR de ${repo}: #${estado.pr} — ${estado.checks}, ${estado.rascunho ? 'em rascunho' : 'pronta para revisão'} — ${estado.url}`);
  }
  linhas.push('', 'Commits:', ...m.livro.feitas.map((feita) => `- ${feita.repo} ${feita.sha} ${feita.mensagem}`));
  if (plano.premissas) linhas.push('', 'Premissas do plano (confira):', plano.premissas);
  if (m.livro.decisoes.length > 0) linhas.push('', 'O que foi decidido no caminho:', ...emLista(m.livro.decisoes));
  const avisos = repos.flatMap((repo) => m.livro.repos[repo].avisos ?? []);
  if (avisos.length > 0) linhas.push('', 'Avisos da catraca (estão na descrição da PR):', ...emLista(avisos));
  const qaPendente = repos.some((repo) => m.livro.repos[repo].qa === 'pendente');
  linhas.push('', `Falta de você: ${qaPendente ? 'testar na tela (o QA ficou pendente) e tirar a PR de rascunho, ' : ''}revisar e fazer o merge.`);
  linhas.push(`Trilha da condução: ${relativo(join(m.pasta, 'passos'))}/`);
  const relatorio = linhas.join('\n');
  gravarPlano(m, definirStatus(textoDoPlano(m), 'em revisão'));
  atualizarEstado(m, 'revisão humana e merge');
  m.livro.encerrado = { quando: new Date().toISOString(), motivo: 'entregue', relatorio };
  registrar(m, 'entregue');
  return { tipo: 'FIM', texto: relatorio };
}
