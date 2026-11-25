# Domain harness

Um harness genérico ensina o agente a trabalhar bem. Este ensina o agente a trabalhar **como o seu projeto trabalha**: o padrão sai do código, é escrito com evidência e é cobrado por máquina sempre que dá.

Foi feito para um projeto com backend e frontend em repositórios separados, abertos juntos numa pasta raiz, com PR revisada por humano e CI com Sonar no GitHub. Roda no agente do Cursor e nas extensões do Claude Code e do Codex.

## As três peças

| Peça | Onde fica na raiz | Papel |
|---|---|---|
| **Lei** | `AGENTS.md` | A filosofia, em cerca de 70 linhas, sempre no contexto: o código existente é o padrão; fora do padrão, pare e explique; escreva para quem revisa; pronto é provado; contexto é orçamento. |
| **Mapa** | `.cursor/rules/padrao-backend.mdc`, `padrao-frontend.mdc` | O padrão de cada repositório, extraído do código pelo `/mapear`: camadas, receitas, arquivos-espelho e convenções, cada afirmação com o arquivo que comprova. |
| **Catraca** | hooks + `harness/bin/` + `harness/config.json` | O que máquina consegue verificar, máquina verifica: atalhos barrados, diff conferido, portões locais, checks da PR. |

## O fluxo

Cada passo roda numa conversa nova. O estado fica em `harness/tarefas/<id>/plano.md`, não na conversa.

| Comando | O que faz |
|---|---|
| `/mapear backend`, `/mapear frontend` | Uma vez por repositório: escreve o padrão e descobre os comandos que o CI roda. |
| `/planejar <tarefa>` | Critérios de aceite, contrato da API e fatias pequenas. Espera o seu "aprovado". |
| `/fatia` | Uma fatia por conversa: implementa pelo espelho, roda os portões, passa pelo revisor, faz um commit. |
| `/qa` | Testa na tela pelos critérios de aceite. Não corrige: falha vira fatia nova. |
| `/pr <repo>` | Abre a PR, espera CI e Sonar e corrige o que reprovar. Depois trata os comentários da revisão. |
| `/conferir <repo> [PR]` | Audita uma branch ou PR que já existe, feita com ou sem o harness. Só relata. |

O passo a passo completo, do setup à primeira entrega, está em [docs/exemplo.md](docs/exemplo.md).

## Instalar

Precisa de Node 16+, git e GitHub CLI (`gh auth login`). Os scripts não têm dependências.

```bash
git clone https://github.com/tarcio11/domain-harness ~/domain-harness
node ~/domain-harness/instalar.mjs /caminho/da/raiz --com claude,codex
cd /caminho/da/raiz && node harness/bin/doutor.mjs
```

- A raiz é a pasta que contém os dois repositórios, não um deles.
- `--com claude,codex` é opcional: sem ele, só o agente do Cursor é configurado.
- Para um agente fazer a instalação por você, use o texto de [docs/prompt-de-setup.md](docs/prompt-de-setup.md).

**Atualizar:** `git pull` em `~/domain-harness` e rode o instalador de novo. Ele atualiza o motor (lei, roteiros, scripts) e nunca sobrescreve o que é do projeto (`harness/config.json`, os dois arquivos de padrão, `harness/tarefas/`) nem o que você editou: nesse caso grava a versão nova ao lado, com final `.novo`, e avisa.

O que o `/mapear` escreve descreve o seu código. Fica só na raiz do seu projeto; não suba para um repositório público.

## Em cada ferramenta

O julgamento é o mesmo nas três; muda como cada uma carrega as peças.

| | Agente do Cursor | Extensão do Claude Code | Extensão do Codex |
|---|---|---|---|
| Lei | `AGENTS.md` | `CLAUDE.md`, que importa `AGENTS.md` | `AGENTS.md` |
| Mapa | A regra entra sozinha quando o agente toca no repositório | Lido porque a lei e os roteiros mandam | Lido porque a lei e os roteiros mandam |
| Comandos | `/fatia` (`.agents/skills`) | `/fatia` (`.claude/commands`, que aponta para o mesmo roteiro) | `$fatia` (`.agents/skills`) |
| Revisor de contexto limpo | Subagente `revisor` | Subagente `revisor` | Subagente comum seguindo `harness/roteiros/revisor.md` |
| Guarda de shell | `.cursor/hooks.json` | `.claude/settings.json` | `.codex/hooks.json` |
| Comando que pede confirmação | Pergunta a você | Pergunta a você | Bloqueia e manda chamar você |
| Cobrança do diff no fim do turno | Sim | Sim | Sim |
| Onde conferir os hooks | Customize → Hooks, com a pasta confiável | `/hooks`, com a pasta confiável | `/hooks`: revisar e confiar; projeto confiável |

Três coisas para saber:

- O Cursor também carrega os hooks de `.claude/settings.json`. Com os dois instalados, a guarda roda duas vezes no agente do Cursor; ela foi escrita para dar a mesma resposta nas duas.
- O Codex só roda hook de projeto em projeto confiável e depois de você revisar cada hook. A documentação dele não diz como trata uma raiz que não é repositório git: se os hooks não aparecerem, rode `git init` na raiz.
- Nas extensões, quem trabalha é o agente da extensão, não o do Cursor: os hooks do Cursor não valem ali, e por isso cada uma tem o seu adaptador.

## O que tem neste repositório

```
instalar.mjs            instala ou atualiza o harness numa raiz
modelo/                 o que vai para a raiz
  AGENTS.md             a lei
  .agents/skills/       os seis roteiros
  .cursor/              hooks, subagente revisor e os dois arquivos de padrão (vazios até o /mapear)
  .claude/, CLAUDE.md   adaptador do Claude Code (só com --com claude)
  .codex/               adaptador do Codex (só com --com codex)
  harness/              scripts da catraca, config, modelos e manual de uso
docs/exemplo.md         do setup à primeira entrega, passo a passo
docs/prompt-de-setup.md texto para pedir a instalação a um agente
testes/                 teste de integração do instalador e dos hooks
```

Testes: `node --test testes/*.test.mjs modelo/harness/bin/testes/*.test.mjs` (Node 18+).

## Limites

- Não torna desvio impossível: reduz, expõe e cobra. A catraca pega o que cabe em regra sobre o diff; o resto depende da qualidade do mapa e do revisor humano, que continua sendo o último portão.
- A guarda de shell barra o atalho óbvio; não é uma jaula. Hook que falha libera o comando em vez de travar o trabalho, e as outras camadas (portões, CI, Sonar, revisão) continuam valendo.
- Os scripts são testados com entradas no formato que cada ferramenta documenta. Confira os hooks em cada ferramenta depois de instalar.
- O agente não aprova, não faz merge, não instala dependência e não altera CI, Sonar ou lint. Isso é seu.
