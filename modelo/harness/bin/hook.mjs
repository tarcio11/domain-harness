#!/usr/bin/env node
// Ponto de entrada dos hooks: hook.mjs <shell|parar|compactar> [--formato cursor|claude|codex].
// Recebe o evento em JSON pela entrada padrão e responde em JSON pela saída padrão.
// O julgamento é o mesmo nas três ferramentas; só muda o formato da pergunta e da resposta.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { branchAtual, ehBranchProtegida, ehRepoGit, lerConfig, nomesDosRepos, pastaDoRepo, RAIZ } from './config.mjs';
import { conferirRepo, formatarAchado } from './conferir.mjs';
import { avaliarComando } from './guarda.mjs';
import { conducaoAberta, gravarOperador, lerOperador, maestroAtivo } from './livro.mjs';

const USO = 'Uso: node harness/bin/hook.mjs <shell|parar|compactar> [--formato cursor|claude|codex]';
const MAXIMO_DE_BLOQUEIOS_NA_MENSAGEM = 12;
const MAXIMO_DE_COBRANCAS_SEGUIDAS = 3;
// Duas fontes de hook podem chamar este script para o mesmo evento (o Cursor também carrega
// .claude/settings.json). Dentro desta janela a resposta se repete igual, em vez de silenciar.
const JANELA_DO_MESMO_EVENTO_MS = 15000;
const FERRAMENTAS_QUE_EDITAM = /^(apply_patch|Edit|Write)$/i;
const MAESTRO = 'node harness/bin/maestro.mjs';
// Os comandos que conduzem: são da conversa principal (o operador), nunca de um subagente.
const COMANDO_DE_CONDUCAO = /maestro\.mjs["']?\s+(iniciar|proximo|retomar|encerrar)\b/;
// Chamada simples de um script do harness, sem nada encadeado: dispensa a confirmação do humano.
const SCRIPT_DO_HARNESS = /^\s*node\s+(\.\/)?harness\/bin\/(maestro|portoes|esperar-checks|doutor)\.mjs(\s+[\w@%+=:,.\/-]+)*\s*$/;
// Quantas vezes o operador é empurrado sem que o maestro tenha andado. Depois disso o turno termina.
const MAXIMO_DE_EMPURROES = { seguir: 2, abrir: 1 };
const SO_O_OPERADOR = {
  permissao: 'deny',
  regra: 'so-o-operador',
  mensagem: 'Só a conversa principal conduz o maestro. Faça o que o seu pedido manda, grave o arquivo de resultado e termine.',
};
const RESPOSTA_E_DO_HUMANO = {
  permissao: 'deny',
  regra: 'resposta-do-humano',
  mensagem: 'A resposta a um PARE tem que vir do humano, numa mensagem dele depois do PARE. Mostre a ele o texto do PARE e encerre o seu turno; não escreva a resposta por ele.',
};
const LARGAR_E_DO_HUMANO = {
  permissao: 'ask',
  regra: 'largar-conducao',
  mensagem: 'Largar a condução do /entregar é decisão do humano.',
};

const JULGAR = { shell: julgarShell, parar: julgarParada, compactar: julgarCompactacao };

const RESPONDER = {
  cursor: {
    shell: (v) =>
      v.permissao === 'allow'
        ? { permission: 'allow' }
        : { permission: v.permissao, user_message: paraOHumano(v), agent_message: paraOAgente(v) },
    parar: (v) => (v.cobranca ? { followup_message: v.cobranca } : {}),
    compactar: (v) => ({ user_message: v.aviso }),
  },
  // Sem objeção a resposta é vazia: quem decide é o fluxo normal de permissão da ferramenta.
  // A exceção são os scripts do próprio harness, liberados para a condução não parar a cada passo.
  claude: {
    shell: (v) => {
      if (v.permissao === 'allow') return v.doHarness ? decisaoDePermissao('allow', 'Script do próprio harness.') : {};
      return decisaoDePermissao(v.permissao, v.permissao === 'ask' ? paraOHumano(v) : paraOAgente(v));
    },
    parar: (v) => (v.cobranca ? { decision: 'block', reason: v.cobranca } : {}),
    compactar: (v) => ({ systemMessage: v.aviso }),
  },
  // O Codex não tem "perguntar": o que pediria confirmação vira bloqueio que manda chamar o humano.
  codex: {
    shell: (v) => {
      if (v.permissao === 'allow') return {};
      const chamarOHumano = v.permissao === 'ask' ? ' Peça ao humano: se ele confirmar, ele mesmo roda o comando.' : '';
      return decisaoDePermissao('deny', `${paraOAgente(v)}${chamarOHumano}`);
    },
    parar: (v) => (v.cobranca ? { decision: 'block', reason: v.cobranca } : {}),
    compactar: (v) => ({ systemMessage: v.aviso }),
  },
};

const SE_FALHAR = { cursor: { shell: { permission: 'allow' } } };

function decisaoDePermissao(decisao, motivo) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decisao,
      permissionDecisionReason: motivo,
    },
  };
}

function paraOHumano(veredito) {
  return `Harness: ${veredito.mensagem}${veredito.permissao === 'ask' ? ' Confirma?' : ''}`;
}

function paraOAgente(veredito) {
  if (veredito.permissao === 'ask') {
    return `O HARNESS PEDIU CONFIRMAÇÃO AO HUMANO (${veredito.regra}). ${veredito.mensagem}`;
  }
  return `BLOQUEADO PELO HARNESS (${veredito.regra}). ${veredito.mensagem} Não tente outro caminho para o mesmo efeito.`;
}

async function lerEntrada() {
  if (process.stdin.isTTY) return {};
  process.stdin.setEncoding('utf8');
  let bruto = '';
  for await (const pedaco of process.stdin) bruto += pedaco;
  // No Windows o Cursor pode mandar um BOM antes do JSON.
  bruto = bruto.replace(/^\uFEFF/, '').trim();
  return bruto ? JSON.parse(bruto) : {};
}

// O Cursor manda o comando direto; Claude Code e Codex mandam dentro de tool_input.
// Em ferramenta de edição, tool_input.command é o patch, não um comando de shell.
function comandoDaEntrada(entrada) {
  if (FERRAMENTAS_QUE_EDITAM.test(entrada.tool_name ?? '')) return '';
  const comando = entrada.command ?? entrada.tool_input?.command;
  return typeof comando === 'string' ? comando : '';
}

const conversaDaEntrada = (entrada) => entrada.conversation_id ?? entrada.session_id ?? null;

function julgarShell(entrada, config) {
  const comando = comandoDaEntrada(entrada);
  const conducao = COMANDO_DE_CONDUCAO.exec(comando)?.[1];
  if (conducao) {
    // O Claude Code marca com agent_id o que vem de dentro de um subagente.
    if (entrada.agent_id) return SO_O_OPERADOR;
    if (conducao === 'encerrar' && conducaoAberta()) return LARGAR_E_DO_HUMANO;
    if (conducao === 'retomar' && respostaNoMesmoTurno(entrada)) return RESPOSTA_E_DO_HUMANO;
    anotarOperador(entrada);
  }
  const pastasDoProduto = nomesDosRepos(config).map((nome) => pastaDoRepo(config, nome));
  const veredito = avaliarComando(comando, {
    cwd: resolve(entrada.cwd || RAIZ),
    ehRepoDoProduto: (pasta) => pastasDoProduto.some((raizDoRepo) => estaDentro(pasta, raizDoRepo)),
    branchDe: branchAtual,
    ehBranchProtegida: (branch) => ehBranchProtegida(config, branch),
    maestroAtivo: maestroAtivo(),
  });
  return veredito.permissao === 'allow' && SCRIPT_DO_HARNESS.test(comando) ? { ...veredito, doHarness: true } : veredito;
}

// O turno do humano: muda a cada mensagem dele (generation_id no Cursor, prompt_id no Claude Code).
const turnoDaEntrada = (entrada) => entrada.generation_id ?? entrada.prompt_id ?? null;

// Quem roda o maestro é o operador. O hook de fim de turno só empurra essa conversa, e o maestro
// anota em que turno dela cada PARE foi mostrado.
function anotarOperador(entrada) {
  const conversa = conversaDaEntrada(entrada);
  if (!conversa) return;
  const anterior = lerOperador();
  const mesmaConversa = anterior?.conversa === conversa;
  gravarOperador({ ...(mesmaConversa ? anterior : {}), conversa, turno: turnoDaEntrada(entrada) });
}

// O operador não responde no lugar do humano: "retomar" no mesmo turno em que o PARE apareceu
// nesta conversa é o agente escrevendo a resposta sozinho.
function respostaNoMesmoTurno(entrada) {
  const turno = turnoDaEntrada(entrada);
  const mostradoEm = conducaoAberta()?.parado?.mostradoEm?.[conversaDaEntrada(entrada)];
  return Boolean(turno) && mostradoEm === turno;
}

function estaDentro(pasta, raizDoRepo) {
  const caminho = relative(raizDoRepo, pasta);
  return caminho === '' || (!caminho.startsWith('..') && !isAbsolute(caminho));
}

// Ao fim de cada turno. Com o maestro conduzindo, quem confere o diff é ele, e o hook só mantém
// o operador andando. Sem maestro, um bloqueio novo no diff volta ao agente como próxima mensagem.
function julgarParada(entrada, config) {
  const interrompido = entrada.status !== undefined && entrada.status !== 'completed';
  if (interrompido) return { cobranca: null };
  // Condução largada (sem chamada do maestro há muito tempo) não segura a catraca do trabalho à mão.
  const conducao = conducaoAberta();
  if (conducao && (conducao.parado || maestroAtivo())) return { cobranca: empurrao(entrada, conducao) };

  const bloqueios = bloqueiosPendentes(config);
  const conversa = conversaDaEntrada(entrada) ?? 'sem-conversa';
  const memoria = join(tmpdir(), 'harness-catraca', `${String(conversa).replace(/[^\w-]/g, '_')}.json`);
  if (bloqueios.length === 0) {
    rmSync(memoria, { force: true });
    return { cobranca: null };
  }
  return { cobranca: decidirCobranca(bloqueios, memoria) };
}

// O operador parou sem a AÇÃO ser PARE nem FIM: o hook devolve o próximo movimento.
// "seguir": é só rodar o maestro. "abrir": há um passo esperando resultado e só o operador
// sabe se o subagente ainda trabalha, por isso esse empurrão acontece uma vez só.
function empurrao(entrada, livro) {
  const operador = lerOperador();
  const conversa = conversaDaEntrada(entrada);
  if (livro.parado || !conversa || operador?.conversa !== conversa) return null;
  const pendente = livro.aguardando;
  const tipo = !pendente || existsSync(join(RAIZ, pendente.arquivo)) ? 'seguir' : 'abrir';
  const mensagem = tipo === 'seguir' ? mensagemDeSeguir(livro) : mensagemDeAbrir(pendente);
  const marca = `${livro.tarefa}:${livro.chamadas}:${tipo}`;
  const anterior = operador.empurrao?.marca === marca ? operador.empurrao : null;
  if (anterior && Date.now() - anterior.quando <= JANELA_DO_MESMO_EVENTO_MS) return mensagem;
  if (anterior && anterior.vezes >= MAXIMO_DE_EMPURROES[tipo]) return null;
  gravarOperador({ ...operador, empurrao: { marca, vezes: (anterior?.vezes ?? 0) + 1, quando: Date.now() } });
  return mensagem;
}

// Se a ferramenta entregar esta mensagem a um subagente, ele não pode tomar o lugar do operador.
const SO_PARA_O_OPERADOR = 'Esta mensagem é para o operador da condução. Se você é um subagente com um pedido em mãos, ignore-a e termine o seu pedido.';

function mensagemDeSeguir(livro) {
  return `MAESTRO — a condução de ${livro.tarefa} não terminou e não está esperando o humano. Rode agora \`${MAESTRO} proximo\` e faça o que a AÇÃO mandar. Só pare quando a AÇÃO for PARE ou FIM. ${SO_PARA_O_OPERADOR}`;
}

function mensagemDeAbrir(pendente) {
  return [
    `MAESTRO — você parou com o passo "${pendente.titulo}" em aberto. Escolha UMA opção, a primeira que for verdade:`,
    `a) O subagente deste passo está trabalhando em segundo plano → não faça nada agora; quando ele terminar, rode \`${MAESTRO} proximo\`.`,
    `b) Você ainda não abriu o subagente → abra agora o subagente \`${pendente.subagente}\`, em primeiro plano, com este texto: ${pendente.instrucao} Depois rode \`${MAESTRO} proximo\`.`,
    `c) O subagente já terminou e respondeu → rode \`${MAESTRO} proximo --sem-resultado\`.`,
    SO_PARA_O_OPERADOR,
  ].join('\n');
}

function bloqueiosPendentes(config) {
  return nomesDosRepos(config)
    .filter((nome) => ehRepoGit(pastaDoRepo(config, nome)))
    .flatMap((nome) => conferirRepo(config, nome, { modo: 'fatia' }).achados)
    .filter((achado) => achado.nivel === 'bloqueio' && !achado.liberado)
    .map(formatarAchado);
}

// A mesma lista não é cobrada duas vezes na conversa, e uma sequência de listas diferentes
// para de ser cobrada depois de MAXIMO_DE_COBRANCAS_SEGUIDAS, até o diff ficar limpo.
function decidirCobranca(bloqueios, memoria) {
  const assinatura = createHash('sha1').update(bloqueios.join('\n')).digest('hex');
  const anterior = existsSync(memoria) ? JSON.parse(readFileSync(memoria, 'utf8')) : null;
  if (anterior?.assinatura === assinatura) {
    const ehOMesmoEvento = Date.now() - anterior.quando <= JANELA_DO_MESMO_EVENTO_MS;
    return ehOMesmoEvento ? mensagemDaCatraca(bloqueios) : null;
  }
  const seguidas = (anterior?.seguidas ?? 0) + 1;
  if (seguidas > MAXIMO_DE_COBRANCAS_SEGUIDAS) return null;
  mkdirSync(dirname(memoria), { recursive: true });
  writeFileSync(memoria, JSON.stringify({ assinatura, quando: Date.now(), seguidas }));
  return mensagemDaCatraca(bloqueios);
}

function mensagemDaCatraca(bloqueios) {
  const visiveis = bloqueios.slice(0, MAXIMO_DE_BLOQUEIOS_NA_MENSAGEM);
  const ocultos = bloqueios.length - visiveis.length;
  return [
    `CATRACA DO HARNESS — o diff desta conversa tem ${bloqueios.length} bloqueio(s):`,
    ...visiveis,
    ...(ocultos > 0 ? [`… e mais ${ocultos}. Lista completa: node harness/bin/portoes.mjs <repo> --so-diff`] : []),
    'Corrija a causa agora. Se for um desvio legítimo, não contorne: desfaça a mudança, responda com o bloco DESVIO DE PADRÃO e espere o humano.',
  ].join('\n');
}

function julgarCompactacao(entrada) {
  const uso = typeof entrada.context_usage_percent === 'number' ? ` (uso em ${Math.round(entrada.context_usage_percent)}%)` : '';
  const conselho = conducaoAberta()
    ? 'A condução do maestro está no disco: se o agente se perder, abra uma conversa nova e mande /entregar, sem tarefa, para continuar de onde parou.'
    : 'A fatia ficou grande para uma janela só: peça para atualizar o "Estado" do plano e continue numa conversa nova.';
  return { aviso: `Harness: a conversa vai ser compactada${uso}. ${conselho}` };
}

function lerArgumentos(argumentos) {
  const [evento, ...resto] = argumentos;
  const posicao = resto.indexOf('--formato');
  const formato = posicao >= 0 ? resto[posicao + 1] : 'cursor';
  if (!JULGAR[evento] || !RESPONDER[formato]) {
    console.error(USO);
    process.exit(2);
  }
  return { evento, formato };
}

async function principal() {
  const { evento, formato } = lerArgumentos(process.argv.slice(2));
  let resposta;
  try {
    const veredito = JULGAR[evento](await lerEntrada(), lerConfig());
    resposta = RESPONDER[formato][evento](veredito);
  } catch (erro) {
    // Hook quebrado não pode travar o trabalho: libera, e as outras camadas (portões, CI, revisão) seguram.
    console.error(`harness: hook "${evento}" falhou: ${erro.message}`);
    resposta = SE_FALHAR[formato]?.[evento] ?? {};
  }
  process.stdout.write(JSON.stringify(resposta));
}

await principal();
