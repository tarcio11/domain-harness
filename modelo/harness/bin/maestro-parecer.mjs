// O parecer de um revisor ou de um crítico só vale se for coerente: veredito, contagem e achados
// têm que concordar, e uma aprovação mostra com que espelho cada arquivo novo foi comparado.

import { existeNoCommit } from './acoes.mjs';
import { desviosAprovados, pastaDoRepo } from './config.mjs';
import { crase, dirDoRepo } from './maestro-base.mjs';

const LINHA_DE_ACHADO = /^\s*\d+[.)]\s+\S/;
const LINHA_DE_COMPARACAO = /^\s*[-*]\s*`?([^\s`]+)`?\s*(?:↔|<-+>|<=+>|-+>|→|=+>)\s*`?([^\s`]+)`?/;

// Devolve os erros de formato do parecer. "comparar" só vem na revisão de código: aí um APROVADO
// precisa de uma linha de comparação para cada arquivo novo.
export function errosDoParecer(m, resultado, comparar = null) {
  const { veredito } = resultado;
  if (veredito !== 'APROVADO' && veredito !== 'REPROVADO') return ['A primeira linha tem que ser "VEREDITO: APROVADO" ou "VEREDITO: REPROVADO".'];
  const erros = [];
  const declarados = Number.parseInt(resultado.campo('ACHADOS') ?? '', 10);
  const listados = resultado.texto.split('\n').filter((linha) => LINHA_DE_ACHADO.test(linha)).length;
  if (Number.isNaN(declarados)) erros.push('Falta a linha "ACHADOS: <número>" logo abaixo do veredito.');
  if (veredito === 'APROVADO' && (declarados > 0 || listados > 0)) {
    erros.push('"VEREDITO: APROVADO" só vale com "ACHADOS: 0" e nenhum achado numerado. Se há achado, o veredito é REPROVADO.');
  }
  if (veredito === 'REPROVADO' && listados === 0) {
    erros.push('"VEREDITO: REPROVADO" precisa de pelo menos um achado numerado: "1. arquivo:linha — problema — prova — correção".');
  }
  if (veredito === 'APROVADO' && comparar) erros.push(...errosDeComparacao(m, resultado.texto, comparar));
  return erros;
}

function errosDeComparacao(m, texto, { repo, referencia, novos }) {
  const dir = dirDoRepo(m, repo);
  const pasta = pastaDoRepo(m.config, repo);
  const limpar = (caminho) => {
    const semPonto = caminho.replace(/^\.\//, '');
    return semPonto.startsWith(`${dir}/`) ? semPonto.slice(dir.length + 1) : semPonto;
  };
  const pares = texto
    .split('\n')
    .map((linha) => LINHA_DE_COMPARACAO.exec(linha))
    .filter(Boolean)
    .map((achado) => [limpar(achado[1]), limpar(achado[2])]);
  const liberados = desviosAprovados().map((caminho) => caminho.replace(/\/+$/, ''));
  const liberado = (arquivo) => liberados.some((caminho) => `${dir}/${arquivo}` === caminho || `${dir}/${arquivo}`.startsWith(`${caminho}/`));
  const erros = [];
  for (const novo of novos.filter((arquivo) => !liberado(arquivo))) {
    const espelho = pares.find((par) => par[0] === novo)?.[1];
    if (!espelho) {
      erros.push(`Falta em COMPARAÇÃO a linha do arquivo novo ${crase(novo)}: "- ${novo} ↔ <espelho com que você comparou>". Se não existe espelho, isso é um achado e o veredito é REPROVADO.`);
    } else if (espelho === novo || !existeNoCommit(pasta, referencia, espelho)) {
      erros.push(`O espelho citado para ${crase(novo)} (${crase(espelho)}) não existia antes deste trabalho. Espelho é arquivo que já estava no repositório.`);
    }
  }
  return erros;
}
