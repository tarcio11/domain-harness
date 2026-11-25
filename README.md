# Domain harness

Um harness genérico ensina o agente a trabalhar bem. Este ensina o agente a trabalhar **como o seu projeto trabalha**: o padrão sai do código, é escrito com evidência e é cobrado por máquina sempre que dá. E, quando você quiser, leva a tarefa sozinho do plano à PR com os checks verdes.

Foi feito para um projeto com backend e frontend em repositórios separados, abertos juntos numa pasta raiz, com PR revisada por humano e CI com Sonar no GitHub. Roda no agente do Cursor e nas extensões do Claude Code e do Codex.

## As três peças

| Peça | Onde fica na raiz | Papel |
|---|---|---|
| **Lei** | `AGENTS.md` | A filosofia, em cerca de 80 linhas, sempre no contexto: o código existente é o padrão; fora do padrão, pare e explique; escreva para quem revisa; pronto é provado; contexto é orçamento. |
| **Mapa** | `.cursor/rules/padrao-backend.mdc`, `padrao-frontend.mdc` | O padrão de cada repositório, extraído do código pelo `/mapear`: camadas, receitas, arquivos-espelho e convenções, cada afirmação com o arquivo que comprova. |
| **Catraca** | hooks + `harness/bin/` + `harness/config.json` | O que máquina consegue verificar, máquina verifica: atalhos barrados, diff conferido, portões locais, checks da PR. |

## Dois jeitos de trabalhar

O estado fica em `harness/tarefas/<id>/plano.md`, não na conversa. Por isso os dois jeitos se misturam: dá para planejar à mão e entregar no automático.

**Piloto automático.** Um comando, e você só é chamado quando a decisão é sua:

| Comando | O que faz |
|---|---|
| `/entregar <tarefa>` | Planeja, critica o plano, implementa fatia por fatia, revisa, faz os commits, testa na tela, abre a PR de cada repositório, espera CI e Sonar e corrige o que reprovar. Termina com as PRs verdes e um relatório. |

**Passo a passo.** Cada comando numa conversa nova, você no meio de cada etapa:

| Comando | O que faz |
|---|---|
| `/mapear backend`, `/mapear frontend` | Uma vez por repositório: escreve o padrão e descobre os comandos que o CI roda. Vale para os dois jeitos. |
| `/planejar <tarefa>` | Critérios de aceite, contrato da API e fatias pequenas. Espera o seu "aprovado". |
| `/fatia` | Uma fatia por conversa: implementa pelo espelho, roda os portões, passa pelo revisor, faz um commit. |
| `/qa` | Testa na tela pelos critérios de aceite. Não corrige: falha vira fatia nova. |
| `/pr <repo>` | Abre a PR, espera CI e Sonar e corrige o que reprovar. Depois trata os comentários da revisão. |
| `/conferir <repo> [PR]` | Audita uma branch ou PR que já existe, feita com ou sem o harness. Só relata. |

O passo a passo completo, do setup à primeira entrega nos dois jeitos, está em [docs/exemplo.md](docs/exemplo.md).

## Como o `/entregar` não deixa brecha

A ideia é uma só: **o modelo opera, o script decide e confere.** Quem conduz é `harness/bin/maestro.mjs`, um programa sem modelo dentro. Ele foi desenhado para modelos pequenos, que esquecem passos, param no meio e dizem "pronto" sem estar.

- **O operador não pensa.** A conversa com você só roda `node harness/bin/maestro.mjs proximo` e faz o que a linha `AÇÃO:` manda: abrir um subagente, repetir, parar ou terminar. Ela não lê código, então a janela dela não enche.
- **Cada passo é um subagente de contexto limpo**, que recebe um arquivo de pedido com tudo: os parâmetros, o roteiro e o formato exato da resposta. O operador repassa uma linha só.
- **Nada vale pela palavra do modelo.** O executor diz "ok", e o maestro confere no git: algo mudou, só dentro do escopo, sem verificação desligada, sem arquivo protegido, e os portões (lint, tipos, testes, build) estão verdes para exatamente aqueles arquivos. O revisor aprova, e o maestro confere se o parecer é coerente e se cada arquivo novo foi comparado com um espelho que já existia.
- **Branch, commit, push e PR são do script.** Os hooks barram esses comandos para qualquer agente enquanto a condução está aberta. O commit só nasce depois da revisão, com os arquivos que foram revisados.
- **O plano e as regras ficam selados.** Se um subagente "aprovar" o próprio desvio no plano, afrouxar um portão ou editar o padrão mapeado, a condução para e mostra o que mudou.
- **Para só quando a decisão é sua:** dúvida ou desvio no plano, desvio achado na execução, passo que não fecha depois das tentativas, ou algo que só você resolve (login, conflito com a base, PR sem checks). Você responde na conversa e ela segue. O agente não consegue responder no seu lugar nem largar a condução sozinho: os hooks barram.
- **Tudo fica em disco.** Fechou a conversa, caiu a luz, a janela compactou: `/entregar` de novo, sem tarefa, continua de onde parou. A pasta `passos/` da tarefa guarda cada pedido e cada resposta.

Para ele andar sem você, o comando `node harness/bin/maestro.mjs` precisa rodar sem pedir aprovação e com acesso à rede (ele faz `git fetch`, `git push` e usa o `gh`). No Cursor, isso é a allowlist de comandos; os detalhes de cada ferramenta estão no manual instalado, `harness/README.md`.

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
| Comandos | `/entregar`, `/fatia`… (`.agents/skills`) | `/entregar`, `/fatia`… (`.claude/commands`, que aponta para o mesmo roteiro) | `$entregar`, `$fatia`… (`.agents/skills`) |
| Subagente de cada passo do `/entregar` | `maestro-passo` (`.cursor/agents`) | `maestro-passo` (`.claude/agents`) | Subagente de uso geral |
| Revisor do passo a passo | Subagente `revisor` | Subagente `revisor` | Subagente comum seguindo `harness/roteiros/revisor.md` |
| Guarda de shell | `.cursor/hooks.json` | `.claude/settings.json` | `.codex/hooks.json` |
| Comando que pede confirmação | Pergunta a você | Pergunta a você | Bloqueia e manda chamar você |
| Fim de turno | Cobra o diff; no `/entregar`, manda o operador continuar | Igual | Igual |
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
  .agents/skills/       os sete roteiros de comando
  .cursor/              hooks, subagentes (maestro-passo, revisor) e os dois arquivos de padrão (vazios até o /mapear)
  .claude/, CLAUDE.md   adaptador do Claude Code (só com --com claude)
  .codex/               adaptador do Codex (só com --com codex)
  harness/
    bin/                a catraca (guarda, conferir, portoes, esperar-checks, hook) e o maestro (maestro*.mjs, plano, acoes, livro, recibo, fundo)
    roteiros/           o que cada subagente do /entregar recebe, e o roteiro do revisor
    config.json         repositórios, portões, regras do diff e opções do maestro
    modelos/            modelo de plano e de arquivo de padrão
    README.md           o manual de uso, que fica na raiz instalada
docs/exemplo.md         do setup à primeira entrega, passo a passo e no piloto automático
docs/prompt-de-setup.md texto para pedir a instalação a um agente
testes/                 instalador, hooks nos três formatos e conduções inteiras do maestro com subagentes simulados
```

Testes: `node --test testes/*.test.mjs modelo/harness/bin/testes/*.test.mjs` (Node 18+).

## Limites

- Não torna desvio impossível: reduz, expõe e cobra. A catraca pega o que cabe em regra sobre o diff; o resto depende da qualidade do mapa e do revisor humano, que continua sendo o último portão.
- O maestro garante o processo, não o gosto: ele prova que houve espelho, escopo, portões verdes, revisão de contexto limpo e checks verdes. Se o revisor simulado por um modelo pequeno deixar passar algo sutil, quem pega é o Sonar ou o seu colega.
- Os testes conduzem tarefas inteiras com subagentes simulados e um `gh` falso. Dentro do Cursor, do Claude Code e do Codex de verdade, quem valida é você: confira os hooks depois de instalar e acompanhe a primeira entrega.
- O `/entregar` depende de a ferramenta abrir subagentes. Sem eles, o operador faz os passos na própria conversa: funciona, mas a revisão deixa de ser de contexto limpo e a janela enche mais rápido.
- A guarda de shell barra o atalho óbvio; não é uma jaula. Hook que falha libera o comando em vez de travar o trabalho, e as outras camadas (portões, CI, Sonar, revisão) continuam valendo.
- Uma condução por raiz de cada vez.
- O agente não aprova, não faz merge, não instala dependência e não altera CI, Sonar ou lint. Isso é seu.
