// Antes de planejar ou de revisar, o maestro entende o código. Dois passos, os dois sem o humano:
//   mapear       o padrão de um repositório que ainda não foi mapeado (uma vez por repositório);
//   reconhecer   o código para ESTA tarefa: a entrega mais parecida que já existe, o fio dela da
//                entrada ao dado, os modelos de dados e o espelho de cada peça.
// O mapa só vale com evidência: todo arquivo citado tem que existir.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as acoes from './acoes.mjs';
import { ehRepoGit, nomesDosRepos, pastaDoRepo, RAIZ } from './config.mjs';
import {
  anotarProblema, avisar, baseDoRepo, bloquear, COPIA_DA_CONFIG, crase, crases, despachar, dirDoRepo, ehRevisao, emLista, esquecerPasso, estadoDoRepo,
  gravarNoPasso, impressaoDoHarness, pendenciasDosRepos, registrar, regraDePadrao, reservarNoPasso, rotuloDoRepo, semRepetir,
} from './maestro-base.mjs';
import { prepararRepo } from './maestro-unidade.mjs';

const SECOES_DO_MAPA = ['Entrega mais parecida', 'Fio da entrada ao dado', 'Peças e espelhos'];
const MAXIMO_DE_LINHAS_DO_MAPA = 160;
const MINIMO_DE_ARQUIVOS_NO_MAPA = 3;
const CAMINHO_DA_CONFIG = join(RAIZ, 'harness', 'config.json');

const reposDaConducao = (m) => (ehRevisao(m) ? m.livro.revisao.repos : nomesDosRepos(m.config).filter((repo) => ehRepoGit(pastaDoRepo(m.config, repo))));

export function conduzirPreparo(m) {
  const p = m.livro.preparo;
  // O pedido chega aos subagentes num arquivo de passo, com as palavras do humano.
  p.pedido ??= gravarNoPasso(m, 'pedido.md', m.livro.pedido);
  if (p.fase === 'mapear') return mapearOQueFalta(m, p);
  if (p.fase === 'entrar') return entrarNasBranches(m, p);
  return reconhecer(m, p);
}

// ---------------------------------------------------------------------------------- mapear

function mapearOQueFalta(m, p) {
  const repo = reposDaConducao(m).find((nome) => pendenciasDosRepos(m, [nome]).length > 0);
  if (!repo) {
    p.fase = ehRevisao(m) ? 'entrar' : 'reconhecer';
    return null;
  }
  // O mapeador edita harness/config.json: a cópia é o que volta se ele deixar o arquivo inválido.
  mkdirSync(dirname(COPIA_DA_CONFIG), { recursive: true });
  copyFileSync(CAMINHO_DA_CONFIG, COPIA_DA_CONFIG);
  return despachar(m, {
    chave: `mapear-${repo}`,
    tipo: 'mapear',
    papel: 'mapear',
    titulo: `Mapear o padrão do ${repo}`,
    extra: { repo },
    seEsgotar: (_, esgotado) =>
      bloquear(m, 'mapear', [`Não consegui mapear sozinho o padrão do ${repo}: ${esgotado.resumo.pt}.`, esgotado.detalhe, `Rode /mapear ${repo} numa conversa nova.`].filter(Boolean).join('\n')),
    parametros: {
      Repositório: rotuloDoRepo(m, repo),
      'Regra de padrão': `${crase(regraDePadrao(repo))} (o arquivo que você grava)`,
      'Modelo da regra': crase('harness/modelos/padrao.md'),
      Configuração: crase('harness/config.json'),
    },
  });
}

export function receberMapeamento(m, espera, resultado) {
  const { repo } = espera;
  const erros = [];
  if (m.livro.configInvalida) {
    erros.push(`harness/config.json ficou com JSON inválido (${m.livro.configInvalida}) e o maestro devolveu o arquivo ao que era. Edite só as chaves que o roteiro manda, sem quebrar o JSON.`);
    m.livro.configInvalida = null;
  }
  if (resultado.resultado !== 'ok') erros.push('A primeira linha do arquivo de resultado tem que ser "RESULTADO: ok".');
  erros.push(...pendenciasDosRepos(m, [repo]));
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['O mapeamento ainda não está completo. Corrija:', ...emLista(erros)].join('\n'));
    return null;
  }
  // Esta mudança no harness é do próprio maestro: o selo passa a valer daqui.
  m.livro.selos.harness = impressaoDoHarness();
  esquecerPasso(m, espera.chave);
  avisar(m, `O padrão do ${repo} não estava mapeado, e o maestro mapeou sozinho. Leia ${regraDePadrao(repo)} quando puder e corrija o que estiver errado: é a lei que os agentes seguem.`);
  for (const linha of resultado.linhas('AVISO')) avisar(m, `Mapeamento do ${repo}: ${linha}`);
  registrar(m, `${repo}: padrão mapeado`);
  return null;
}

// ------------------------------------------------------------------------- entrar (revisão)

// Numa revisão, o reconhecimento lê a branch: cada repositório entra nela antes.
function entrarNasBranches(m, p) {
  const { branch, repos } = m.livro.revisao;
  for (const repo of repos) {
    const estado = estadoDoRepo(m, repo);
    if (estado.entrou) continue;
    const entrada = prepararRepo(m, repo, branch, { buscarSempre: true });
    if (entrada) return entrada;
    Object.assign(estado, { cabecaInicial: acoes.cabeca(pastaDoRepo(m.config, repo)), fase: 'revisao' });
  }
  p.fase = 'reconhecer';
  return null;
}

// ------------------------------------------------------------------------------ reconhecer

function reconhecer(m, p) {
  const repos = reposDaConducao(m);
  p.arquivoDoMapa ??= reservarNoPasso(m, 'mapa.md');
  const revisao = ehRevisao(m);
  return despachar(m, {
    chave: 'reconhecer',
    tipo: 'reconhecer',
    papel: 'reconhecer',
    titulo: 'Reconhecer o código para esta tarefa',
    seEsgotar: () => {
      avisar(m, 'O reconhecimento do código não fechou nas tentativas; a condução seguiu sem o mapa, só com a regra de padrão.');
      Object.assign(p, { arquivoDoMapa: null, fase: 'feito' });
      return null;
    },
    parametros: {
      Pedido: crase(p.pedido),
      Trabalho: revisao ? `revisar a branch ${crase(m.livro.revisao.branch)}, que já está escrita` : 'entregar uma tarefa nova',
      Repositórios: repos.map((repo) => rotuloDoRepo(m, repo)).join('; '),
      'Regras de padrão': crases(repos.map(regraDePadrao)),
      'O que a branch mudou': revisao ? repos.map((repo) => crase(`git -C ${dirDoRepo(m, repo)} diff --stat ${baseDoRepo(m, repo)}...HEAD`)).join('; ') : '(não se aplica: a tarefa é nova)',
      'Arquivo do mapa': crase(p.arquivoDoMapa),
    },
  });
}

export function receberReconhecimento(m, espera, resultado) {
  const p = m.livro.preparo;
  const caminho = join(RAIZ, p.arquivoDoMapa);
  const erros = resultado.resultado === 'ok' ? errosDoMapa(m, existsSync(caminho) ? readFileSync(caminho, 'utf8') : '', p.arquivoDoMapa) : ['A primeira linha do arquivo de resultado tem que ser "RESULTADO: ok".'];
  if (erros.length > 0) {
    anotarProblema(m, espera.chave, ['O mapa do código não foi aceito. Corrija no próprio arquivo do mapa:', ...emLista(erros)].join('\n'));
    return null;
  }
  esquecerPasso(m, espera.chave);
  p.fase = 'feito';
  registrar(m, 'código reconhecido: mapa aceito');
  return null;
}

const entreCrases = (texto) => Array.from(texto.matchAll(/`([^`\n]+)`/g), (achado) => achado[1].trim());
const semLinha = (trecho) => trecho.replace(/[:#]L?\d+(-L?\d+)?$/, '').replace(/[.,;]+$/, '');
// Caminho de arquivo ou de pasta: tem barra, não tem espaço e termina em extensão ou em barra.
const pareceCaminho = (trecho) => !/\s/.test(trecho) && trecho.includes('/') && !/^(https?:|@|\/)/.test(trecho) && (/\.\w{1,5}$/.test(trecho) || trecho.endsWith('/'));

function existeNaRaiz(m, caminho) {
  if (existsSync(join(RAIZ, caminho))) return true;
  return nomesDosRepos(m.config).filter((repo) => existsSync(join(pastaDoRepo(m.config, repo), caminho))).length === 1;
}

export function errosDoMapa(m, texto, arquivo) {
  if (texto.trim().length < 200) return [`O mapa não foi gravado em ${arquivo}, ou está curto demais para servir de guia.`];
  const erros = SECOES_DO_MAPA.filter((secao) => !new RegExp(`^#{2,3} +${secao}`, 'mi').test(texto)).map((secao) => `Falta a seção "## ${secao}".`);
  if (texto.split('\n').length > MAXIMO_DE_LINHAS_DO_MAPA) {
    erros.push(`O mapa passou de ${MAXIMO_DE_LINHAS_DO_MAPA} linhas. Aponte arquivos em vez de copiar código e corte o que não serve a esta tarefa.`);
  }
  const citados = semRepetir(entreCrases(texto).map(semLinha).filter(pareceCaminho));
  const inexistentes = citados.filter((caminho) => !existeNaRaiz(m, caminho));
  if (inexistentes.length > 0) {
    erros.push(`Estes caminhos entre crases não existem: ${crases(inexistentes.slice(0, 12))}. Entre crases só vai arquivo que existe e que você abriu, com o caminho a partir da raiz (com a pasta do repositório). Arquivo que a tarefa ainda vai criar vai sem crases.`);
  }
  if (citados.length - inexistentes.length < MINIMO_DE_ARQUIVOS_NO_MAPA) {
    erros.push(`O mapa precisa apontar pelo menos ${MINIMO_DE_ARQUIVOS_NO_MAPA} arquivos que existem: a entrada, a regra e o dado da entrega mais parecida.`);
  }
  return erros;
}
