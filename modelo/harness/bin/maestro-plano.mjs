// A primeira parte de uma entrega: escrever o plano, criticá-lo e aprová-lo. Ninguém é chamado
// para aprovar: o que o plano decidiu sozinho fica em "Premissas" e vai para a descrição da PR.

import { extrairDesvios } from './config.mjs';
import {
  anotarProblema, atualizarEstado, avisar, bi, bloquear, crase, decidir, despachar, emLista, encerrarConducao, esquecerPasso, gravarPlano, idiomas,
  mapaParaOPlano, pendenciasDosRepos, planoAtual, registrar, relativo, reposDoPlano, respeitarOQueEDoHumano, selarPlano, textoDoPlano,
} from './maestro-base.mjs';
import { achadosDoParecer, errosDoParecer } from './maestro-parecer.mjs';
import { definirStatus, inserirSecao, lerPlano, validarPlano } from './plano.mjs';

export function conduzirPlano(m) {
  const p = m.livro.planejamento;
  const { pedido, arquivoDoMapa } = m.livro.preparo;
  const mapa = arquivoDoMapa ? crase(arquivoDoMapa) : '(não há: ache os espelhos você mesmo, pela regra de padrão)';
  if (p.fase === 'plano') {
    return despachar(m, {
      chave: 'plano',
      tipo: 'plano',
      papel: 'planejar',
      titulo: 'Escrever o plano',
      limite: 1 + m.opcoes.tentativasPorPasso + m.opcoes.voltasDeRevisao,
      seEsgotar: semPlano,
      parametros: {
        Tarefa: crase(pedido),
        'Mapa do código': mapa,
        Plano: crase(relativo(m.caminhoDoPlano)),
        Motivo: p.base || m.livro.problemas.plano ? 'refazer o plano, corrigindo o que o parecer e o problema apontam' : 'plano novo',
        'Parecer a atender': p.base ? crase(p.base) : '(nenhum)',
        'Idioma das premissas': `${idiomas(m).pr} (elas vão para a descrição da PR)`,
      },
    });
  }
  if (p.fase === 'critica') {
    return despachar(m, {
      chave: `critica-${p.voltas + 1}`,
      tipo: 'critica',
      papel: 'criticar',
      titulo: 'Criticar o plano',
      seEsgotar: () => {
        avisar(m, 'O crítico do plano não devolveu um parecer válido; o plano seguiu com a validação de formato e de espelhos.');
        p.fase = 'aprovar';
        return null;
      },
      parametros: { Tarefa: crase(pedido), Plano: `${crase(relativo(m.caminhoDoPlano))} (o mapa do código está nele)` },
    });
  }
  return aprovarPlano(m);
}

// Sem plano válido não há o que conduzir: a condução termina dizendo por quê.
function semPlano(m, { resumo, detalhe }) {
  const linhas = ['NÃO ENTREGUE — não consegui escrever um plano válido para esta tarefa.', `${resumo.pt}.`];
  if (detalhe) linhas.push('', 'Último problema:', detalhe);
  linhas.push('', 'Nada foi alterado nos repositórios. Mande /entregar de novo com a tarefa mais detalhada (o que muda, onde, e os critérios de aceite).');
  return encerrarConducao(m, 'sem plano', linhas.join('\n'));
}

export function receberPlano(m, espera, resultado) {
  const p = m.livro.planejamento;
  if (resultado.resultado === 'bloqueado') {
    return bloquear(m, 'plano', ['O planejador não conseguiu planejar:', resultado.texto].join('\n\n'));
  }
  const texto = textoDoPlano(m);
  const erros = texto ? validarPlano(lerPlano(texto), m.config) : [`O plano não foi gravado em ${relativo(m.caminhoDoPlano)}.`];
  if (texto && extrairDesvios(texto).length > 0) {
    erros.push('A seção "Desvios aprovados" é só do humano: deixe vazia. O que você decidiu sozinho vai em "Premissas".');
  }
  if (erros.length > 0) {
    anotarProblema(m, 'plano', ['O plano tem erros de formato ou de fato. Corrija todos:', ...emLista(erros)].join('\n'));
    return null;
  }
  const plano = lerPlano(texto);
  const pendencias = pendenciasDosRepos(m, reposDoPlano(m, plano));
  if (pendencias.length > 0) {
    return bloquear(m, 'plano', ['O plano toca repositório que ainda não está pronto para o harness:', ...emLista(pendencias)].join('\n'));
  }
  // O mapa do reconhecimento entra no plano: é o que executores e revisores vão seguir.
  const mapa = mapaParaOPlano(m);
  const comMapa = mapa ? inserirSecao(texto, 'Mapa do código', mapa, 'Fatias') : texto;
  gravarPlano(m, definirStatus(comMapa, 'rascunho'));
  atualizarEstado(m, 'crítica do plano');
  esquecerPasso(m, 'plano');
  Object.assign(p, { base: null, fase: 'critica' });
  registrar(m, `plano escrito e validado (${plano.fatias.length} fatias)`);
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
    p.fase = 'aprovar';
    registrar(m, 'o crítico aprovou o plano');
    return null;
  }
  p.voltas += 1;
  if (p.voltas > m.opcoes.voltasDeRevisao) {
    avisar(m, `O crítico ainda apontava problemas no plano depois de ${p.voltas} rodadas, e o plano seguiu assim. Pontos em aberto: ${achadosDoParecer(resultado).join(' · ')}`);
    p.fase = 'aprovar';
    return null;
  }
  Object.assign(p, { base: espera.arquivo, fase: 'plano' });
  registrar(m, 'o crítico reprovou o plano: volta para o planejador');
  return null;
}

// O plano validado e criticado segue sozinho. Seções de versões antigas do modelo não param nada.
function aprovarPlano(m) {
  const plano = planoAtual(m);
  // Agora o maestro sabe em que repositórios vai trabalhar. O que é do humano neles bloqueia já,
  // de uma vez só e antes da primeira linha de código, e não no meio do caminho.
  const bloqueio = respeitarOQueEDoHumano(m, reposDoPlano(m, plano));
  if (bloqueio) return bloqueio;
  if (plano.duvidas || plano.desviosPendentes) {
    decidir(
      m,
      bi(
        'O plano trazia dúvidas ou desvios em aberto; a execução seguiu pela opção que o próprio plano recomenda em cada um.',
        'The plan had open questions or deviations; the work followed the option the plan itself recommends for each one.',
      ),
    );
  }
  gravarPlano(m, definirStatus(textoDoPlano(m), 'aprovado'));
  m.livro.planoAprovado = true;
  atualizarEstado(m, 'o maestro segue conduzindo');
  selarPlano(m);
  m.livro.planejamento.base = null;
  // Daqui em diante o mapa é o do plano: o arquivo de passo já pode ser podado.
  Object.assign(m.livro.preparo, { mapaNoPlano: Boolean(m.livro.preparo.arquivoDoMapa), arquivoDoMapa: null });
  esquecerPasso(m, 'critica');
  registrar(m, `plano aprovado: ${plano.fatias.length} fatias`);
  return null;
}
