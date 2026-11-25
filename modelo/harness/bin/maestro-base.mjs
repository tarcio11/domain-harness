// O chão comum da condução: o contexto de uma chamada do maestro, os pedidos aos subagentes, o
// registro de decisões e pendências, o bloqueio (a única parada), os serviços demorados e os selos.
//
// A regra da casa: o maestro não pergunta. O que um modelo decide, ele decide e registra (decisão).
// O que não fecha, fica escrito e a condução segue com o resto (pendência). Só para o que nenhum
// modelo resolve: ambiente, instalação ou trabalho do humano que estava sem commit (bloqueio).

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import * as acoes from './acoes.mjs';
import { branchAtual, ehRepoGit, git, lerConfig, nomesDosRepos, pastaDoRepo, RAIZ } from './config.mjs';
import { formatarAchado } from './conferir.mjs';
import { gravarLivro, lerLivro, PASTA_DA_CONDUCAO, PASTA_DE_TRABALHO, PASTA_DOS_DESCARTES, pastaDaTarefa, podarTrabalho } from './livro.mjs';
import { escreverSecao, lerPlano, marcarFatia, seloDoPlano } from './plano.mjs';
import { hashDaArvore } from './recibo.mjs';

const PADRAO = {
  tentativasPorPasso: 2,
  voltasDeRevisao: 2,
  voltasDeChecks: 3,
  ciclosDeQa: 2,
  qa: 'auto',
  linhasPorLote: 400,
  arquivosPorLote: 8,
  maximoDeLotes: 20,
  esperaPorChamadaSeg: 25,
  esperaDeChecksMin: 45,
  confirmacaoDeVerdeSeg: 30,
  maximoDeDespachos: 400,
  guardarPassos: false,
  subagentes: { padrao: 'maestro-passo' },
};
export const COMANDO = 'node harness/bin/maestro.mjs';
const PASTA_DE_ROTEIROS = join(RAIZ, 'harness', 'roteiros');
// O papel de cada subagente e o roteiro que ele recebe dentro do pedido.
const ROTEIROS = {
  planejar: 'maestro/planejar.md',
  criticar: 'maestro/criticar-plano.md',
  executar: 'maestro/executar.md',
  revisar: 'revisor.md',
  revisarPr: 'maestro/revisar-pr.md',
  mapear: 'maestro/mapear.md',
  reconhecer: 'maestro/reconhecer.md',
  qa: 'maestro/qa.md',
  descrever: 'maestro/descrever-pr.md',
};
const MAXIMO_DE_SERVICOS_REFEITOS = 2;
const LINHAS_DE_DETALHE = 12;
const NOME_DO_IDIOMA = { en: 'inglês', pt: 'português', es: 'espanhol' };
const REGRAS_DE_TODO_PEDIDO = [
  'Regras que valem para qualquer pedido:',
  '- Nunca rode `git commit`, `git push`, troca de branch, `git stash`, `git reset` nem `gh pr`: branch, commit, push e PR são do maestro.',
  '- Nunca rode `node harness/bin/maestro.mjs` com `iniciar`, `revisar`, `proximo`, `retomar` ou `encerrar`.',
  '- Em `harness/`, grave só os arquivos que este pedido manda gravar.',
  '- Não faça perguntas e não espere resposta: ninguém vai responder. Na dúvida, decida pela regra da lei (`AGENTS.md`, seção 2) e registre a decisão do jeito que o roteiro manda.',
];

// ---------------------------------------------------------------------------------- contexto

// Erro de quem chamou (falta a tarefa, não achei a branch): vira mensagem, não rastro de pilha.
export class ErroDeUso extends Error {}

export const relativo = (caminho) => relative(RAIZ, caminho).split(sep).join('/');
export const crase = (texto) => `\`${texto}\``;
export const crases = (itens) => itens.map(crase).join(', ');
export const emLista = (itens) => itens.map((item) => `- ${item}`);
export const resumo = (texto) => createHash('sha1').update(texto).digest('hex');
export const regraDePadrao = (repo) => `.cursor/rules/padrao-${repo}.mdc`;
export const semRepetir = (itens) => Array.from(new Set(itens));
export const naConducao = (nome) => join(PASTA_DA_CONDUCAO, nome);
// Onde fica, em patch, o que o maestro tirou de um repositório: por tarefa, fora da pasta da condução,
// para a condução seguinte não levar embora.
const noDescarte = (m, nome) => join(PASTA_DOS_DESCARTES, m.livro.tarefa, nome);

// O mapeador edita harness/config.json. Se ele deixar o arquivo inválido, volta a cópia tirada
// antes do pedido, e o problema vai para a próxima tentativa dele.
export const COPIA_DA_CONFIG = naConducao('config.antes-de-mapear.json');

function lerConfigDaConducao(livro) {
  try {
    return lerConfig();
  } catch (erro) {
    if (livro.aguardando?.tipo !== 'mapear' || !existsSync(COPIA_DA_CONFIG)) throw erro;
    copyFileSync(COPIA_DA_CONFIG, join(RAIZ, 'harness', 'config.json'));
    livro.configInvalida = erro.message;
    return lerConfig();
  }
}

export function abrirConducao() {
  const livro = lerLivro();
  if (!livro) return null;
  const config = lerConfigDaConducao(livro);
  return {
    id: livro.tarefa,
    livro,
    config,
    opcoes: { ...PADRAO, ...config.maestro, subagentes: { ...PADRAO.subagentes, ...config.maestro?.subagentes } },
    caminhoDoPlano: livro.tipo === 'entrega' ? join(pastaDaTarefa(livro.tarefa), 'plano.md') : null,
    prazo: Date.now(),
    semResultado: false,
  };
}

export const ehRevisao = (m) => m.livro.tipo === 'revisao';
export const textoDoPlano = (m) => (m.caminhoDoPlano && existsSync(m.caminhoDoPlano) ? readFileSync(m.caminhoDoPlano, 'utf8') : null);
export const planoAtual = (m) => lerPlano(textoDoPlano(m) ?? '');
export const dirDoRepo = (m, repo) => m.config.repos[repo].dir;
export const rotuloDoRepo = (m, repo) => `${repo} (pasta ${crase(dirDoRepo(m, repo))})`;
export const reposDoPlano = (m, plano) => nomesDosRepos(m.config).filter((repo) => plano.fatias.some((fatia) => fatia.repo === repo));
export const ehCodigo = (m, caminho) => (m.config.extensoesDeCodigo ?? []).includes(extname(caminho).slice(1));
export const bloqueiosDe = (diff) => diff.achados.filter((achado) => achado.nivel === 'bloqueio' && !achado.liberado).map(formatarAchado);
export const avisosDe = (diff) => diff.achados.filter((achado) => achado.nivel === 'aviso').map(formatarAchado);

export function gravarPlano(m, texto) {
  mkdirSync(dirname(m.caminhoDoPlano), { recursive: true });
  writeFileSync(m.caminhoDoPlano, texto);
}

// O que a condução entrega. Numa entrega vem do plano; numa revisão, da branch que o humano apontou.
export function alvoDaConducao(m) {
  if (ehRevisao(m)) {
    const { branch, repos } = m.livro.revisao;
    return { titulo: `Revisão da branch ${branch}`, branch, repos, fatias: [], criterios: [], premissas: '' };
  }
  const plano = planoAtual(m);
  return { ...plano, repos: reposDoPlano(m, plano) };
}

// Commit e título de PR seguem convencoes.idioma; a descrição da PR pode ter o seu (idiomaDaPr).
export function idiomas(m) {
  const base = String(m.config.convencoes?.idioma || 'en').toLowerCase();
  const daPr = String(m.config.convencoes?.idiomaDaPr || base).toLowerCase();
  const nome = (codigo) => NOME_DO_IDIOMA[codigo.slice(0, 2)] ?? codigo;
  return { commit: nome(base), pr: nome(daPr), rotulos: daPr.startsWith('pt') ? 'pt' : 'en' };
}

// O que o maestro sabe de cada repositório da condução: em que fase está, a PR, os contadores.
export function estadoDoRepo(m, repo) {
  m.livro.repos[repo] ??= { fase: ehRevisao(m) ? 'revisao' : 'fatias', entrou: false, qa: null, ciclosDeQa: 0, voltasDePublicacao: 0, voltasDeChecks: 0 };
  return m.livro.repos[repo];
}

export function baseDoRepo(m, repo) {
  const pasta = pastaDoRepo(m.config, repo);
  const { base } = m.config.repos[repo];
  const comum = [`origin/${base}`, base].map((candidata) => git(pasta, ['merge-base', 'HEAD', candidata])).find((r) => r.ok);
  if (!comum) throw new Error(`Não achei a branch base "${base}" em ${dirDoRepo(m, repo)}/. Rode "git fetch origin" ou corrija repos.${repo}.base em harness/config.json.`);
  return comum.saida.trim();
}

export function registrar(m, linha) {
  m.livro.diario.push({ quando: new Date().toISOString(), linha });
  if (m.livro.diario.length > 300) m.livro.diario.shift();
}

// ------------------------------------------------------------------- decisões e pendências
// Decisão: o que um modelo ou o maestro resolveu sozinho; vai para a descrição da PR, para o humano
// conferir depois. Pendência: o que não fechou; a PR fica em rascunho e a lista diz o que falta.

// O que o script escreve e vai para a PR existe nas duas línguas: a conversa com o humano é em
// português, e a PR sai no idioma do repositório. O que um modelo escreveu vale como veio.
export const bi = (pt, en) => ({ pt, en });
const umaLinha = (texto) => String(texto).replace(/\s+/g, ' ').trim();

function anotar(lista, { texto, detalhe = null, repo = null }) {
  const item = typeof texto === 'string' ? bi(umaLinha(texto), umaLinha(texto)) : bi(umaLinha(texto.pt), umaLinha(texto.en));
  if (item.pt === '' || lista.some((outro) => outro.pt === item.pt && outro.repo === repo)) return null;
  lista.push({ repo, ...item, detalhe: detalhe ? acoes.cauda(detalhe, LINHAS_DE_DETALHE) : null });
  return item.pt;
}

export function decidir(m, texto, repo = null) {
  const linha = anotar(m.livro.decisoes, { texto, repo });
  if (linha) registrar(m, `decisão: ${linha}`);
}

export function pendencia(m, texto, { repo = null, detalhe = null } = {}) {
  const linha = anotar(m.livro.pendencias, { texto, detalhe, repo });
  if (linha) registrar(m, `pendência: ${linha}`);
}

// Aviso: o que aconteceu na condução e o humano precisa saber, mas não é assunto da PR.
export function avisar(m, texto) {
  const linha = String(texto).replace(/\s+/g, ' ').trim();
  m.livro.avisos ??= [];
  if (!m.livro.avisos.includes(linha)) m.livro.avisos.push(linha);
  registrar(m, `aviso: ${linha}`);
}

// As do repositório e as que valem para a condução inteira.
export const doRepo = (lista, repo) => lista.filter((item) => item.repo === null || item.repo === repo);
export const temPendencia = (m, repo) => doRepo(m.livro.pendencias, repo).length > 0;

// ------------------------------------------------------------------------- arquivos de passo

// Cada arquivo de passo ganha um número de ordem. Eles vivem em harness/trabalho/ só enquanto
// algum passo ainda precisa deles.
function caminhoDoPasso(m, nome) {
  m.livro.sequencia += 1;
  mkdirSync(PASTA_DE_TRABALHO, { recursive: true });
  return join(PASTA_DE_TRABALHO, `${String(m.livro.sequencia).padStart(2, '0')}-${nome}`);
}

export function gravarNoPasso(m, nome, texto) {
  const caminho = caminhoDoPasso(m, nome);
  writeFileSync(caminho, `${texto.trim()}\n`);
  return relativo(caminho);
}

export const reservarNoPasso = (m, nome) => relativo(caminhoDoPasso(m, nome));

export function podar(m) {
  if (!m.opcoes.guardarPassos) podarTrabalho(m.livro);
}

// O problema vai para um arquivo, e a próxima tentativa do mesmo passo recebe o caminho dele.
export function anotarProblema(m, chave, texto) {
  m.livro.problemas[chave] = gravarNoPasso(m, `${chave}-problema.md`, texto);
}

function ultimoProblema(m, chave) {
  const arquivo = m.livro.problemas[chave];
  return arquivo && existsSync(join(RAIZ, arquivo)) ? readFileSync(join(RAIZ, arquivo), 'utf8').trim() : null;
}

export function lerResultado(caminhoRelativo) {
  const caminho = join(RAIZ, caminhoRelativo);
  if (!existsSync(caminho)) return { existe: false };
  const texto = readFileSync(caminho, 'utf8').trim();
  // Tolera enfeite de markdown em volta do rótulo: "**RESULTADO:** ok", "# VEREDITO: APROVADO".
  const campo = (nome) => new RegExp(`^[\\s#>*_\`-]*${nome}[*_\`]*\\s*:[*_\`\\s]*(.+?)[*_\`\\s]*$`, 'mi').exec(texto)?.[1] ?? null;
  // Rótulo que pode aparecer em várias linhas (DECISÃO, PENDÊNCIA...): devolve o texto de cada uma, inteiro.
  const linhas = (nome) => Array.from(texto.matchAll(new RegExp(`^[\\s#>*_-]*(?:${nome})[*_]*\\s*:[*_\\s]*(.+)$`, 'gmi')), (achado) => achado[1].trim());
  const palavra = (valor) => /[A-Za-zÀ-ú]+/.exec(valor ?? '')?.[0] ?? null;
  return {
    existe: true,
    texto,
    campo,
    linhas,
    resultado: palavra(campo('RESULTADO'))?.toLowerCase() ?? null,
    veredito: palavra(campo('VEREDITO'))?.toUpperCase() ?? null,
    commit: campo('COMMIT'),
    titulo: campo('TITULO') ?? campo('TÍTULO'),
  };
}

// ------------------------------------------------------------------------- o mapa do código

// O mapa entra no plano como uma seção: um arquivo só para o humano ler e para os agentes seguirem.
export function mapaParaOPlano(m) {
  const arquivo = m.livro.preparo.arquivoDoMapa;
  if (!arquivo || !existsSync(join(RAIZ, arquivo))) return null;
  return readFileSync(join(RAIZ, arquivo), 'utf8')
    .split('\n')
    .filter((linha) => !/^# /.test(linha))
    .map((linha) => linha.replace(/^(#{2,5}) /, '$1# '))
    .join('\n')
    .trim();
}

// O que cada pedido diz sobre onde está o mapa.
export function ondeEstaOMapa(m) {
  const arquivo = m.livro.preparo.arquivoDoMapa;
  if (ehRevisao(m)) return arquivo ? crase(arquivo) : '(não há: use a regra de padrão)';
  return arquivo || m.livro.preparo.mapaNoPlano ? 'no plano, na seção "Mapa do código"' : '(não há: use a regra de padrão)';
}

// ------------------------------------------------------------------------------------ ações

// A única parada. Depois dela o humano resolve e manda /entregar de novo, sem tarefa.
export function bloquear(m, passo, texto) {
  m.livro.aguardando = null;
  // Como os repositórios ainda intocados estão agora: o que mudar até o humano liberar é dele.
  m.livro.parado = { tipo: 'bloqueio', passo, texto, quando: new Date().toISOString(), arvores: arvoresDosIntocados(m) };
  registrar(m, `bloqueio: ${texto.split('\n')[0]}`);
  atualizarEstado(m, 'bloqueado: só você resolve (o motivo está na conversa)');
  return { tipo: 'PARE', texto };
}

// O fim da condução, com ou sem entrega. O relatório é o que o operador mostra ao humano.
export function encerrarConducao(m, motivo, relatorio) {
  Object.assign(m.livro, { aguardando: null, unidade: null, encerrado: { quando: new Date().toISOString(), motivo, relatorio } });
  registrar(m, motivo);
  return { tipo: 'FIM', texto: relatorio };
}

// Uma correção depois das fatias (revisão da PR, QA, prova final, checks) vira uma unidade de
// trabalho. O pedido fica no livro até a unidade abrir.
export function pedirReparo(m, repo, reparo) {
  Object.assign(estadoDoRepo(m, repo), { fase: 'reparo', reparo });
  registrar(m, `${repo}: ${reparo.rotulo}`);
  return null;
}

// Mudança sem commit que a própria condução deixou para trás não vale uma pergunta: vai para um
// patch, e a pasta volta ao último commit.
export function limparSobras(m, repo, quando) {
  const pasta = pastaDoRepo(m.config, repo);
  const patch = noDescarte(m, `${repo}-${m.livro.sequencia}.patch`);
  const guardou = acoes.descartar(pasta, branchAtual(pasta), acoes.cabeca(pasta), patch);
  avisar(m, `Sobraram mudanças sem commit em ${dirDoRepo(m, repo)}/ ${quando}; o maestro descartou${guardou ? ` (estão em ${relativo(patch)})` : ''}.`);
}

// Desfaz o que um trabalho deixou no repositório e devolve onde ficou guardado o que foi tentado.
export function descartarTrabalho(m, repo, branch, referencia, nome) {
  const patch = noDescarte(m, `${nome}.patch`);
  return acoes.descartar(pastaDoRepo(m.config, repo), branch, referencia, patch) ? relativo(patch) : null;
}

// ------------------------------------------------------------------- o que é do humano
//
// Mudança sem commit num repositório em que a condução ainda não entrou tem dois donos possíveis.
// Se estava lá quando o humano passou a vez (no começo, ou ao liberar um bloqueio), é dele: o
// maestro não mexe e não começa por cima. Se apareceu depois, não dá para saber de quem é (sobra
// de um subagente, ou edição feita com a condução em andamento): o maestro só mexe nela quando
// precisa do repositório, e aí guarda tudo num patch em vez de parar.
// Repositório fora da tarefa não é tocado nunca.

export const reposAindaIntocados = (m) => nomesDosRepos(m.config).filter((repo) => ehRepoGit(pastaDoRepo(m.config, repo)) && !m.livro.repos[repo]?.entrou);
const comMudancas = (m, repos) => repos.filter((repo) => !acoes.arvoreLimpa(pastaDoRepo(m.config, repo)));
// Livro sem a anotação (condução aberta por versão anterior): na dúvida, a mudança é do humano.
const ehDoHumano = (m, repo) => m.livro.doHumano?.includes(repo) ?? true;
export const arvoresDosIntocados = (m) => Object.fromEntries(reposAindaIntocados(m).map((repo) => [repo, hashDaArvore(pastaDoRepo(m.config, repo))]));

// No começo, tudo o que está sem commit é do humano. Depois de uma pausa (um bloqueio que ele
// liberou), é dele o que já era e o que mudou enquanto a condução esteve parada.
export function anotarOQueEDoHumano(m, arvoresDaPausa = null) {
  const sujos = comMudancas(m, reposAindaIntocados(m));
  const jaEram = m.livro.doHumano;
  m.livro.doHumano =
    jaEram && arvoresDaPausa
      ? sujos.filter((repo) => jaEram.includes(repo) || hashDaArvore(pastaDoRepo(m.config, repo)) !== arvoresDaPausa[repo])
      : sujos;
  return m.livro.doHumano;
}

// "certeza" diz se o maestro já sabe que vai trabalhar nesses repositórios. No começo de uma entrega
// ele ainda não sabe: o humano pode só mandar seguir, e a condução volta a bloquear se o plano precisar.
export function textoDasMudancas(m, repos, { certeza = true } = {}) {
  const dirs = repos.map((repo) => dirDoRepo(m, repo));
  return [
    `Há mudanças sem commit em ${dirs.map((dir) => `${dir}/`).join(' e em ')}, e elas são suas: o maestro não mexe nelas. Faça commit, guarde (git stash) ou descarte.`,
    ...dirs.flatMap((dir) => [`Para ver: git -C ${dir} status --short`, `Para guardar tudo: git -C ${dir} stash -u`]),
    ...(certeza ? [] : ['Se esta tarefa não mexe aí, deixe como está: a condução não toca nesse repositório.']),
  ].join('\n');
}

// No fim da condução: os repositórios em que ela não entrou e que têm mudança que não era do humano.
export const sobrasNosIntocados = (m) => comMudancas(m, reposAindaIntocados(m)).filter((repo) => !ehDoHumano(m, repo));

// Antes de trabalhar num repositório pela primeira vez. O que é do humano bloqueia. O que apareceu
// depois sai do caminho, guardado em patch: o repositório é da tarefa, e parar aqui seria parar no meio.
export function respeitarOQueEDoHumano(m, repos, passo = 'mudancas') {
  const sujos = comMudancas(m, repos.filter((repo) => reposAindaIntocados(m).includes(repo)));
  const doHumano = sujos.filter((repo) => ehDoHumano(m, repo));
  if (doHumano.length > 0) return bloquear(m, passo, textoDasMudancas(m, doHumano));
  for (const repo of sujos) {
    const pasta = pastaDoRepo(m.config, repo);
    const patch = noDescarte(m, `${repo}-${m.livro.sequencia}.patch`);
    acoes.descartar(pasta, branchAtual(pasta), acoes.cabeca(pasta), patch);
    avisar(
      m,
      `Havia mudanças sem commit em ${dirDoRepo(m, repo)}/ que não estavam lá quando você passou a vez (sobra de um passo, ou edição feita com a condução em andamento). O maestro tirou da pasta para poder trabalhar; estão em ${relativo(patch)}.`,
    );
  }
  return null;
}

export const repetir = (texto) => ({ tipo: 'REPETIR', texto });
export const segundosDesde = (quando) => Math.max(0, Math.round((Date.now() - quando) / 1000));

const comoLista = (itens) => (itens.length > 0 ? itens.map((item) => `- ${item.repo ? `${item.repo}: ` : ''}${item.pt}`).join('\n') : '—');

// As seções "Estado", "Decisões no caminho" e "Pendências" do plano são do maestro: ele as
// reescreve a partir do livro. É o que o humano lê para saber onde a tarefa está.
export function atualizarEstado(m, proximo) {
  const texto = textoDoPlano(m);
  if (!texto) return;
  const prs = Object.entries(m.livro.repos)
    .filter(([, estado]) => estado.url)
    .map(([repo, estado]) => `- PR de ${repo}: ${estado.url}`);
  const estado = [`- Pronto: ${m.livro.concluidas.join(', ') || '—'}`, `- Próximo passo: ${proximo}`, ...prs];
  const comDecisoes = escreverSecao(texto, 'Decisões no caminho', comoLista(m.livro.decisoes));
  const comPendencias = escreverSecao(comDecisoes, 'Pendências', comoLista(m.livro.pendencias));
  gravarPlano(m, escreverSecao(comPendencias, 'Estado', estado.join('\n')));
}

function montarPedido(m, numero, titulo, parametros, roteiro) {
  return [
    `# Pedido ${numero} — ${titulo}`,
    '',
    `Você é um subagente na condução de ${crase(m.id)}. Faça só o que este pedido manda, do começo ao fim. O seu trabalho só conta se você terminar gravando o arquivo de resultado, no formato que o roteiro pede.`,
    '',
    ...REGRAS_DE_TODO_PEDIDO,
    '',
    '## Parâmetros',
    '',
    ...Object.entries(parametros).map(([nome, valor]) => `- ${nome}: ${valor}`),
    '',
    '---',
    '',
    roteiro.trim(),
    '',
  ].join('\n');
}

// Um passo vira um arquivo de pedido (parâmetros e roteiro juntos) e uma linha para o operador
// repassar. Quanto menos texto passa pela mão do operador, menos chance de chegar torto.
// Passo que não fecha nas tentativas não vira pergunta: "seEsgotar" diz como a condução segue sem ele.
export function despachar(m, passo) {
  const limite = passo.limite ?? 1 + m.opcoes.tentativasPorPasso;
  const feitas = m.livro.tentativas[passo.chave] ?? 0;
  const emLaco = m.livro.despachos >= m.opcoes.maximoDeDespachos;
  if (feitas >= limite || emLaco) {
    const motivo = emLaco
      ? bi(`a condução já abriu ${m.livro.despachos} subagentes`, `the run already opened ${m.livro.despachos} subagents`)
      : bi(`não fechou em ${feitas} tentativas`, `did not close in ${feitas} attempts`);
    registrar(m, `${passo.titulo}: ${motivo.pt}`);
    return passo.seEsgotar(m, { resumo: bi(`"${passo.titulo}" ${motivo.pt}`, `"${passo.titulo}" ${motivo.en}`), detalhe: ultimoProblema(m, passo.chave) });
  }
  const caminhoDoRoteiro = join(PASTA_DE_ROTEIROS, ROTEIROS[passo.papel]);
  if (!existsSync(caminhoDoRoteiro)) {
    return bloquear(m, 'instalacao', `Falta o roteiro ${relativo(caminhoDoRoteiro)}. Rode o instalador do harness de novo.`);
  }
  m.livro.tentativas[passo.chave] = feitas + 1;
  m.livro.despachos += 1;

  const base = caminhoDoPasso(m, passo.chave);
  const numero = String(m.livro.sequencia).padStart(2, '0');
  const arquivo = relativo(`${base}.md`);
  const pedido = relativo(`${base}.pedido.md`);
  const titulo = `${passo.titulo} (tentativa ${feitas + 1} de ${limite})`;
  const parametros = { ...passo.parametros };
  if (!('Achados a corrigir' in parametros)) {
    parametros['Problema da tentativa anterior'] = m.livro.problemas[passo.chave] ? crase(m.livro.problemas[passo.chave]) : '(nenhum)';
  }
  parametros['Arquivo de resultado'] = crase(arquivo);
  writeFileSync(join(RAIZ, pedido), montarPedido(m, numero, titulo, parametros, readFileSync(caminhoDoRoteiro, 'utf8')));

  const instrucao = `Leia o arquivo ${crase(pedido)} inteiro e faça exatamente o que ele manda, do começo ao fim. Não faça nada além disso. Quando terminar, responda só: feito.`;
  const subagente = m.opcoes.subagentes[passo.papel] ?? m.opcoes.subagentes.padrao;
  m.livro.aguardando = { ...passo.extra, tipo: passo.tipo, chave: passo.chave, titulo, arquivo, pedido, instrucao, subagente };
  return { tipo: 'SUBAGENTE', titulo, texto: instrucao, subagente };
}

// Passo fechado: as tentativas e o problema dele não acompanham o que vem depois.
export function esquecerPasso(m, prefixo) {
  for (const mapa of [m.livro.tentativas, m.livro.problemas]) {
    for (const chave of Object.keys(mapa)) {
      if (chave === prefixo || chave.startsWith(`${prefixo}-`)) delete mapa[chave];
    }
  }
}

// Um serviço demorado (portões, commit, push) atravessa várias chamadas do maestro.
// O livro guarda o nome dele, já gravado em disco, para a chamada seguinte reencontrá-lo.
export function comServico(m, chave, usar) {
  if (!m.livro.servicos[chave]) {
    m.livro.servicos[chave] = `${chave}-${Date.now().toString(36)}`;
    gravarLivro(m.livro);
  }
  const desfecho = usar(m.livro.servicos[chave]);
  if (desfecho.estado !== 'rodando') delete m.livro.servicos[chave];
  return desfecho;
}

// Serviço interrompido se refaz sozinho, até um limite. Devolve true quando o limite estourou.
export function estourouAsRefeitas(dono, contador) {
  dono[contador] = (dono[contador] ?? 0) + 1;
  return dono[contador] > MAXIMO_DE_SERVICOS_REFEITOS;
}

// ------------------------------------------------------------------------------------ selos
// Ninguém confirma nada no meio da condução, então adulteração não vira pergunta: o plano volta
// à versão aprovada, e mudança no harness fica registrada na entrega.

// O que define as regras do jogo: a lei, a configuração, os scripts, os roteiros, o padrão mapeado
// e a ligação dos hooks em cada ferramenta.
const SELADOS = ['AGENTS.md', 'CLAUDE.md', 'harness/config.json', '.cursor/hooks.json', '.claude/settings.json', '.codex/hooks.json'];
const PASTAS_SELADAS = ['harness/bin', 'harness/roteiros', '.cursor/rules', '.cursor/agents', '.claude/agents', '.agents/skills'];

export function impressaoDoHarness() {
  const arquivos = [...SELADOS, ...PASTAS_SELADAS.flatMap((pasta) => listarArquivos(join(RAIZ, pasta)).map(relativo))];
  const existentes = arquivos.filter((arquivo) => existsSync(join(RAIZ, arquivo))).sort();
  return Object.fromEntries(existentes.map((arquivo) => [arquivo, resumo(readFileSync(join(RAIZ, arquivo)))]));
}

function listarArquivos(pasta) {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta, { withFileTypes: true }).flatMap((item) => (item.isDirectory() ? listarArquivos(join(pasta, item.name)) : [join(pasta, item.name)]));
}

export function conferirSeloDoHarness(m) {
  // O mapeador muda a configuração e a regra de padrão a pedido do maestro: quem confere é o recebimento dele.
  if (m.livro.aguardando?.tipo === 'mapear') return;
  const agora = impressaoDoHarness();
  const selado = m.livro.selos.harness;
  m.livro.selos.harness = agora;
  if (!selado) return;
  const mudaram = semRepetir([...Object.keys(selado), ...Object.keys(agora)]).filter((arquivo) => selado[arquivo] !== agora[arquivo]);
  if (mudaram.length > 0) avisar(m, `Arquivos do harness mudaram durante a condução: ${crases(mudaram.sort())}. Se não foi você, confira harness/config.json e rode o instalador de novo.`);
}

const COPIA_SELADA = naConducao('plano.selado.md');

export function selarPlano(m) {
  const texto = textoDoPlano(m);
  m.livro.selos.plano = seloDoPlano(texto);
  mkdirSync(PASTA_DA_CONDUCAO, { recursive: true });
  writeFileSync(COPIA_SELADA, texto);
}

export function manterPlanoSelado(m) {
  const texto = textoDoPlano(m);
  if (texto && seloDoPlano(texto) === m.livro.selos.plano) {
    reporMarcasDoPlano(m, texto);
    return;
  }
  gravarPlano(m, readFileSync(COPIA_SELADA, 'utf8'));
  reporMarcasDoPlano(m, textoDoPlano(m));
  avisar(m, 'O plano foi alterado fora do maestro durante a condução; a versão aprovada foi restaurada.');
  atualizarEstado(m, 'o maestro segue conduzindo');
}

// A marca [x] de cada fatia é do maestro: vale o que o livro registrou, não o que está no papel.
function reporMarcasDoPlano(m, texto) {
  const corrigido = lerPlano(texto).fatias.reduce((atual, fatia) => {
    const feita = m.livro.concluidas.includes(fatia.id);
    return fatia.feita === feita ? atual : marcarFatia(atual, fatia.id, feita);
  }, texto);
  if (corrigido !== texto) gravarPlano(m, corrigido);
}

// --------------------------------------------------------------------------------- ambiente

export function pendenciasDoAmbiente(m) {
  const pendencias = [acoes.ambienteDoGitHub()].filter(Boolean);
  const repos = nomesDosRepos(m.config).filter((repo) => ehRepoGit(pastaDoRepo(m.config, repo)));
  if (repos.length === 0) pendencias.push(`Nenhum repositório de harness/config.json existe como repositório git. Rode ${crase('node harness/bin/doutor.mjs')}.`);
  for (const repo of repos) {
    if (!acoes.temOrigem(pastaDoRepo(m.config, repo))) pendencias.push(`O repositório ${repo} não tem o remoto "origin".`);
  }
  if (pendencias.length === 0) return null;
  return [
    'O ambiente não está pronto para uma entrega até a PR:',
    ...emLista(pendencias),
    `Se o terminal do agente roda em sandbox sem rede (Cursor), ponha ${crase(COMANDO)} na allowlist de comandos.`,
  ].join('\n');
}

export function pendenciasDosRepos(m, repos) {
  return repos.flatMap((repo) => {
    const pendencias = [];
    if (!ehRepoGit(pastaDoRepo(m.config, repo))) pendencias.push(`${repo}: a pasta "${dirDoRepo(m, repo)}" não é um repositório git`);
    if ((m.config.repos[repo].portoes ?? []).length === 0) pendencias.push(`${repo}: nenhum portão configurado (rode /mapear ${repo})`);
    const regra = join(RAIZ, regraDePadrao(repo));
    const mapeada = existsSync(regra) && !readFileSync(regra, 'utf8').includes('NÃO MAPEADO');
    if (!mapeada) pendencias.push(`${repo}: o padrão não está mapeado (rode /mapear ${repo})`);
    return pendencias;
  });
}
