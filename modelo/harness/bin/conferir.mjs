// A catraca: regras determinísticas sobre o diff de um repositório.
// Só o que foi ADICIONADO é julgado; o código que já existia não entra na conta.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { desviosAprovados, git, globParaRegex, pastaDoRepo } from './config.mjs';

const TAMANHO_MAXIMO_LIDO = 400 * 1024;
const LINHAS_DE_ESPACO_TOLERADAS = 10;
const LINHA_DE_COMENTARIO = /^\s*(\/\/|\/\*|\*\/|\*(\s|$)|\{\/\*)/;
const IMPORTACAO = /(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*|\bimport\s+)['"]([^'"]+)['"]/;
const SUFIXO_DE_TESTE = /\.(test|spec)$/;

export function conferirRepo(config, nome, { modo = 'fatia', escopo = [] } = {}) {
  const pasta = pastaDoRepo(config, nome);
  const repo = config.repos[nome];
  const referencia = modo === 'pr' ? baseDaPr(pasta, repo.base) : 'HEAD';
  const diff = coletarDiff(pasta, referencia);
  const achados = avaliar(diff, {
    config,
    modo,
    escopo,
    prefixo: `${repo.dir}/`,
    liberados: desviosAprovados(),
  });
  return { achados, arquivos: diff.arquivos.length };
}

export function formatarAchado(achado) {
  const rotulo = achado.liberado ? 'liberado' : achado.nivel === 'bloqueio' ? 'BLOQUEIO' : 'aviso';
  const linha = achado.linha ? `:${achado.linha}` : '';
  const onde = achado.arquivo ? `${achado.arquivo}${linha} — ` : '';
  return `[${rotulo}] ${onde}${achado.detalhe}`;
}

function baseDaPr(pasta, base) {
  for (const candidato of [`origin/${base}`, base]) {
    const r = git(pasta, ['merge-base', 'HEAD', candidato]);
    if (r.ok) return r.saida.trim();
  }
  throw new Error(
    `Não achei a branch base "${base}" em ${pasta}. Rode "git fetch origin" ou corrija repos.*.base em harness/config.json.`,
  );
}

function coletarDiff(pasta, referencia) {
  const existeReferencia = git(pasta, ['rev-parse', '--verify', '--quiet', `${referencia}^{commit}`]).ok;
  const rastreados = existeReferencia
    ? lerDiff(git(pasta, ['diff', referencia, '--unified=0', '--no-color', '--no-ext-diff', '-M']).saida)
    : [];
  const pastasExistentes = existeReferencia
    ? new Set(git(pasta, ['ls-tree', '-r', '-d', '--name-only', referencia]).saida.split('\n'))
    : new Set();
  const arquivos = [...rastreados, ...naoRastreados(pasta)].map((arquivo) => ({
    ...arquivo,
    pastaNova: arquivo.novo && pastaEhNova(pastasExistentes, dirname(arquivo.caminho)),
  }));
  return { arquivos, somenteEspaco: existeReferencia ? linhasSoDeEspaco(pasta, referencia) : 0 };
}

function pastaEhNova(pastasExistentes, pasta) {
  return pasta !== '.' && !pastasExistentes.has(pasta);
}

export function lerDiff(texto) {
  const arquivos = [];
  let atual = null;
  let noCabecalho = false;
  let linhaNova = 0;

  for (const linha of texto.split('\n')) {
    if (linha.startsWith('diff --git ')) {
      const igual = /^diff --git a\/(.+) b\/\1$/.exec(linha);
      atual = { caminho: igual ? igual[1] : null, novo: false, removido: false, adicionadas: [], removidas: 0 };
      arquivos.push(atual);
      noCabecalho = true;
    } else if (!atual) {
      continue;
    } else if (linha.startsWith('@@')) {
      noCabecalho = false;
      linhaNova = Number(/\+(\d+)/.exec(linha)?.[1] ?? 0);
    } else if (noCabecalho) {
      if (linha.startsWith('new file mode')) atual.novo = true;
      else if (linha.startsWith('deleted file mode')) atual.removido = true;
      else if (linha.startsWith('rename to ')) atual.caminho = linha.slice('rename to '.length);
      else if (linha.startsWith('+++ b/')) atual.caminho = linha.slice('+++ b/'.length);
    } else if (linha.startsWith('+')) {
      atual.adicionadas.push({ n: linhaNova++, texto: linha.slice(1) });
    } else if (linha.startsWith('-')) {
      atual.removidas++;
    }
  }
  return arquivos.filter((arquivo) => arquivo.caminho);
}

function naoRastreados(pasta) {
  const lista = git(pasta, ['ls-files', '--others', '--exclude-standard']).saida;
  return lista
    .split('\n')
    .filter(Boolean)
    .map((caminho) => ({
      caminho,
      novo: true,
      removido: false,
      removidas: 0,
      adicionadas: linhasDoArquivo(join(pasta, caminho)),
    }));
}

function linhasDoArquivo(caminho) {
  if (!existsSync(caminho) || statSync(caminho).size > TAMANHO_MAXIMO_LIDO) return [];
  const texto = readFileSync(caminho, 'utf8');
  if (texto.includes('\u0000')) return [];
  const linhas = texto.split('\n');
  if (linhas[linhas.length - 1] === '') linhas.pop();
  return linhas.map((conteudo, indice) => ({ n: indice + 1, texto: conteudo }));
}

// Linhas que só mudaram em espaço somem com "-w"; a diferença mostra reformatação sem mudança real.
function linhasSoDeEspaco(pasta, referencia) {
  const total = (extras) =>
    git(pasta, ['diff', referencia, '--numstat', ...extras])
      .saida.split('\n')
      .reduce((soma, linha) => {
        const [adicionadas, removidas] = linha.split('\t');
        return soma + (Number(adicionadas) || 0) + (Number(removidas) || 0);
      }, 0);
  return Math.max(0, total([]) - total(['-w']));
}

export function avaliar(diff, regras) {
  const ctx = compilar(regras);
  const achados = [
    ...diff.arquivos.flatMap((arquivo) => REGRAS_POR_ARQUIVO.flatMap((regra) => regra(arquivo, ctx))),
    ...REGRAS_DO_CONJUNTO.flatMap((regra) => regra(diff, ctx)),
  ];
  return achados.map((achado) => ({ ...achado, liberado: estaLiberado(achado, regras.liberados ?? []) }));
}

function compilar({ config, modo, prefixo, escopo = [] }) {
  const globs = (lista) => (lista ?? []).map((glob) => globParaRegex(glob));
  return {
    prefixo,
    escopo: escopo.map((caminho) => normalizarEscopo(caminho, prefixo)).filter(Boolean),
    extensoes: new Set(config.extensoesDeCodigo ?? []),
    proibido: (config.proibido ?? []).map((item) => ({ regex: new RegExp(item.padrao), motivo: item.motivo })),
    protegidos: globs(config.protegidos),
    camadas: config.camadas ?? [],
    pastasLivres: config.pastasLivres ?? [],
    teste: new RegExp(config.testes?.padrao ?? '\\.(test|spec)\\.[jt]sx?$'),
    exigirTeste: config.testes?.exigirParaArquivoNovo !== false,
    dispensadosDeTeste: globs(config.testes?.dispensados),
    foraDoOrcamento: globs(config.orcamento?.ignorar),
    limites: config.orcamento?.[modo] ?? {},
  };
}

function normalizarEscopo(caminho, prefixo) {
  const limpo = caminho.replace(/^\.\//, '').replace(/\/+$/, '');
  return limpo.startsWith(prefixo) ? limpo.slice(prefixo.length) : limpo;
}

const ehCodigo = (arquivo, ctx) => ctx.extensoes.has(extname(arquivo.caminho).slice(1));
const ehTeste = (arquivo, ctx) => ctx.teste.test(arquivo.caminho);
const casa = (regexes, caminho) => regexes.some((regex) => regex.test(caminho));

const bloqueio = (ctx, arquivo, detalhe, linha) => ({
  nivel: 'bloqueio',
  arquivo: ctx.prefixo + arquivo.caminho,
  linha,
  detalhe,
});
const aviso = (detalhe, arquivo) => ({ nivel: 'aviso', arquivo, detalhe });

function verificacaoDesligada(arquivo, ctx) {
  if (!ehCodigo(arquivo, ctx)) return [];
  return arquivo.adicionadas.flatMap(({ n, texto }) =>
    ctx.proibido.filter((item) => item.regex.test(texto)).map((item) => bloqueio(ctx, arquivo, item.motivo, n)),
  );
}

function arquivoProtegido(arquivo, ctx) {
  if (!casa(ctx.protegidos, arquivo.caminho)) return [];
  return [bloqueio(ctx, arquivo, 'arquivo protegido: só o humano altera (lei, item 7)')];
}

function camadaFurada(arquivo, ctx) {
  const completo = ctx.prefixo + arquivo.caminho;
  const regrasDaPasta = ctx.camadas.filter((camada) => completo.startsWith(camada.em));
  if (regrasDaPasta.length === 0) return [];
  return arquivo.adicionadas.flatMap(({ n, texto }) => {
    const importado = IMPORTACAO.exec(texto)?.[1];
    if (!importado) return [];
    return regrasDaPasta
      .filter((camada) => camada.naoImporta.some((trecho) => importado.includes(trecho)))
      .map((camada) =>
        bloqueio(ctx, arquivo, `importa "${importado}": ${camada.motivo ?? 'esta camada não pode conhecer isso'}`, n),
      );
  });
}

function foraDoEscopo(arquivo, ctx) {
  if (ctx.escopo.length === 0 || casa(ctx.protegidos, arquivo.caminho)) return [];
  const dentro = ctx.escopo.some((item) => arquivo.caminho === item || arquivo.caminho.startsWith(`${item}/`));
  return dentro ? [] : [bloqueio(ctx, arquivo, 'fora do escopo da fatia: desfaça ou declare o desvio')];
}

function orcamentoEstourado(diff, ctx) {
  const contam = diff.arquivos.filter((a) => !ehTeste(a, ctx) && !casa(ctx.foraDoOrcamento, a.caminho));
  const linhas = contam.reduce((soma, a) => soma + a.adicionadas.length + a.removidas, 0);
  const estouros = [];
  if (ctx.limites.arquivos && contam.length > ctx.limites.arquivos) {
    estouros.push(`${contam.length} arquivos (máximo ${ctx.limites.arquivos})`);
  }
  if (ctx.limites.linhas && linhas > ctx.limites.linhas) {
    estouros.push(`${linhas} linhas (máximo ${ctx.limites.linhas})`);
  }
  if (estouros.length === 0) return [];
  return [aviso(`diff grande para revisar: ${estouros.join(' e ')}, sem contar testes. Divida.`)];
}

function comentarioDemais(diff, ctx) {
  const limite = ctx.limites.comentarios;
  if (!limite) return [];
  const total = diff.arquivos
    .filter((a) => ehCodigo(a, ctx) && !ehTeste(a, ctx))
    .reduce((soma, a) => soma + a.adicionadas.filter(({ texto }) => LINHA_DE_COMENTARIO.test(texto)).length, 0);
  if (total <= limite) return [];
  return [aviso(`${total} linhas de comentário novas (máximo ${limite}): deixe só o porquê que o código não diz.`)];
}

function reformatacao(diff) {
  if (diff.somenteEspaco <= LINHAS_DE_ESPACO_TOLERADAS) return [];
  return [aviso(`${diff.somenteEspaco} linhas mudaram só em espaço/formatação: desfaça o que não é da tarefa.`)];
}

function pastasNovas(diff, ctx) {
  const pastas = new Set(
    diff.arquivos
      .filter((a) => a.pastaNova && !ctx.pastasLivres.some((livre) => (ctx.prefixo + a.caminho).startsWith(livre)))
      .map((a) => ctx.prefixo + dirname(a.caminho)),
  );
  return Array.from(pastas, (pasta) => aviso('pasta nova: confirme que a receita do padrão prevê (lei, item 3)', pasta));
}

function arquivoNovoSemTeste(diff, ctx) {
  if (!ctx.exigirTeste) return [];
  const nomeSemExtensao = (arquivo) => basename(arquivo.caminho, extname(arquivo.caminho));
  const testados = new Set(
    diff.arquivos.filter((a) => ehTeste(a, ctx)).map((a) => nomeSemExtensao(a).replace(SUFIXO_DE_TESTE, '')),
  );
  return diff.arquivos
    .filter((a) => a.novo && ehCodigo(a, ctx) && !ehTeste(a, ctx) && !casa(ctx.dispensadosDeTeste, a.caminho))
    .filter((a) => !testados.has(nomeSemExtensao(a)))
    .map((a) => aviso('arquivo novo sem teste novo: o Sonar cobra cobertura em código novo', ctx.prefixo + a.caminho));
}

const REGRAS_POR_ARQUIVO = [verificacaoDesligada, arquivoProtegido, camadaFurada, foraDoEscopo];
const REGRAS_DO_CONJUNTO = [orcamentoEstourado, comentarioDemais, reformatacao, pastasNovas, arquivoNovoSemTeste];

function estaLiberado(achado, liberados) {
  if (!achado.arquivo) return false;
  return liberados.some((caminho) => {
    const limpo = caminho.replace(/\/+$/, '');
    return achado.arquivo === limpo || achado.arquivo.startsWith(`${limpo}/`);
  });
}
