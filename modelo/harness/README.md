# Harness de domínio — manual de uso

Este é o manual do harness instalado nesta raiz. A visão geral, o exemplo completo e o prompt de setup estão no repositório de origem: https://github.com/tarcio11/domain-harness

| Peça | Onde | Papel |
|---|---|---|
| **Lei** | `AGENTS.md` | A filosofia, curta, sempre no contexto. |
| **Mapa** | `.cursor/rules/padrao-backend.mdc`, `padrao-frontend.mdc` | O padrão de cada repositório, gerado do código pelo `/mapear` e aprovado por você. |
| **Catraca** | hooks, `harness/bin/`, `harness/config.json` | O que máquina consegue verificar, máquina verifica. |
| **Roteiros** | `.agents/skills/`, `harness/roteiros/` | O passo a passo de cada comando e do revisor. |

## Primeiro uso (uma vez por repositório)

1. `node harness/bin/doutor.mjs` lista o que falta.
2. Conversa nova: `/mapear backend` — se quiser, diga qual entrega é a referência do padrão.
3. Conversa nova: `/mapear frontend`.
4. Leia os dois arquivos de padrão e corrija o que estiver errado. **Depois da sua aprovação eles são a lei.** Enquanto disserem "NÃO MAPEADO", o agente não escreve código naquele repositório.

## Dia a dia

| Passo | Comando | Conversa | Sai dali |
|---|---|---|---|
| Planejar | `/planejar <tarefa>` | nova | `harness/tarefas/<id>/plano.md`: critérios, contrato, fatias. Você responde "aprovado". |
| Implementar | `/fatia` | **uma nova por fatia** | Código pelo espelho, portões verdes, revisão fria, um commit. |
| Testar na tela | `/qa` | nova | `qa.md` com evidência. Falha vira fatia nova. |
| Abrir PR | `/pr backend`, depois `/pr frontend` | nova | PR no GitHub, checks verdes, pronta para o revisor. |
| Pós-revisão | `/pr <repo>` de novo | nova | Comentários tratados e proposta de regra nova. |
| Auditar o que já existe | `/conferir <repo> [PR]` | nova | Relatório de uma branch ou PR feita fora do harness. Não altera nada. |

O plano é o estado. Qualquer conversa pode ser fechada a qualquer momento: a próxima lê o plano e continua. É isso que mantém a janela de contexto folgada.

No Codex os comandos são chamados com `$` no lugar de `/` (`$fatia`).

## O que a catraca verifica

| Quando | O quê | Efeito |
|---|---|---|
| Antes de cada comando de shell | `--no-verify`, `HUSKY=0`, `core.hooksPath`; push forçado; commit ou push em branch protegida; `gh pr merge` e aprovação; instalar, remover ou atualizar dependência | Bloqueia e explica ao agente |
| | `git reset --hard`, `git clean -f`, `git checkout .`, `git stash drop`, `git branch -D` | Pede a sua confirmação (no Codex, bloqueia e manda chamar você) |
| Ao fim de cada turno | Bloqueios novos no diff ainda não commitado | Devolve a lista ao agente como próxima mensagem |
| `portoes.mjs` (fatia e PR) | **Bloqueios:** verificação desligada (`eslint-disable`, `@ts-ignore`, `NOSONAR`, teste `.only`/`.skip`), `debugger`, arquivo protegido, importação que fura camada, arquivo fora do escopo | Reprova |
| | **Avisos:** diff acima do orçamento, comentário demais, reformatação sem mudança real, pasta nova, arquivo novo sem teste | Resolver ou explicar na PR |
| | Os portões do repositório (lint, tipos, testes, build), com `CI=true` | Reprova no primeiro vermelho, mostra só o fim do log |
| `esperar-checks.mjs` | Checks da PR (CI e Sonar) | Espera calado; no vermelho traz o log do passo que falhou e os apontamentos por linha, quando o check publica |
| Antes de a conversa ser compactada | — | Avisa você de que a fatia ficou grande |

Só linha **adicionada** é julgada; código legado não gera bloqueio. Desvio que você aprovou entra na seção "Desvios aprovados" do plano, com o caminho entre crases, e a catraca passa a mostrar como `[liberado]`.

Rodar à mão:

```
node harness/bin/portoes.mjs backend                   # diff + portões da fatia em andamento
node harness/bin/portoes.mjs backend --pr              # a branch inteira, contra a base
node harness/bin/portoes.mjs frontend --so-diff        # só a conferência do diff
node harness/bin/esperar-checks.mjs backend            # checks da PR da branch atual
node --test harness/bin/testes/*.test.mjs              # testes da própria catraca (Node 18+)
```

## `harness/config.json`

| Chave | Para quê | Quem preenche |
|---|---|---|
| `repos.<repo>.dir`, `.base` | Pasta do repositório e branch base | instalador e `/mapear` |
| `repos.<repo>.portoes` | Os mesmos comandos que o CI roda na PR, na ordem | `/mapear` |
| `repos.<repo>.subir` | Comando e URL para rodar local (usado no `/qa`) | `/mapear` |
| `convencoes` | Formato de branch, commit, título e modelo de PR; `prRascunho` | `/mapear` |
| `branchesProtegidas` | Onde o agente não commita nem dá push | padrão + `/mapear` |
| `protegidos` | Arquivos que só você altera | padrão |
| `proibido` | Texto que não pode aparecer em linha nova de código | padrão + `/mapear` |
| `camadas` | Quem não pode importar o quê: `{ "em", "naoImporta", "motivo" }` | `/mapear` |
| `pastasLivres` | Onde criar subpasta nova faz parte da receita | `/mapear` |
| `testes` | Como reconhecer teste e quais arquivos novos dispensam teste | padrão |
| `orcamento` | Tamanho máximo de fatia e de PR (arquivos, linhas sem contar testes, comentários) | padrão; ajuste ao gosto do time |
| `saida`, `checks` | Tamanho do log mostrado, tempo máximo de portão, ritmo da espera dos checks | padrão |

## Como o harness aprende

Toda vez que um revisor pegar algo fora do padrão, a parte C do `/pr` propõe a linha que faltava no arquivo de padrão ou a regra que faltava no `config.json`. Regra de texto (`proibido`, `camadas`) vale mais que instrução: instrução o modelo pode esquecer, a catraca não.

Quando o projeto mudar de padrão de propósito, rode `/mapear` de novo naquele repositório.

## Atualizar

`git pull` no clone do repositório do harness e rode o instalador de novo nesta raiz. Ele atualiza lei, roteiros e scripts, e não toca em `harness/config.json`, nos arquivos de padrão, em `harness/tarefas/` nem no que você editou (a versão nova vai para um arquivo ao lado, com final `.novo`).

Os arquivos de padrão e os planos descrevem o seu código. Se for versionar esta raiz, use um repositório privado do time.

## Com outros plugins

A lei abre dizendo que o padrão do projeto vence qualquer skill ou modo genérico. Ainda assim, não deixe um modo de outro plugin fixado nesta pasta enquanto usa o fluxo do harness: são dois roteiros disputando a mesma conversa e a mesma janela.

Uma ideia que vale trazer: revisão por um modelo diferente do que escreveu. Troque `model: inherit` em `.cursor/agents/revisor.md` (ou `.claude/agents/revisor.md`) pelo modelo que você quer como revisor.

## Se algo não funcionar

- **Hooks não aparecem ou não disparam.** No Cursor, veja a aba Hooks em Customize e o canal de saída "Hooks"; a pasta precisa estar confiável. No Claude Code, `/hooks` lista o que foi carregado. No Codex, `/hooks` mostra o que falta revisar e confiar; se nada aparecer e a raiz não for um repositório git, rode `git init` nela.
- **`node` não encontrado pelo hook.** Comum com nvm quando o editor abre pelo ícone. Abra o editor pelo terminal ou troque `node` pelo caminho completo (`which node`) no arquivo de hooks da ferramenta.
- **A guarda barrou algo legítimo.** Rode você mesmo no terminal: a guarda só vale para o agente. Se for recorrente, ajuste `harness/bin/guarda.mjs` e acrescente o caso em `harness/bin/testes/guarda.test.mjs`.
- **Falso positivo no diff.** Ajuste `proibido`, `protegidos`, `testes.dispensados` ou `pastasLivres` no `config.json`.
- **A mesma mensagem da guarda aparece duas vezes no Cursor.** O Cursor também carrega os hooks de `.claude/settings.json`. É inofensivo; para rodar uma vez só, desligue a importação de configurações de terceiros nas configurações do Cursor.
- **O agente não usa o navegador no `/qa`.** Ative o navegador nas configurações do Cursor e, em empresa com lista de origens, libere `http://localhost:<porta>`.

## O que o harness não faz

- Não torna desvio impossível: reduz, expõe e cobra. A catraca pega o que cabe em regra sobre o diff; o resto depende da qualidade do mapa e do revisor humano, que continua sendo o último portão.
- Hook que falha libera o comando em vez de travar o trabalho; as outras camadas (portões, CI, Sonar, revisão) continuam valendo.
- Não aprova, não faz merge, não instala dependência e não altera CI, Sonar ou lint. Isso é seu.
