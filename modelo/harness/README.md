# Harness de domínio — manual de uso

Este é o manual do harness instalado nesta raiz. A visão geral, o exemplo completo e o prompt de setup estão no repositório de origem: https://github.com/tarcio11/domain-harness

| Peça | Onde | Papel |
|---|---|---|
| **Lei** | `AGENTS.md` | A filosofia, curta, sempre no contexto. |
| **Mapa** | `.cursor/rules/padrao-backend.mdc`, `padrao-frontend.mdc` | O padrão de cada repositório, gerado do código pelo `/mapear` e aprovado por você. |
| **Catraca** | hooks, `harness/bin/`, `harness/config.json` | O que máquina consegue verificar, máquina verifica. |
| **Roteiros** | `.agents/skills/`, `harness/roteiros/` | O passo a passo de cada comando, do revisor e de cada subagente do `/entregar`. |
| **Maestro** | `harness/bin/maestro.mjs` | O script que conduz o `/entregar`: decide cada passo e confere cada resultado. |

## Primeiro uso (uma vez por repositório)

1. `node harness/bin/doutor.mjs` lista o que falta.
2. Conversa nova: `/mapear backend` — se quiser, diga qual entrega é a referência do padrão.
3. Conversa nova: `/mapear frontend`.
4. Leia os dois arquivos de padrão e corrija o que estiver errado. **Depois da sua aprovação eles são a lei.** Enquanto disserem "NÃO MAPEADO", o agente não escreve código naquele repositório.

## Piloto automático: `/entregar`

Conversa nova, com o card inteiro e os critérios de aceite:

```
/entregar PARC-482 — Mostrar o sell-out mensal por canal na página do parceiro. …
```

Daí em diante a conversa (o **operador**) só roda `node harness/bin/maestro.mjs proximo` e faz o que a linha `AÇÃO:` manda. Quem decide e confere é o maestro. Cada passo é um subagente de contexto limpo, que recebe um arquivo de pedido com os parâmetros, o roteiro e o formato da resposta.

| Passo | Quem faz | O que o maestro confere antes de seguir |
|---|---|---|
| Plano | planejador | Formato; espelhos que existem e estão no git; escopo sem arquivo protegido; fatias em ordem; "Desvios aprovados" vazio |
| Crítica do plano | crítico | Parecer coerente. Reprovou: volta ao planejador com os achados |
| Portão do plano | maestro | Sem dúvida, sem desvio pendente e até `maximoDeFatias` fatias: segue sozinho. Senão, para e pergunta |
| Fatia | executor | Branch e histórico intactos; diff só dentro do escopo e sem bloqueio; nada mexido no outro repositório; portões verdes para exatamente aqueles arquivos (se o executor não rodou, o maestro roda) |
| Revisão da fatia | revisor | Nada mudou durante a revisão; veredito, contagem e achados concordam; cada arquivo novo comparado com um espelho que já existia |
| Commit | maestro | Só depois da revisão aprovada, com a mensagem que o executor escreveu. Hook do repositório recusou: volta ao executor |
| Conjunto (duas fatias ou mais) | revisor | O diff inteiro do repositório contra a base |
| QA na tela (frontend) | QA | Uma linha para cada critério de aceite; nenhum arquivo alterado. Falhou: correção no repositório apontado e QA de novo. Não deu para testar: a PR fica em rascunho |
| Descrição da PR | redator | Título e texto gravados. As provas quem acrescenta é o maestro |
| PR | maestro | Branch em dia com o remoto; diff inteiro sem bloqueio; portões verdes; push; PR em rascunho |
| Checks | maestro | Os checks do último commit, verdes em duas leituras afastadas. Vermelho: o resumo vira correção, commit novo, push e nova espera. Verde: a PR sai do rascunho |

Termina com `AÇÃO: FIM` e um relatório: link das PRs, commits, premissas do plano, o que foi decidido no caminho e o que falta de você (revisar e fazer o merge).

### Quando ele para

`AÇÃO: PARE` aparece com o motivo e o que responder. Você responde na própria conversa; o operador grava a resposta em `harness/tarefas/RESPOSTA.md` e roda `maestro.mjs retomar`. A resposta fica registrada no plano, em "Decisões do humano".

| Parada | Exemplo | O que responder |
|---|---|---|
| plano | Dúvida que muda o desenho, desvio pendente, plano grande, ou `aprovarPlano: "sempre"` | `aprovado`, ou o que mudar |
| desvio | O executor achou um dos 8 desvios da lei | A decisão: "opção A", "aprovado o desvio da opção B"… |
| falha | Um passo não fechou depois das tentativas; o push foi recusado; os portões não completam | Uma orientação, ou "tenta de novo" depois de resolver |
| humano | `gh` sem login, repositório não mapeado, PR sem checks, conflito com a base, plano ou harness alterado fora do maestro | Resolve e responde |

A resposta é sempre sua. O hook de shell barra o `retomar` no mesmo turno em que o PARE apareceu, para o agente não responder no seu lugar, e o `encerrar` pede a sua confirmação.

Enquanto ele espera você, a guarda de shell volta ao normal: dá para consertar algo à mão e responder dizendo o que fez.

### Comandos do maestro

```
/entregar                                # sem tarefa: continua a condução aberta, numa conversa nova
node harness/bin/maestro.mjs estado      # onde a condução está e os últimos passos
node harness/bin/maestro.mjs encerrar    # larga a condução; branches, commits e PRs ficam como estão
```

A pasta `harness/tarefas/<id>/` guarda tudo: `tarefa.md` (o que você pediu), `plano.md`, `plano.selado.md` (a versão aprovada, para comparar), `maestro.json` (o livro da condução), `passos/` (cada pedido e cada resposta, em ordem), `pr-<repo>.md` e `qa.md`.

Se você já tem um plano aprovado pelo `/planejar`, o `/entregar` sem tarefa adota esse plano e conduz a partir das fatias.

### Para ele andar sem você

O maestro faz `git fetch`, `git push` e usa o `gh`: o comando dele precisa de rede e não pode pedir confirmação a cada passo.

- **Cursor.** Ponha `node harness/bin/maestro.mjs` e `node harness/bin/portoes.mjs` na allowlist de comandos (Settings → Agents → Approvals & Execution). Sem isso o comando roda no sandbox, sem rede, e o maestro para logo no começo dizendo que não alcança o GitHub.
- **Claude Code.** O hook do harness já libera os scripts do próprio harness. Os outros comandos dos subagentes (testes, lint) seguem o seu modo de permissão.
- **Codex.** Valem as suas regras de aprovação.

Em qualquer uma: os subagentes editam arquivos e rodam testes. Se a ferramenta pedir confirmação para cada comando, o gargalo volta a ser você.

### Modelo mais forte só onde pesa

`maestro.subagentes`, no `config.json`, diz qual subagente faz cada papel: `planejar`, `criticar`, `executar`, `revisar`, `qa`, `descrever`. O que não estiver listado usa o `padrao`. Para escrever com um modelo rápido e julgar com um mais forte, copie `.cursor/agents/maestro-passo.md` para `maestro-forte.md`, troque o `name` e o `model`, e configure:

```json
"subagentes": { "padrao": "maestro-passo", "criticar": "maestro-forte", "revisar": "maestro-forte" }
```

## Passo a passo

| Passo | Comando | Conversa | Sai dali |
|---|---|---|---|
| Planejar | `/planejar <tarefa>` | nova | `harness/tarefas/<id>/plano.md`: critérios, contrato, fatias. Você responde "aprovado". |
| Implementar | `/fatia` | **uma nova por fatia** | Código pelo espelho, portões verdes, revisão fria, um commit. |
| Testar na tela | `/qa` | nova | `qa.md` com evidência. Falha vira fatia nova. |
| Abrir PR | `/pr backend`, depois `/pr frontend` | nova | PR no GitHub, checks verdes, pronta para o revisor. |
| Pós-revisão | `/pr <repo>` de novo | nova | Comentários tratados e proposta de regra nova. |
| Auditar o que já existe | `/conferir <repo> [PR]` | nova | Relatório de uma branch ou PR feita fora do harness. Não altera nada. |

O plano é o estado. Qualquer conversa pode ser fechada a qualquer momento: a próxima lê o plano e continua. É isso que mantém a janela de contexto folgada.

No Codex os comandos são chamados com `$` no lugar de `/` (`$fatia`, `$entregar`).

## O que a catraca verifica

| Quando | O quê | Efeito |
|---|---|---|
| Antes de cada comando de shell | `--no-verify`, `HUSKY=0`, `core.hooksPath`; push forçado; commit ou push em branch protegida; `gh pr merge` e aprovação; instalar, remover ou atualizar dependência | Bloqueia e explica ao agente |
| | `git reset --hard`, `git clean -f`, `git checkout .`, `git stash drop`, `git branch -D` | Pede a sua confirmação (no Codex, bloqueia e manda chamar você) |
| | Com uma condução do `/entregar` em andamento: commit, push, troca de branch, stash, reset e `gh pr` que altera | Bloqueia: são do maestro. O que pediria confirmação também é bloqueado, porque não há quem confirme |
| | `maestro.mjs retomar` no mesmo turno em que o PARE apareceu; `maestro.mjs encerrar` | Bloqueia o primeiro (a resposta é do humano) e pede a sua confirmação no segundo |
| Ao fim de cada turno | Bloqueios novos no diff ainda não commitado | Devolve a lista ao agente como próxima mensagem |
| | Com uma condução em andamento: o operador parou sem PARE nem FIM | Devolve "rode o maestro" ao operador |
| `portoes.mjs` (fatia e PR) | **Bloqueios:** verificação desligada (`eslint-disable`, `@ts-ignore`, `NOSONAR`, teste `.only`/`.skip`), `debugger`, arquivo protegido, importação que fura camada, arquivo fora do escopo | Reprova |
| | **Avisos:** diff acima do orçamento, comentário demais, reformatação sem mudança real, pasta nova, arquivo novo sem teste | Resolver ou explicar na PR. No `/entregar`, o revisor julga cada um |
| | Os portões do repositório (lint, tipos, testes, build), com `CI=true` | Reprova no primeiro vermelho, mostra só o fim do log. Verde: grava o recibo daquela árvore de arquivos |
| `esperar-checks.mjs` | Checks da PR (CI e Sonar) | Espera calado; no vermelho traz o log do passo que falhou e os apontamentos por linha, quando o check publica |
| Antes de a conversa ser compactada | — | Avisa você |

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
| `repos.<repo>.subir` | Comando e URL para rodar local (usado no QA) | `/mapear` |
| `convencoes` | Formato de branch, commit, título e modelo de PR; `prRascunho` | `/mapear` |
| `branchesProtegidas` | Onde o agente não commita nem dá push | padrão + `/mapear` |
| `protegidos` | Arquivos que só você altera | padrão |
| `proibido` | Texto que não pode aparecer em linha nova de código | padrão + `/mapear` |
| `camadas` | Quem não pode importar o quê: `{ "em", "naoImporta", "motivo" }` | `/mapear` |
| `pastasLivres` | Onde criar subpasta nova faz parte da receita | `/mapear` |
| `testes` | Como reconhecer teste e quais arquivos novos dispensam teste | padrão |
| `orcamento` | Tamanho máximo de fatia e de PR (arquivos, linhas sem contar testes, comentários) | padrão; ajuste ao gosto do time |
| `saida`, `checks` | Tamanho do log mostrado, tempo máximo de portão, ritmo da espera dos checks | padrão |
| `maestro` | Como o `/entregar` conduz (tabela abaixo) | padrão; ajuste ao gosto |

Opções de `maestro`. Instalação antiga, sem esse bloco, usa os padrões.

| Chave | Padrão | Para quê |
|---|---|---|
| `aprovarPlano` | `"auto"` | `"sempre"`: todo plano espera o seu "aprovado" antes de qualquer código |
| `maximoDeFatias` | `8` | Plano maior que isso espera você |
| `qa` | `"auto"` | `"humano"`: não tenta o QA na tela; a PR do frontend fica em rascunho para você testar |
| `exigirChecks` | `true` | `false`: PR sem nenhum check não para a condução |
| `tentativasPorPasso` | `2` | Novas tentativas de um passo cujo resultado não serviu |
| `voltasDeRevisao` | `2` | Reprovações seguidas (crítico, revisor, prova final) antes de chamar você |
| `voltasDeChecks` | `3` | Rodadas de correção de checks vermelhos |
| `ciclosDeQa` | `2` | Rodadas de correção de falhas do QA |
| `esperaPorChamadaSeg` | `25` | Quanto uma chamada do maestro espera por portões, commit, push ou checks antes de devolver `REPETIR`. Fica abaixo do tempo que as ferramentas dão a um comando |
| `esperaDeChecksMin` | `45` | Quanto esperar pelos checks de um push antes de chamar você |
| `subagentes` | `{ "padrao": "maestro-passo" }` | Qual subagente faz cada papel |

Mudar o `config.json` com uma condução aberta faz o maestro parar e perguntar se foi você: é o selo que impede um subagente de afrouxar um portão.

## Como o harness aprende

Toda vez que um revisor pegar algo fora do padrão, a parte C do `/pr` propõe a linha que faltava no arquivo de padrão ou a regra que faltava no `config.json`. Regra de texto (`proibido`, `camadas`) vale mais que instrução: instrução o modelo pode esquecer, a catraca não.

Quando o projeto mudar de padrão de propósito, rode `/mapear` de novo naquele repositório.

## Atualizar

`git pull` no clone do repositório do harness e rode o instalador de novo nesta raiz. Ele atualiza lei, roteiros e scripts, e não toca em `harness/config.json`, nos arquivos de padrão, em `harness/tarefas/` nem no que você editou (a versão nova vai para um arquivo ao lado, com final `.novo`). Não atualize com uma condução aberta.

Os arquivos de padrão e os planos descrevem o seu código. Se for versionar esta raiz, use um repositório privado do time.

## Com outros plugins

A lei abre dizendo que o padrão do projeto vence qualquer skill ou modo genérico. Ainda assim, não deixe um modo de outro plugin fixado nesta pasta enquanto usa o fluxo do harness: são dois roteiros disputando a mesma conversa e a mesma janela.

Uma ideia que vale trazer: revisão por um modelo diferente do que escreveu. No `/entregar`, é a opção `maestro.subagentes`, acima. No passo a passo, troque `model: inherit` em `.cursor/agents/revisor.md` (ou `.claude/agents/revisor.md`) pelo modelo que você quer como revisor.

## Se algo não funcionar

- **Hooks não aparecem ou não disparam.** No Cursor, veja a aba Hooks em Customize e o canal de saída "Hooks"; a pasta precisa estar confiável. No Claude Code, `/hooks` lista o que foi carregado. No Codex, `/hooks` mostra o que falta revisar e confiar; se nada aparecer e a raiz não for um repositório git, rode `git init` nela.
- **`node` não encontrado pelo hook.** Comum com nvm quando o editor abre pelo ícone. Abra o editor pelo terminal ou troque `node` pelo caminho completo (`which node`) no arquivo de hooks da ferramenta.
- **A guarda barrou algo legítimo.** Rode você mesmo no terminal: a guarda só vale para o agente. Se for recorrente, ajuste `harness/bin/guarda.mjs` e acrescente o caso em `harness/bin/testes/guarda.test.mjs`.
- **Falso positivo no diff.** Ajuste `proibido`, `protegidos`, `testes.dispensados` ou `pastasLivres` no `config.json`.
- **A mesma mensagem da guarda aparece duas vezes no Cursor.** O Cursor também carrega os hooks de `.claude/settings.json`. É inofensivo; para rodar uma vez só, desligue a importação de configurações de terceiros nas configurações do Cursor.
- **O agente não usa o navegador no QA.** Ative o navegador nas configurações do Cursor e, em empresa com lista de origens, libere `http://localhost:<porta>`. No `/entregar`, sem navegador o QA responde "bloqueado" e a PR fica em rascunho para você testar.
- **O `/entregar` parou no meio, sem PARE nem FIM.** O operador encerrou o turno antes da hora. Mande `/entregar` de novo, sem tarefa. Com os hooks ativos, o de fim de turno já manda continuar sozinho.
- **O maestro parou dizendo que não alcança o GitHub.** O comando dele está rodando sem rede (sandbox) ou o `gh` não está logado. Veja "Para ele andar sem você" e rode `gh auth status`.
- **Um agente foi barrado ao tentar commit, push ou PR.** Há uma condução aberta, e durante ela isso é do maestro. `node harness/bin/maestro.mjs estado` mostra qual; `encerrar` larga.
- **`AÇÃO: ESPERAR` se repete.** O subagente terminou sem gravar o resultado e o operador não declarou isso. Rode `node harness/bin/maestro.mjs proximo --sem-resultado`: o maestro refaz o passo.
- **Quero ver o que ele fez.** `harness/tarefas/<id>/passos/` tem cada pedido (`.pedido.md`) e cada resposta, numerados na ordem.

## O que o harness não faz

- Não torna desvio impossível: reduz, expõe e cobra. A catraca pega o que cabe em regra sobre o diff; o resto depende da qualidade do mapa e do revisor humano, que continua sendo o último portão.
- O maestro garante o processo (espelho, escopo, portões, revisão de contexto limpo, checks), não o gosto. O que um revisor de modelo pequeno deixar passar, pegam o Sonar e o seu colega.
- Hook que falha libera o comando em vez de travar o trabalho; as outras camadas (portões, CI, Sonar, revisão) continuam valendo.
- Conduz uma tarefa de cada vez por raiz.
- Não aprova, não faz merge, não instala dependência e não altera CI, Sonar ou lint. Isso é seu.
