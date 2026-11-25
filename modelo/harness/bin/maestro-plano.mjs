// A primeira parte da condução: escrever o plano, criticá-lo, aprová-lo e, depois de uma decisão
// do humano no meio do caminho, ajustá-lo.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extrairDesvios, RAIZ } from './config.mjs';
import {
  anotarProblema, atualizarEstado, COMANDO, crase, crases, despachar, emLista, gravarNoPasso, gravarPlano, orientacao, parar, pendenciasDosRepos,
  planoAtual, registrar, relativo, selarPlano, textoDoPlano,
} from './maestro-base.mjs';
import { errosDoParecer } from './maestro-parecer.mjs';
import { definirStatus, errosDeAjuste, lerPlano, validarPlano } from './plano.mjs';

const PEDIDO_DE_APROVACAO = 'Responda "aprovado" para o maestro seguir, ou diga o que mudar no plano.';

export function conduzirPlano(m) {
  const p = m.livro.planejamento;
  if (!existsSync(m.caminhoDaTarefa) && !textoDoPlano(m)) {
    return parar(m, 'falha', 'plano', `Não achei nem a tarefa nem o plano em ${relativo(m.pasta)}. Largue esta condução (${crase(`${COMANDO} encerrar`)}) e comece de novo com /entregar <tarefa>.`);
  }
  if (p.fase === 'plano') {
    return despachar(m, {
      chave: 'plano',
      tipo: 'plano',
      papel: 'planejar',
      titulo: 'Escrever o plano',
      limite: 1 + m.opcoes.tentativasPorPasso + m.opcoes.voltasDeRevisao,
      parametros: {
        Tarefa: crase(relativo(m.caminhoDaTarefa)),
        Plano: crase(relativo(m.caminhoDoPlano)),
        Motivo: motivoDoPlano(m, p),
        'Parecer a atender': p.base ? crase(p.base) : '(nenhum)',
        'Resposta do humano': orientacao(m, 'plano'),
      },
    });
  }
  if (p.fase === 'critica') {
    return despachar(m, {
      chave: `critica-${p.voltas + 1}`,
      tipo: 'critica',
      papel: 'criticar',
      titulo: 'Criticar o plano',
      orientacao: 'plano',
      parametros: { Tarefa: crase(relativo(m.caminhoDaTarefa)), Plano: crase(relativo(m.caminhoDoPlano)) },
    });
  }
  return portaoDoPlano(m);
}

function motivoDoPlano(m, p) {
  if (m.livro.orientacoes.plano) return 'refazer o plano seguindo a resposta do humano';
  if (p.base || m.livro.problemas.plano) return 'refazer o plano, corrigindo o que o parecer e o problema apontam';
  return 'plano novo';
}

export function receberPlano(m, espera, resultado) {
  const p = m.livro.planejamento;
  if (resultado.resultado === 'bloqueado') {
    return parar(m, 'humano', 'plano', ['O planejador não conseguiu planejar:', resultado.texto, 'Resolva e responda.'].join('\n\n'));
  }
  const texto = textoDoPlano(m);
  const erros = texto ? validarPlano(lerPlano(texto), m.config) : [`O plano não foi gravado em ${relativo(m.caminhoDoPlano)}.`];
  if (texto && !m.livro.orientacoes.plano && extrairDesvios(texto).length > 0) {
    erros.push('A seção "Desvios aprovados" só recebe o que o humano aprovou. Mova o que está lá para "Desvios pendentes".');
  }
  if (erros.length > 0) {
    anotarProblema(m, 'plano', ['O plano tem erros de formato ou de fato. Corrija todos:', ...emLista(erros)].join('\n'));
    return null;
  }
  const pendencias = pendenciasDosRepos(m, lerPlano(texto));
  if (pendencias.length > 0) {
    return parar(m, 'humano', 'plano', ['O plano toca repositório que ainda não está pronto para o harness:', ...emLista(pendencias), 'Resolva e responda.'].join('\n'));
  }
  gravarPlano(m, definirStatus(texto, 'rascunho'));
  atualizarEstado(m, 'crítica do plano');
  delete m.livro.problemas.plano;
  Object.assign(p, { base: null, fase: 'critica' });
  registrar(m, 'plano escrito e validado');
  return null;
}

export function receberCritica(m, espera, resultado) {
  const p = m.livro.planejamento;
  const erros = errosDoParecer(m, resultado);
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['O arquivo de resultado está fora do formato:', ...emLista(erros)].join('\n'));
    return null;
  }
  if (resultado.veredito === 'APROVADO') {
    p.fase = 'portao';
    registrar(m, 'o crítico aprovou o plano');
    return null;
  }
  p.voltas += 1;
  if (p.voltas > m.opcoes.voltasDeRevisao) {
    const texto = [`O crítico reprovou o plano ${p.voltas} vezes. Último parecer:`, resultado.texto, PEDIDO_DE_APROVACAO];
    return parar(m, 'plano', 'plano', texto.join('\n\n'));
  }
  Object.assign(p, { base: espera.arquivo, fase: 'plano' });
  registrar(m, 'o crítico reprovou o plano: volta para o planejador');
  return null;
}

// Sem dúvida, sem desvio e dentro do tamanho, o plano segue sozinho. Qualquer pendência é do humano.
function portaoDoPlano(m) {
  const plano = planoAtual(m);
  const pendencias = [];
  if (plano.duvidas) pendencias.push(`Dúvidas do plano:\n${plano.duvidas}`);
  if (plano.desviosPendentes) pendencias.push(`Desvios pendentes:\n${plano.desviosPendentes}`);
  if (plano.fatias.length > m.opcoes.maximoDeFatias) {
    pendencias.push(`O plano tem ${plano.fatias.length} fatias. Acima de ${m.opcoes.maximoDeFatias}, o maestro pede o seu olhar antes de começar.`);
  }
  if (pendencias.length === 0 && m.opcoes.aprovarPlano !== 'sempre') {
    aprovarPlano(m, 'sem você: o validador e o crítico aprovaram, e não havia dúvida nem desvio');
    return null;
  }
  return parar(m, 'plano', 'plano', [resumoDoPlano(m, plano), ...pendencias, PEDIDO_DE_APROVACAO].join('\n\n'));
}

function resumoDoPlano(m, plano) {
  const linhas = [`PLANO — ${plano.titulo} (${relativo(m.caminhoDoPlano)})`, plano.objetivo, ...plano.fatias.map((fatia) => `- ${fatia.id} · ${fatia.repo} · ${fatia.nome}`)];
  if (plano.premissas) linhas.push(`Premissas:\n${plano.premissas}`);
  return linhas.join('\n');
}

export function aprovarPlano(m, como) {
  gravarPlano(m, definirStatus(textoDoPlano(m), 'aprovado'));
  atualizarEstado(m, 'o maestro segue conduzindo');
  m.livro.planoAprovado = true;
  selarPlano(m);
  m.livro.decisoes.push(`Plano aprovado ${como}.`);
  registrar(m, `plano aprovado ${como}`);
}

// Com o plano já em execução, só a resposta do humano a um PARE muda o plano, e por um planejador.
export function conduzirAjuste(m) {
  const ajuste = m.livro.ajuste;
  ajuste.planoAntes ??= gravarNoPasso(m, 'plano-antes-do-ajuste.md', textoDoPlano(m));
  return despachar(m, {
    chave: `ajuste-${ajuste.numero}`,
    tipo: 'ajuste',
    papel: 'planejar',
    titulo: 'Ajustar o plano à resposta do humano',
    orientacao: ajuste.passo,
    parametros: {
      Tarefa: existsSync(m.caminhoDaTarefa) ? crase(relativo(m.caminhoDaTarefa)) : '(sem arquivo: o plano já diz o que é a tarefa)',
      Plano: crase(relativo(m.caminhoDoPlano)),
      Motivo: 'ajustar o plano à resposta do humano (o plano já está em execução)',
      'Parecer a atender': ajuste.arquivo ? crase(ajuste.arquivo) : '(nenhum)',
      'Resposta do humano': ajuste.resposta,
    },
  });
}

export function receberAjuste(m, espera) {
  const ajuste = m.livro.ajuste;
  const texto = textoDoPlano(m);
  const antesTexto = readFileSync(join(RAIZ, ajuste.planoAntes), 'utf8');
  const antes = lerPlano(antesTexto);
  const depois = lerPlano(texto ?? '');
  const emCurso = m.livro.unidade?.depois.tipo === 'fatia' ? m.livro.unidade.depois.id : null;
  const erros = texto ? [...validarPlano(depois, m.config), ...errosDeAjuste(antes, depois, emCurso)] : ['O plano sumiu.'];
  if (erros.length > 0) {
    // A tentativa seguinte parte de novo do plano aprovado, não do que esta deixou.
    gravarPlano(m, antesTexto);
    anotarProblema(m, espera.chave, ['O plano ajustado pela tentativa anterior tinha erros, e o maestro devolveu o plano ao que era. Ao ajustar de novo, não repita:', ...emLista(erros)].join('\n'));
    return null;
  }
  const desviosNovos = extrairDesvios(texto).filter((caminho) => !extrairDesvios(antesTexto).includes(caminho));
  if (desviosNovos.length > 0) m.livro.decisoes.push(`Desvio registrado como aprovado depois da sua resposta: ${crases(desviosNovos)}.`);
  const fatiasNovas = depois.fatias.filter((fatia) => !antes.fatias.some((antiga) => antiga.id === fatia.id));
  if (fatiasNovas.length > 0) m.livro.decisoes.push(`Fatias acrescentadas ao plano depois da sua resposta: ${fatiasNovas.map((fatia) => fatia.id).join(', ')}.`);

  const unidade = m.livro.unidade;
  const fatia = depois.fatias.find((item) => item.id === emCurso);
  if (fatia) Object.assign(unidade, { escopo: fatia.escopo, espelhos: fatia.espelho });

  gravarPlano(m, definirStatus(texto, 'aprovado'));
  atualizarEstado(m, 'o maestro segue conduzindo');
  selarPlano(m);
  m.livro.ajuste = null;
  registrar(m, 'plano ajustado à resposta do humano');
  return null;
}
