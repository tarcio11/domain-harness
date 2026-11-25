// Lê, valida e atualiza o plano de uma tarefa (harness/tarefas/<id>/plano.md).
// O plano é o estado: o maestro anda pelo que está escrito aqui e no git, não pela memória do modelo.

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ehBranchProtegida, git, globParaRegex, nomesDosRepos, pastaDoRepo } from './config.mjs';

const CABECALHO_DE_FATIA = /^- \[( |x)\] \*\*(F\d+) · ([\w-]+) · (.+?)\*\*\s*$/;
const FORMATO_DE_FATIA = '- [ ] **F1 · backend · nome da fatia**';
const INICIO_DE_FATIA = /^- \[/;
const CAMPO_DE_FATIA = /^\s+[-*] \**(Escopo|Espelho|Entrega|Prova)\**:\**\s*(.*)$/;
const CAMPOS_DE_FATIA = ['Escopo', 'Espelho', 'Entrega', 'Prova'];
const CRITERIO = /^- \[[ x]\] (CA\d+)\b\s*(.*)$/;
const FORMATO_DE_CRITERIO = '- [ ] CA1 — dado …, quando …, então …';
const ITEM_DE_LISTA = /^[-*] /;
const SEM_CONTEUDO = /^(—|-|nenhum|nenhuma|n\/a)?\.?$/i;
const SO_MARCADOR = /^<[^>]*>$/s;
const NOME_DE_BRANCH = /^[\w./-]+$/;
// O maestro reescreve estas partes a partir do livro; o resto do plano não muda depois de aprovado.
const SECOES_DO_MAESTRO = ['Estado', 'Decisões no caminho', 'Pendências', 'Decisões do humano'];

export function lerPlano(texto) {
  const secoes = separarSecoes(texto);
  const itensDeCriterio = (secoes['Critérios de aceite'] ?? '').split('\n').filter((linha) => ITEM_DE_LISTA.test(linha));
  const itensDeFatia = (secoes['Fatias'] ?? '').split('\n').filter((linha) => INICIO_DE_FATIA.test(linha));
  return {
    titulo: /^# (.+)$/m.exec(texto)?.[1].trim() ?? '',
    status: /^Status:\s*(.+)$/m.exec(texto)?.[1].trim().toLowerCase() ?? '',
    branch: /^Branch:\s*`([^`]+)`/m.exec(texto)?.[1].trim() ?? '',
    objetivo: conteudo(secoes['Objetivo']),
    criterios: itensDeCriterio.map((linha) => CRITERIO.exec(linha)).filter(Boolean).map((achado) => ({ id: achado[1], texto: achado[2] })),
    criteriosForaDoFormato: itensDeCriterio.filter((linha) => !CRITERIO.test(linha)),
    contrato: conteudo(secoes['Contrato']),
    fatias: lerFatias(secoes['Fatias'] ?? ''),
    fatiasForaDoFormato: itensDeFatia.filter((linha) => !CABECALHO_DE_FATIA.test(linha)),
    premissas: conteudo(secoes['Premissas']),
    duvidas: conteudo(secoes['Dúvidas']),
    desviosPendentes: conteudo(secoes['Desvios pendentes']),
  };
}

function separarSecoes(texto) {
  const secoes = {};
  let atual = null;
  for (const linha of texto.split('\n')) {
    const titulo = /^## +(.+?)\s*$/.exec(linha);
    if (titulo) {
      atual = titulo[1];
      secoes[atual] = '';
    } else if (atual) {
      secoes[atual] += `${linha}\n`;
    }
  }
  return secoes;
}

// Seção só com comentário, travessão ou o marcador do modelo (<...>) conta como vazia.
function conteudo(secao = '') {
  const limpo = secao.replace(/<!--[\s\S]*?-->/g, '').trim();
  return SEM_CONTEUDO.test(limpo) || SO_MARCADOR.test(limpo) ? '' : limpo;
}

const caminhosEntreCrases = (texto) => Array.from(texto.matchAll(/`([^`]+)`/g), (achado) => achado[1].trim());

function lerFatias(secao) {
  const fatias = [];
  let atual = null;
  for (const linha of secao.split('\n')) {
    const cabecalho = CABECALHO_DE_FATIA.exec(linha);
    const campo = CAMPO_DE_FATIA.exec(linha);
    if (cabecalho) {
      atual = { feita: cabecalho[1] === 'x', id: cabecalho[2], repo: cabecalho[3], nome: cabecalho[4], campos: {} };
      fatias.push(atual);
    } else if (INICIO_DE_FATIA.test(linha)) {
      // Cabeçalho fora do formato: os campos que vêm abaixo não são da fatia anterior.
      atual = null;
    } else if (campo && atual) {
      atual.campos[campo[1]] = campo[2].trim();
    }
  }
  return fatias.map((fatia) => ({
    ...fatia,
    escopo: caminhosEntreCrases(fatia.campos.Escopo ?? ''),
    espelho: caminhosEntreCrases(fatia.campos.Espelho ?? ''),
  }));
}

// Devolve a lista de erros de formato e de fato (espelho que não existe, escopo em arquivo
// protegido...). Lista vazia: o plano serve para o maestro conduzir.
export function validarPlano(plano, config) {
  const erros = [];
  if (!plano.titulo) erros.push('Falta o título na primeira linha: "# <ID> — <título curto>".');
  if (!plano.status) erros.push('Falta a linha "Status: rascunho".');
  if (!plano.branch) erros.push('Falta a linha "Branch: `nome-da-branch`", com o nome entre crases.');
  else if (!NOME_DE_BRANCH.test(plano.branch)) erros.push(`Nome de branch inválido: "${plano.branch}".`);
  else if (ehBranchProtegida(config, plano.branch)) erros.push(`A branch "${plano.branch}" é protegida: a tarefa precisa de branch própria.`);
  if (!plano.objetivo) erros.push('A seção "Objetivo" está vazia.');
  erros.push(...errosDeCriterios(plano));
  for (const linha of plano.fatiasForaDoFormato) {
    erros.push(`Linha de fatia fora do formato: "${linha.trim()}". O formato é exatamente: ${FORMATO_DE_FATIA}`);
  }
  if (plano.fatias.length === 0) {
    erros.push(`A seção "Fatias" não tem nenhuma fatia no formato: ${FORMATO_DE_FATIA}`);
    return erros;
  }
  plano.fatias.forEach((fatia, indice) => erros.push(...errosDaFatia(fatia, indice, config)));
  erros.push(...errosDeOrdem(plano.fatias, config));
  const repos = new Set(plano.fatias.map((fatia) => fatia.repo));
  if (repos.size > 1 && !plano.contrato) erros.push('A tarefa toca mais de um repositório: a seção "Contrato" não pode ficar vazia.');
  return erros;
}

function errosDeCriterios(plano) {
  const erros = plano.criteriosForaDoFormato.map((linha) => `Critério fora do formato: "${linha.trim()}". Use: ${FORMATO_DE_CRITERIO}`);
  if (plano.criterios.length === 0) erros.push(`A seção "Critérios de aceite" precisa de pelo menos um item: ${FORMATO_DE_CRITERIO}`);
  const ids = plano.criterios.map((criterio) => criterio.id);
  const repetidos = ids.filter((id, indice) => ids.indexOf(id) !== indice);
  if (repetidos.length > 0) erros.push(`Critérios com o mesmo código: ${Array.from(new Set(repetidos)).join(', ')}.`);
  return erros;
}

function errosDaFatia(fatia, indice, config) {
  const erros = [];
  const esperado = `F${indice + 1}`;
  if (fatia.id !== esperado) erros.push(`A ${indice + 1}ª fatia deveria se chamar ${esperado}, não ${fatia.id}: numere em sequência, sem pular.`);
  if (!config.repos?.[fatia.repo]) {
    erros.push(`${fatia.id}: repositório "${fatia.repo}" não existe. Use: ${nomesDosRepos(config).join(' ou ')}.`);
    return erros;
  }
  for (const campo of CAMPOS_DE_FATIA) {
    if (!fatia.campos[campo]) erros.push(`${fatia.id}: falta o campo "${campo}" (linha "  - ${campo}: …" logo abaixo da fatia).`);
  }
  if (fatia.campos.Escopo && fatia.escopo.length === 0) erros.push(`${fatia.id}: o Escopo precisa de caminhos entre crases.`);
  if (fatia.campos.Espelho && fatia.espelho.length === 0) erros.push(`${fatia.id}: o Espelho precisa de caminhos de arquivo entre crases.`);

  const pasta = pastaDoRepo(config, fatia.repo);
  const protegidos = (config.protegidos ?? []).map((glob) => globParaRegex(glob));
  for (const caminho of fatia.escopo) {
    if (caminhoForaDoRepo(caminho)) erros.push(`${fatia.id}: Escopo "${caminho}" tem que ser relativo à pasta do repositório.`);
    else if (protegidos.some((regex) => regex.test(caminho.replace(/\/+$/, '')))) {
      erros.push(`${fatia.id}: Escopo "${caminho}" é arquivo protegido: só o humano altera. Tire do Escopo e planeje sem mexer nele; o que a tarefa perde com isso vai em "Premissas".`);
    }
  }
  for (const caminho of fatia.espelho) {
    if (caminhoForaDoRepo(caminho)) erros.push(`${fatia.id}: Espelho "${caminho}" tem que ser relativo à pasta do repositório.`);
    else if (!ehArquivoDoRepositorio(pasta, caminho)) {
      erros.push(`${fatia.id}: o Espelho "${caminho}" não existe em ${config.repos[fatia.repo].dir}/. Espelho é arquivo que já existe e já está no git.`);
    }
  }
  return erros;
}

const caminhoForaDoRepo = (caminho) => caminho.startsWith('/') || caminho.split('/').includes('..');

function ehArquivoDoRepositorio(pasta, caminho) {
  const completo = join(pasta, caminho);
  if (!existsSync(completo) || !statSync(completo).isFile()) return false;
  return git(pasta, ['ls-files', '--error-unmatch', '--', caminho]).ok;
}

// As fatias de um repositório ficam juntas, e os repositórios seguem a ordem do config (backend antes).
function errosDeOrdem(fatias, config) {
  const blocos = fatias.map((fatia) => fatia.repo).filter((repo, indice, lista) => repo !== lista[indice - 1]);
  if (new Set(blocos).size !== blocos.length) return ['Agrupe as fatias por repositório: todas as de um, depois todas as do outro.'];
  const ordem = nomesDosRepos(config);
  const posicoes = blocos.map((repo) => ordem.indexOf(repo)).filter((posicao) => posicao >= 0);
  const fora = posicoes.some((posicao, indice) => indice > 0 && posicao < posicoes[indice - 1]);
  return fora ? [`Ordem dos repositórios: ${ordem.join(' antes de ')}.`] : [];
}

export function marcarFatia(texto, id, feita) {
  const de = feita ? ' ' : 'x';
  const para = feita ? 'x' : ' ';
  return texto.replace(new RegExp(`^- \\[${de}\\] (\\*\\*${id} · )`, 'm'), `- [${para}] $1`);
}

export function definirStatus(texto, status) {
  return /^Status:.*$/m.test(texto) ? texto.replace(/^Status:.*$/m, `Status: ${status}`) : texto;
}

// Troca o corpo de uma seção "## Nome". Se a seção não existe, ela entra no fim do arquivo.
export function escreverSecao(texto, nome, corpo) {
  const linhas = texto.split('\n');
  const inicio = linhas.findIndex((linha) => linha.trim() === `## ${nome}`);
  if (inicio < 0) return `${texto.trimEnd()}\n\n## ${nome}\n\n${corpo.trim()}\n`;
  const proxima = linhas.findIndex((linha, indice) => indice > inicio && /^## /.test(linha));
  const depois = proxima < 0 ? [] : ['', ...linhas.slice(proxima)];
  return `${[...linhas.slice(0, inicio + 1), '', corpo.trim(), ...depois].join('\n').trimEnd()}\n`;
}

// Como escreverSecao, mas uma seção que ainda não existe entra antes da seção "antesDe".
export function inserirSecao(texto, nome, corpo, antesDe) {
  const linhas = texto.split('\n');
  const existe = linhas.some((linha) => linha.trim() === `## ${nome}`);
  const posicao = linhas.findIndex((linha) => linha.trim() === `## ${antesDe}`);
  if (existe || posicao < 0) return escreverSecao(texto, nome, corpo);
  return [...linhas.slice(0, posicao), `## ${nome}`, '', corpo.trim(), '', ...linhas.slice(posicao)].join('\n');
}

function removerSecao(texto, nome) {
  const linhas = texto.split('\n');
  const inicio = linhas.findIndex((linha) => linha.trim() === `## ${nome}`);
  if (inicio < 0) return texto;
  const proxima = linhas.findIndex((linha, indice) => indice > inicio && /^## /.test(linha));
  return [...linhas.slice(0, inicio), ...(proxima < 0 ? [] : linhas.slice(proxima))].join('\n');
}

// A impressão digital do que o plano manda fazer. Ignora o que o maestro reescreve sozinho:
// o Status, as marcas [x] e as seções dele.
export function seloDoPlano(texto) {
  const semSecoesDoMaestro = SECOES_DO_MAESTRO.reduce(removerSecao, texto);
  const essencial = semSecoesDoMaestro
    .replace(/^Status:.*$/m, '')
    .replace(/^- \[x\] /gm, '- [ ] ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return createHash('sha1').update(essencial).digest('hex');
}
