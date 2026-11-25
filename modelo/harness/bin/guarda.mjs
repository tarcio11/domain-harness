// Decide se um comando de shell pedido pelo agente pode rodar.
// Princípio: o agente não pula verificação nem toma decisão que é do humano.
// Função pura: quem chama entrega o contexto (pasta, branch, o que é protegido).

import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';

const MENSAGENS = {
  'pular-verificacao':
    'Pular hooks de git (--no-verify, HUSKY=0, core.hooksPath) é proibido. Se o hook reprovou, conserte a causa.',
  'push-forcado':
    'Push forçado reescreve histórico publicado: é decisão do humano. Corrija com commit novo.',
  'branch-protegida':
    'Commit ou push direto em branch protegida é proibido. Trabalhe na branch da tarefa e abra PR.',
  'apagar-remoto': 'Apagar branch remota é decisão do humano.',
  'decisao-do-revisor': 'Aprovar ou fazer merge de PR é do revisor humano.',
  dependencia:
    'Mudar dependência é desvio de padrão (lei, item 2). Pare, apresente o bloco DESVIO DE PADRÃO e, se aprovado, o humano instala.',
  'descarta-trabalho': 'Este comando descarta trabalho que ainda não foi commitado.',
};

const PERMITIDO = Object.freeze({ permissao: 'allow' });
const negar = (regra) => ({ permissao: 'deny', regra, mensagem: MENSAGENS[regra] });
const perguntar = (regra) => ({ permissao: 'ask', regra, mensagem: MENSAGENS[regra] });

const ENVELOPES = new Set(['sudo', 'env', 'command', 'builtin', 'time', 'nohup', 'exec', 'export']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish']);
const ATRIBUICAO = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DESLIGA_HOOKS = /^(HUSKY=(0|false)|HUSKY_SKIP_HOOKS=.+|LEFTHOOK=(0|false)|SKIP_SIMPLE_GIT_HOOKS=.+)$/;
const HOOKS_PATH = /core\.hookspath/i;
const FLAGS_CURTAS = /^-[A-Za-z]+$/;

const COMMIT_CURTAS_COM_VALOR = 'mFCct';
const COMMIT_LONGAS_COM_VALOR = new Set([
  '--message', '--file', '--author', '--date', '--reuse-message', '--reedit-message',
  '--fixup', '--squash', '--template', '--cleanup', '--pathspec-from-file', '--trailer',
]);
const PUSH_COM_VALOR = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const GH_COM_VALOR = new Set(['-R', '--repo']);
const PACOTES_COM_VALOR = new Set([
  '--prefix', '-C', '--dir', '--cwd', '-w', '--workspace', '--filter', '-F', '--registry', '--cache', '--userconfig',
]);

// sempre: subcomandos que mudam dependência de qualquer jeito; comPacote: só quando vem nome de pacote.
const GERENCIADORES = new Map([
  ['npm', { sempre: ['uninstall', 'remove', 'rm', 'r', 'un', 'unlink', 'update', 'up', 'upgrade'], comPacote: ['install', 'i', 'add'] }],
  ['yarn', { sempre: ['add', 'remove', 'upgrade', 'up'], comPacote: [] }],
  ['pnpm', { sempre: ['add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade'], comPacote: ['install', 'i'] }],
  ['bun', { sempre: ['add', 'remove', 'update'], comPacote: ['install', 'i'] }],
]);

export function avaliarComando(comando, contexto) {
  const vereditos = [
    ...avaliarSegmentos(comando, contexto),
    ...comandosEmbutidos(comando).map((embutido) => avaliarComando(embutido, contexto)),
  ];
  return (
    vereditos.find((v) => v.permissao === 'deny') ??
    vereditos.find((v) => v.permissao === 'ask') ??
    PERMITIDO
  );
}

function avaliarSegmentos(comando, contexto) {
  let pasta = contexto.cwd;
  const vereditos = [];
  for (const tokens of separarSegmentos(comando)) {
    const segmento = descascar(tokens);
    if (segmento.programa === 'cd') pasta = entrarNaPasta(pasta, segmento.args[0]);
    else vereditos.push(avaliarSegmento(segmento, pasta, contexto));
  }
  return vereditos;
}

// $(...) e crases executam mesmo dentro de aspas duplas, onde o separador de segmentos não entra.
function comandosEmbutidos(comando) {
  const embutidos = [];
  let aspas = null;
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i];
    if (aspas === "'") {
      if (c === "'") aspas = null;
    } else if (c === '\\') {
      i++;
    } else if (c === '"') {
      aspas = aspas ? null : '"';
    } else if (c === "'" && !aspas) {
      aspas = "'";
    } else if (c === '$' && comando[i + 1] === '(') {
      const fim = fechamentoDoParentese(comando, i + 2);
      embutidos.push(comando.slice(i + 2, fim));
      i = fim;
    } else if (c === '`') {
      const fim = comando.indexOf('`', i + 1);
      if (fim < 0) break;
      embutidos.push(comando.slice(i + 1, fim));
      i = fim;
    }
  }
  return embutidos;
}

function fechamentoDoParentese(texto, inicio) {
  let nivel = 1;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === '(') nivel++;
    else if (texto[i] === ')' && --nivel === 0) return i;
  }
  return texto.length;
}

// Quebra a linha de comando em segmentos (&&, ||, ;, |, subshell) e cada segmento em tokens,
// respeitando aspas. Assim "--no-verify" dentro de uma mensagem de commit não vira flag.
export function separarSegmentos(comando) {
  const segmentos = [];
  let tokens = [];
  let token = '';
  let temToken = false;
  let aspas = null;

  const fecharToken = () => {
    if (temToken) tokens.push(token);
    token = '';
    temToken = false;
  };
  const fecharSegmento = () => {
    fecharToken();
    if (tokens.length > 0) segmentos.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < comando.length; i++) {
    const c = comando[i];
    const proximo = comando[i + 1];
    if (aspas) {
      if (c === aspas) aspas = null;
      else if (c === '\\' && aspas === '"' && proximo !== undefined) token += comando[++i];
      else token += c;
    } else if (c === '"' || c === "'") {
      aspas = c;
      temToken = true;
    } else if (c === '\\' && proximo === '\n') {
      i++;
    } else if (c === '\\' && proximo !== undefined) {
      token += comando[++i];
      temToken = true;
    } else if (c === '&' && comando[i - 1] === '>') {
      token += c;
    } else if (';|&\n()`'.includes(c)) {
      fecharSegmento();
    } else if (/\s/.test(c)) {
      fecharToken();
    } else {
      token += c;
      temToken = true;
    }
  }
  fecharSegmento();
  return segmentos;
}

function descascar(tokens) {
  const ambiente = [];
  let i = 0;
  for (; i < tokens.length; i++) {
    if (ATRIBUICAO.test(tokens[i])) ambiente.push(tokens[i]);
    else if (!ENVELOPES.has(tokens[i])) break;
  }
  const programa = i < tokens.length ? basename(tokens[i]).replace(/\.(exe|cmd)$/i, '') : null;
  return { ambiente, programa, args: tokens.slice(i + 1) };
}

function entrarNaPasta(pasta, destino) {
  if (!destino || destino === '-') return pasta;
  return resolve(pasta, destino.replace(/^~(?=$|\/)/, homedir()));
}

function avaliarSegmento({ ambiente, programa, args }, pasta, contexto) {
  if (ambiente.some((atribuicao) => DESLIGA_HOOKS.test(atribuicao))) return negar('pular-verificacao');
  const embrulhado = comandoEmbrulhado(programa, args);
  if (embrulhado !== null) return avaliarComando(embrulhado, { ...contexto, cwd: pasta });
  if (programa === 'git') return avaliarGit(args, pasta, contexto);
  if (programa === 'gh') return avaliarGh(args);
  const regrasDePacotes = GERENCIADORES.get(programa);
  return regrasDePacotes ? avaliarPacotes(regrasDePacotes, args) : PERMITIDO;
}

// "bash -c '...'" e "eval ..." carregam outro comando dentro: ele passa pela mesma guarda.
function comandoEmbrulhado(programa, args) {
  if (programa === 'eval') return args.join(' ');
  if (!SHELLS.has(programa)) return null;
  const posicao = args.findIndex((a) => FLAGS_CURTAS.test(a) && a.endsWith('c'));
  return posicao >= 0 && args[posicao + 1] !== undefined ? args[posicao + 1] : null;
}

function avaliarGit(args, pastaInicial, contexto) {
  const { sub, resto, pasta, configs } = lerGit(args, pastaInicial);
  if (configs.some((c) => HOOKS_PATH.test(c))) return negar('pular-verificacao');

  const noProduto = contexto.ehRepoDoProduto(pasta);
  const branch = () => (noProduto ? contexto.branchDe(pasta) : null);
  const protegida = (nome) => noProduto && contexto.ehBranchProtegida(nome);

  switch (sub) {
    case 'config':
      return alteraHooksPath(resto) ? negar('pular-verificacao') : PERMITIDO;
    case 'commit':
      if (commitPulaHooks(resto)) return negar('pular-verificacao');
      return protegida(branch()) ? negar('branch-protegida') : PERMITIDO;
    case 'push':
      return avaliarPush(resto, branch, protegida);
    case 'reset':
      return resto.includes('--hard') ? perguntar('descarta-trabalho') : PERMITIDO;
    case 'clean':
      return temFlag(resto, 'f', '--force') && !temFlag(resto, 'n', '--dry-run')
        ? perguntar('descarta-trabalho')
        : PERMITIDO;
    case 'checkout':
      return resto.includes('.') || temFlag(resto, 'f', '--force') ? perguntar('descarta-trabalho') : PERMITIDO;
    case 'restore':
      return resto.some((a) => a === '.' || a === ':/') ? perguntar('descarta-trabalho') : PERMITIDO;
    case 'stash':
      return ['drop', 'clear'].includes(resto[0]) ? perguntar('descarta-trabalho') : PERMITIDO;
    case 'branch':
      return resto.includes('-D') ? perguntar('descarta-trabalho') : PERMITIDO;
    default:
      return PERMITIDO;
  }
}

function lerGit(args, pastaInicial) {
  let pasta = pastaInicial;
  const configs = [];
  let i = 0;
  for (; i < args.length && args[i].startsWith('-'); i++) {
    if (args[i] === '-C') pasta = entrarNaPasta(pasta, args[++i]);
    else if (args[i] === '-c') configs.push(args[++i] ?? '');
  }
  return { sub: args[i], resto: args.slice(i + 1), pasta, configs };
}

// Ler core.hooksPath é inofensivo; gravar ou remover desliga os hooks do repositório.
function alteraHooksPath(args) {
  const nomes = posicionais(args, new Set());
  const posicao = nomes.findIndex((a) => HOOKS_PATH.test(a));
  if (posicao < 0) return false;
  return nomes.length > posicao + 1 || args.includes('--unset') || args.includes('--unset-all');
}

function commitPulaHooks(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-verify') return true;
    if (COMMIT_LONGAS_COM_VALOR.has(a)) {
      i++;
    } else if (FLAGS_CURTAS.test(a)) {
      for (let j = 1; j < a.length; j++) {
        if (a[j] === 'n') return true;
        if (COMMIT_CURTAS_COM_VALOR.includes(a[j])) {
          if (j === a.length - 1) i++;
          break;
        }
      }
    }
  }
  return false;
}

function avaliarPush(args, branchAtual, protegida) {
  const nomes = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (PUSH_COM_VALOR.has(a)) {
      i++;
    } else if (a === '--no-verify') {
      return negar('pular-verificacao');
    } else if (a === '--force' || a === '--mirror' || a === '--force-if-includes' || a.startsWith('--force-with-lease')) {
      return negar('push-forcado');
    } else if (a === '--delete' || a === '--prune') {
      return negar('apagar-remoto');
    } else if (a === '--all' || a === '--branches') {
      return negar('branch-protegida');
    } else if (FLAGS_CURTAS.test(a)) {
      if (a.includes('f')) return negar('push-forcado');
      if (a.includes('d')) return negar('apagar-remoto');
    } else if (!a.startsWith('-')) {
      nomes.push(a);
    }
  }
  const refs = nomes.slice(1);
  if (refs.some((ref) => ref.startsWith('+'))) return negar('push-forcado');
  if (refs.some((ref) => ref.startsWith(':'))) return negar('apagar-remoto');
  const destinos = refs.length > 0 ? refs.map((ref) => destinoDoRef(ref, branchAtual)) : [branchAtual()];
  return destinos.some(protegida) ? negar('branch-protegida') : PERMITIDO;
}

function destinoDoRef(ref, branchAtual) {
  const destino = ref.includes(':') ? ref.split(':').pop() : ref;
  if (destino === 'HEAD' || destino === '@') return branchAtual();
  return destino.replace(/^refs\/heads\//, '');
}

function avaliarGh(args) {
  const [grupo, acao] = posicionais(args, GH_COM_VALOR);
  if (grupo !== 'pr') return PERMITIDO;
  if (acao === 'merge') return negar('decisao-do-revisor');
  if (acao === 'review' && temFlag(args, 'a', '--approve')) return negar('decisao-do-revisor');
  return PERMITIDO;
}

function avaliarPacotes(regras, args) {
  if (temFlag(args, 'g', '--global')) return PERMITIDO;
  const [sub, ...pacotes] = posicionais(args, PACOTES_COM_VALOR);
  const mudaDependencia =
    regras.sempre.includes(sub) ||
    (regras.comPacote.includes(sub) && pacotes.length > 0) ||
    (sub === 'audit' && pacotes[0] === 'fix');
  return mudaDependencia ? negar('dependencia') : PERMITIDO;
}

function posicionais(args, opcoesComValor) {
  const lista = [];
  for (let i = 0; i < args.length; i++) {
    if (opcoesComValor.has(args[i])) i++;
    else if (!args[i].startsWith('-')) lista.push(args[i]);
  }
  return lista;
}

function temFlag(args, curta, longa) {
  return args.includes(longa) || args.some((a) => FLAGS_CURTAS.test(a) && a.includes(curta));
}
