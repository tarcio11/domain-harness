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

const USO = 'Uso: node harness/bin/hook.mjs <shell|parar|compactar> [--formato cursor|claude|codex]';
const MAXIMO_DE_BLOQUEIOS_NA_MENSAGEM = 12;
const MAXIMO_DE_COBRANCAS_SEGUIDAS = 3;
// Duas fontes de hook podem chamar este script para o mesmo evento (o Cursor também carrega
// .claude/settings.json). Dentro desta janela a cobrança se repete igual, em vez de silenciar.
const JANELA_DO_MESMO_EVENTO_MS = 15000;
const FERRAMENTAS_QUE_EDITAM = /^(apply_patch|Edit|Write)$/i;

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
  claude: {
    shell: (v) => {
      if (v.permissao === 'allow') return {};
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
  bruto = bruto.replace(/^﻿/, '').trim();
  return bruto ? JSON.parse(bruto) : {};
}

// O Cursor manda o comando direto; Claude Code e Codex mandam dentro de tool_input.
// Em ferramenta de edição, tool_input.command é o patch, não um comando de shell.
function comandoDaEntrada(entrada) {
  if (FERRAMENTAS_QUE_EDITAM.test(entrada.tool_name ?? '')) return '';
  const comando = entrada.command ?? entrada.tool_input?.command;
  return typeof comando === 'string' ? comando : '';
}

function julgarShell(entrada, config) {
  const pastasDoProduto = nomesDosRepos(config).map((nome) => pastaDoRepo(config, nome));
  return avaliarComando(comandoDaEntrada(entrada), {
    cwd: resolve(entrada.cwd || RAIZ),
    ehRepoDoProduto: (pasta) => pastasDoProduto.some((raizDoRepo) => estaDentro(pasta, raizDoRepo)),
    branchDe: branchAtual,
    ehBranchProtegida: (branch) => ehBranchProtegida(config, branch),
  });
}

function estaDentro(pasta, raizDoRepo) {
  const caminho = relative(raizDoRepo, pasta);
  return caminho === '' || (!caminho.startsWith('..') && !isAbsolute(caminho));
}

// Ao fim de cada turno: se o diff tem bloqueio novo, ele volta ao agente como próxima mensagem.
function julgarParada(entrada, config) {
  const interrompido = entrada.status !== undefined && entrada.status !== 'completed';
  const jaCobrouNesteTurno = (entrada.loop_count ?? 0) > 0 || entrada.stop_hook_active === true;
  if (interrompido || jaCobrouNesteTurno) return { cobranca: null };

  const bloqueios = bloqueiosPendentes(config);
  const conversa = entrada.conversation_id ?? entrada.session_id ?? 'sem-conversa';
  const memoria = join(tmpdir(), 'harness-catraca', `${String(conversa).replace(/[^\w-]/g, '_')}.json`);
  if (bloqueios.length === 0) {
    rmSync(memoria, { force: true });
    return { cobranca: null };
  }
  return { cobranca: decidirCobranca(bloqueios, memoria) };
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
  return {
    aviso: `Harness: a conversa vai ser compactada${uso}. A fatia ficou grande para uma janela só: peça para atualizar o "Estado" do plano e continue numa conversa nova.`,
  };
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
