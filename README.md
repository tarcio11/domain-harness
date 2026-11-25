# Domain harness

Um harness genérico ensina o agente a trabalhar bem. Este ensina o agente a trabalhar **como o seu projeto trabalha**, e a fazer isso sozinho: você passa a tarefa e recebe a PR aberta, revisada e com os checks verdes, sem responder pergunta no meio.

Foi feito para um projeto com backend e frontend em repositórios separados, abertos juntos numa pasta raiz, com PR revisada por humano e CI com Sonar no GitHub. Roda no agente do Cursor e nas extensões do Claude Code e do Codex.

## Dois comandos

| Comando | O que faz, do começo ao fim |
|---|---|
| `/entregar <tarefa>` | Entende o código (a entrega mais parecida que já existe e o fio dela, da entrada ao dado), planeja em fatias pequenas, implementa com um commit por fatia, revisa a PR linha por linha, testa na tela, abre a PR com a descrição, espera CI e Sonar, corrige o que vier vermelho e marca a PR como pronta. |
| `/revisar <branch ou PR>` | Para o que já está escrito: lê a branch linha por linha contra o padrão do projeto, refatora o que der para melhorar em commits pequenos, faz push e **acrescenta** o que fez à descrição da PR. |

Nenhum dos dois pede aprovação, opção A ou B, ou "posso continuar?". Quem decide é o modelo, por uma regra fixa, e o que ele decidiu fica escrito para você conferir na revisão:

- **Decisão.** Existe um caminho dentro do padrão do projeto: vai por ele. Não existe: faz o menor desvio e registra. As decisões saem na descrição da PR.
- **Pendência.** O que não fechou (uma fatia que não passa nos testes, um check que continua vermelho, um QA que não deu para fazer) não vira pergunta: a PR fica em rascunho, com a lista do que falta e o fim do log.
- **Bloqueio.** Só para o que nenhum modelo resolve: `gh` sem login ou sem rede, e mudança sua sem commit num repositório. Os dois são conferidos na primeira chamada, com você ainda na conversa, e não no meio do caminho.

Commits pequenos, no formato e no idioma do repositório (inglês, se você não disser outra coisa). Não existe orçamento de PR: a PR tem o tamanho que a tarefa pedir.

## As peças

| Peça | Onde fica na raiz | Papel |
|---|---|---|
| **Lei** | `AGENTS.md` | A filosofia, curta, sempre no contexto: entenda antes de escrever, o código existente é o padrão; fora do padrão, decida pelo padrão, registre e siga; escreva para quem revisa; pronto é provado. |
| **Mapa** | `.cursor/rules/padrao-backend.mdc`, `padrao-frontend.mdc` | O padrão de cada repositório, extraído do código: camadas, receitas, arquivos-espelho e convenções, cada afirmação com o arquivo que comprova. O maestro escreve na primeira condução; você lê e corrige quando quiser. |
| **Catraca** | hooks + `harness/bin/` + `harness/config.json` | O que máquina consegue verificar, máquina verifica: atalhos barrados, diff conferido, portões locais, checks da PR. |
| **Maestro** | `harness/bin/maestro.mjs` | O script que conduz os dois comandos: decide cada passo e confere cada resultado. |

## Como ele anda sozinho sem sair do trilho

A ideia é uma só: **o modelo opera e decide dentro de uma regra; o script conduz e confere.** O maestro é um programa sem modelo dentro, desenhado para modelos pequenos, que esquecem passos, param no meio e dizem "pronto" sem estar.

- **Primeiro ele entende o código.** Antes de qualquer plano, um subagente faz só o reconhecimento: a entrega mais parecida com o pedido, o fio dela da entrada ao dado, os modelos de dados e o espelho de cada peça. O script confere se todo arquivo citado existe, e esse mapa entra no plano.
- **O operador não pensa.** A conversa com você só roda `node harness/bin/maestro.mjs proximo` e faz o que a linha `AÇÃO:` manda. Ela não lê código, então a janela dela não enche.
- **Cada passo é um subagente de contexto limpo**, que recebe um arquivo de pedido com tudo: os parâmetros, o roteiro e o formato exato da resposta.
- **Nada vale pela palavra do modelo.** O executor diz "ok", e o maestro confere no git: algo mudou, sem verificação desligada, sem arquivo protegido, e os portões (lint, tipos, testes, build) verdes para exatamente aqueles arquivos. Depois um revisor que não escreveu o código compara com os espelhos.
- **Os limites continuam de pé.** Dependência nova, `package.json`, configuração de CI, Sonar ou lint e `eslint-disable` não entram por decisão de modelo. O que depender disso vira pendência.
- **Branch, commit, push e PR são do script.** Os hooks barram esses comandos para qualquer agente enquanto a condução está aberta.
- **O que não fecha não trava.** O maestro tenta de novo com o erro em mãos; se não sai, desfaz a tentativa, guarda o que foi tentado num patch e segue com o que já tem commit.
- **O que é seu fica como está.** Mudança sem commit que já estava num repositório é sua: ele não mexe e não começa por cima. Repositório que a tarefa não usa não é tocado. E nada do que ele tira de uma pasta se perde: vai para um patch.
- **A pasta da tarefa fica limpa.** Em `harness/tarefas/<id>/` só existe o `plano.md`, com o mapa, as fatias, as decisões e as pendências. Os arquivos que os subagentes trocam vivem numa pasta temporária, podada a cada passo e apagada no fim. O `/revisar` não deixa arquivo nenhum.
- **Tudo sobrevive à conversa.** Fechou a conversa, caiu a luz, a janela compactou: `/entregar` de novo, sem tarefa, continua de onde parou.

Para ele andar sem você, o comando `node harness/bin/maestro.mjs` precisa rodar sem pedir aprovação e com acesso à rede (ele faz `git fetch`, `git push` e usa o `gh`). No Cursor, isso é a allowlist de comandos; os detalhes de cada ferramenta estão no manual instalado, `harness/README.md`.

## Se você quiser ditar o ritmo

O passo a passo continua existindo, cada comando numa conversa: `/planejar` (o único que espera o seu "aprovado") → `/fatia` → `/qa` → `/pr`. `/conferir` audita uma branch sem alterar nada, e `/mapear` refaz o padrão de um repositório com você olhando. Os dois jeitos se misturam: um plano aprovado pelo `/planejar` é conduzido pelo `/entregar`, sem tarefa.

O exemplo completo, do setup à primeira entrega, está em [docs/exemplo.md](docs/exemplo.md).

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

Vindo da versão 0.3: rode o instalador com `--limpar` para apagar das pastas de tarefa o que ela deixava lá (`maestro.json`, `passos/`, `pr-*.md`). Os planos ficam. Chaves que saíram do `config.json` (`orcamento.pr`, `maestro.aprovarPlano`, `maestro.maximoDeFatias`, `maestro.exigirChecks`) são ignoradas.

Os arquivos de padrão e os planos descrevem o seu código. Ficam só na raiz do seu projeto; não suba para um repositório público.

## Em cada ferramenta

O julgamento é o mesmo nas três; muda como cada uma carrega as peças.

| | Agente do Cursor | Extensão do Claude Code | Extensão do Codex |
|---|---|---|---|
| Lei | `AGENTS.md` | `CLAUDE.md`, que importa `AGENTS.md` | `AGENTS.md` |
| Mapa | A regra entra sozinha quando o agente toca no repositório | Lido porque a lei e os roteiros mandam | Lido porque a lei e os roteiros mandam |
| Comandos | `/entregar`, `/revisar`… (`.agents/skills`) | `/entregar`, `/revisar`… (`.claude/commands`, que aponta para o mesmo roteiro) | `$entregar`, `$revisar`… (`.agents/skills`) |
| Subagente de cada passo do maestro | `maestro-passo` (`.cursor/agents`) | `maestro-passo` (`.claude/agents`) | Subagente de uso geral |
| Revisor do passo a passo | Subagente `revisor` | Subagente `revisor` | Subagente comum seguindo `harness/roteiros/revisor.md` |
| Guarda de shell | `.cursor/hooks.json` | `.claude/settings.json` | `.codex/hooks.json` |
| Comando que pede confirmação | Pergunta a você; com o maestro conduzindo, bloqueia | Igual | Bloqueia |
| Fim de turno | Cobra o diff; com o maestro conduzindo, manda o operador continuar | Igual | Igual |
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
  .agents/skills/       os oito roteiros de comando
  .cursor/              hooks, subagentes (maestro-passo, revisor) e os dois arquivos de padrão (vazios até o primeiro mapeamento)
  .claude/, CLAUDE.md   adaptador do Claude Code (só com --com claude)
  .codex/               adaptador do Codex (só com --com codex)
  harness/
    bin/                a catraca (guarda, conferir, portoes, esperar-checks, hook) e o maestro (maestro*.mjs, plano, acoes, livro, recibo, fundo)
    roteiros/           o que cada subagente do maestro recebe (mapear, reconhecer, planejar, criticar, executar, revisar linha por linha, QA, descrever) e o roteiro do revisor
    config.json         repositórios, portões, regras do diff e opções do maestro
    modelos/            modelo de plano e de arquivo de padrão
    README.md           o manual de uso, que fica na raiz instalada
docs/exemplo.md         do setup à primeira entrega: /entregar, /revisar e o passo a passo
docs/prompt-de-setup.md texto para pedir a instalação a um agente
testes/                 instalador, hooks nos três formatos e conduções inteiras do maestro com subagentes simulados
```

Testes: `node --test testes/*.test.mjs modelo/harness/bin/testes/*.test.mjs` (Node 18+).

## Limites

- **Ainda não foi exercitado dentro do Cursor, do Claude Code ou do Codex de verdade.** Os testes conduzem entregas e revisões inteiras com subagentes simulados, que erram de propósito, e um `gh` falso. Acompanhe a primeira condução e confira os hooks depois de instalar.
- Andar sozinho não é andar sem regra, e também não é garantia de gosto. O maestro prova que houve reconhecimento, espelho, portões verdes, revisão de contexto limpo e checks verdes. O que o revisor interno deixar passar, pegam o Sonar e o seu colega.
- Decisão registrada é para ser lida. O modelo escolhe pela regra, e a escolha pode não ser a sua: a seção "Decisões" da PR existe para você pegar isso na revisão, e não no meio do caminho.
- Os dois comandos dependem de a ferramenta abrir subagentes. Sem eles, o operador faz os passos na própria conversa: funciona, mas a revisão deixa de ser de contexto limpo e a janela enche mais rápido.
- Enquanto uma condução roda, os repositórios da tarefa são do maestro (branch, commit, limpeza da pasta). Não edite neles até o `FIM`; o que aparecer ali no meio do caminho ele guarda num patch e tira da pasta.
- A guarda de shell barra o atalho óbvio; não é uma jaula. Hook que falha libera o comando em vez de travar o trabalho, e as outras camadas (portões, CI, Sonar, revisão) continuam valendo.
- Uma condução por raiz de cada vez.
- O agente não aprova, não faz merge, não instala dependência e não altera CI, Sonar ou lint. Isso é seu.
