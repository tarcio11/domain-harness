# Harness de domínio — manual de uso

Este é o manual do harness instalado nesta raiz. A visão geral, o exemplo completo e o prompt de setup estão no repositório de origem: https://github.com/tarcio11/domain-harness

| Peça | Onde | Papel |
|---|---|---|
| **Lei** | `AGENTS.md` | A filosofia, curta, sempre no contexto. |
| **Mapa** | `.cursor/rules/padrao-backend.mdc`, `padrao-frontend.mdc` | O padrão de cada repositório, extraído do código. |
| **Catraca** | hooks, `harness/bin/`, `harness/config.json` | O que máquina consegue verificar, máquina verifica. |
| **Roteiros** | `.agents/skills/`, `harness/roteiros/` | O passo a passo de cada comando e de cada subagente do maestro. |
| **Maestro** | `harness/bin/maestro.mjs` | O script que conduz o `/entregar` e o `/revisar`: decide cada passo e confere cada resultado. |

## Os dois comandos que andam sozinhos

Conversa nova, e mais nada:

```
/entregar PARC-482 — Mostrar o sell-out mensal por canal na página do parceiro. …
/revisar feature/PARC-455-pedidos
```

`/entregar <tarefa>` leva do pedido à PR pronta para revisão. `/revisar <branch ou PR>` pega uma branch que já existe, lê linha por linha, ajusta em commits pequenos, faz push e acrescenta o que fez à descrição da PR. No `/revisar` você pode dizer só o nome da branch, o número ou o link da PR, ou nada (vale a branch em que os repositórios estão); o que vier a mais no pedido ("de olho no tratamento de erro") chega aos revisores.

Daí em diante a conversa (o **operador**) só roda `node harness/bin/maestro.mjs proximo` e faz o que a linha `AÇÃO:` manda. Quem decide a ordem e confere é o maestro. Cada passo é um subagente de contexto limpo, que recebe um arquivo de pedido com os parâmetros, o roteiro e o formato da resposta.

| Passo | Quem faz | O que o maestro confere antes de seguir |
|---|---|---|
| Mapear (só o repositório que ainda não foi mapeado) | mapeador | A regra de padrão escrita, portões configurados, `config.json` válido |
| Reconhecer o código | reconhecedor | O mapa tem a entrega mais parecida, o fio dela da entrada ao dado e o espelho de cada peça; todo arquivo citado existe |
| Plano (`/entregar`) | planejador | Formato; espelhos que existem e estão no git; escopo sem arquivo protegido; fatias em ordem. O mapa entra no plano |
| Crítica do plano (`/entregar`) | crítico | Parecer coerente. Reprovou: volta ao planejador com os achados |
| Fatia (`/entregar`) | executor | Branch e histórico intactos; diff sem bloqueio e dentro do escopo (ou com o extra declarado); portões verdes para exatamente aqueles arquivos (se o executor não rodou, o maestro roda) |
| Revisão da fatia | revisor | Nada mudou durante a revisão; veredito, contagem e achados concordam; cada arquivo novo comparado com um arquivo que já existia |
| Commit | maestro | Só depois da revisão, com a mensagem que o executor escreveu. Hook do repositório recusou: volta ao executor |
| Revisão linha por linha | um revisor por lote do diff | Parecer coerente. Cada lote com achado vira um ajuste: executor, portões, revisor, commit pequeno |
| QA na tela (`/entregar`, frontend) | QA | Uma linha para cada critério de aceite. Falhou: correção no repositório apontado e QA de novo |
| Descrição da PR | redator | Título e texto gravados. Provas, decisões e pendências quem acrescenta é o maestro |
| PR | maestro | Branch em dia com o remoto; diff sem bloqueio; portões verdes; push; PR em rascunho |
| Checks | maestro | Os checks do último commit, verdes em duas leituras afastadas. Vermelho: o resumo vira correção, commit novo, push e nova espera. Verde: a PR sai do rascunho |

Termina com `AÇÃO: FIM` e um relatório: link das PRs, commits, o que foi decidido, o que ficou pendente e o que falta de você.

No `/revisar`, a PR que já existe guarda a descrição e o estado de rascunho dela: o maestro acrescenta uma seção datada no fim e não tira nem põe em rascunho. Sem PR aberta, ele abre uma, em rascunho.

### Ele não pergunta: decisão, pendência e bloqueio

Ninguém aprova plano, escolhe opção A ou B nem responde dúvida. Três coisas acontecem no lugar:

| | Quando | Onde aparece |
|---|---|---|
| **Decisão** | A tarefa não cabe no que o projeto já faz. O modelo segue a regra da lei (seção 2): caminho dentro do padrão; sem ele, o menor desvio. Também entra aqui o que o revisor interno ainda apontava depois das rodadas ("ponto em aberto") | Na descrição da PR, em "Decisões do agente"; no plano; no relatório |
| **Pendência** | Algo não fechou: fatia que não passa nos portões depois das tentativas, checks que continuam vermelhos ou não terminam, QA que falhou ou não deu para fazer, conflito com a base, algo que dependia de um limite da lei | Na descrição da PR, em "Pendências", com o fim do log. **A PR fica em rascunho** |
| **Bloqueio** (`AÇÃO: PARE`) | Só o que nenhum modelo resolve: `gh` sem login ou sem rede, mudança sua sem commit num repositório, branch local e remota que se separaram, push recusado, instalação quebrada | Na conversa. Você resolve e manda `/entregar`, sem tarefa |

Os bloqueios de ambiente e de mudança sem commit aparecem na primeira chamada, com você ainda na conversa, e não no meio do caminho. Numa entrega, o maestro ainda não sabe em quais repositórios vai mexer: ele avisa de todos os que têm mudança sua, e você pode só mandar `/entregar` de novo se a tarefa não passa por ali. Se o plano precisar de um deles, o bloqueio volta antes da primeira fatia.

Quando uma fatia não fecha, o maestro desfaz o que ela deixou, guarda a tentativa num patch (em `harness/.maestro/descartados/<tarefa>/`) e publica o que já tinha commit. As fatias seguintes ficam de fora, porque dependem dela.

Os limites da lei não caem por decisão de modelo: dependência nova, arquivo protegido (`package.json`, CI, Sonar, lint, TypeScript, `.env`), importação que a camada não pode fazer, interface fora do design system e verificação desligada. O que depender de um deles vira pendência. Para liberar um, escreva você mesmo uma linha em "Desvios aprovados" do plano, com o caminho entre crases (isso vale no passo a passo, em que você escreve o plano).

### Onde as coisas ficam

| Pasta | O que tem | Quem lê |
|---|---|---|
| `harness/tarefas/<id>/plano.md` | **Só o plano**: objetivo, critérios, contrato, mapa do código, fatias, premissas, decisões no caminho, pendências e estado. O `/revisar` não cria nada aqui | Você |
| `harness/trabalho/` | Os pedidos e as respostas dos subagentes. Cada arquivo sai da pasta assim que nenhum passo precisa mais dele, e a pasta some quando a condução termina | Os subagentes |
| `harness/.maestro/conducao/` | O livro da condução em curso, a cópia selada do plano e o texto da PR. Uma condução nova começa de pasta vazia | O maestro |
| `harness/.maestro/descartados/<tarefa>/` | Em patch, tudo o que o maestro tirou de um repositório: a tentativa que não fechou, a sobra de um passo. Ficam as das cinco últimas tarefas | Você, se quiser recuperar algo |

Para depurar o próprio harness, `"guardarPassos": true` no bloco `maestro` do `config.json` mantém todos os arquivos de `harness/trabalho/`.

### Enquanto ele trabalha

Os repositórios da tarefa ficam com o maestro até o `FIM`: ele troca de branch, faz commit e limpa a pasta entre um passo e outro. Não edite arquivos neles enquanto a condução roda. A regra que ele segue:

- **O que estava sem commit quando você passou a vez é seu.** Vale para o momento em que você manda o comando e para quando libera um bloqueio (inclusive o que você mexeu durante a pausa). Ele não mexe nisso e não começa por cima: bloqueia e espera.
- **Num repositório da tarefa, o que aparecer depois sai do caminho.** Pode ser sobra de um subagente ou edição sua com a condução em andamento; ele não tem como saber. Na hora em que precisa do repositório, guarda tudo num patch em `harness/.maestro/descartados/<tarefa>/` e segue, com um aviso no relatório final.
- **Repositório que a tarefa não usa não é tocado.** Uma entrega só de backend não mexe no frontend, e você pode trabalhar nele. Se algo mudou ali sem estar lá quando você passou a vez, o relatório final avisa, para o caso de ter sido um subagente.

A conversa pode ser fechada: o estado está no disco. Outra tarefa na mesma raiz, só depois do `FIM` (ou de `encerrar`).

### Comandos do maestro

```
/entregar                                # sem tarefa: continua a condução aberta (entrega ou revisão), numa conversa nova
node harness/bin/maestro.mjs estado      # onde a condução está e os últimos passos
node harness/bin/maestro.mjs encerrar    # larga a condução; branches, commits e PRs ficam como estão
```

Uma condução bloqueada, ou sem chamada há mais de dez minutos, não segura a próxima: `/entregar <outra tarefa>` ou `/revisar <branch>` começa por cima dela, sem você precisar encerrar.

Se você já tem um plano aprovado pelo `/planejar`, o `/entregar` sem tarefa adota esse plano e conduz a partir das fatias.

### Para ele andar sem você

O maestro faz `git fetch`, `git push` e usa o `gh`: o comando dele precisa de rede e não pode pedir confirmação a cada passo.

- **Cursor.** Ponha `node harness/bin/maestro.mjs` e `node harness/bin/portoes.mjs` na allowlist de comandos (Settings → Agents → Approvals & Execution). Sem isso o comando roda no sandbox, sem rede, e o maestro bloqueia logo no começo dizendo que não alcança o GitHub.
- **Claude Code.** O hook do harness já libera os scripts do próprio harness. Os outros comandos dos subagentes (testes, lint) seguem o seu modo de permissão.
- **Codex.** Valem as suas regras de aprovação.

Em qualquer uma: os subagentes editam arquivos e rodam testes. Se a ferramenta pedir confirmação para cada comando, o gargalo volta a ser você.

### Modelo mais forte só onde pesa

`maestro.subagentes`, no `config.json`, diz qual subagente faz cada papel: `mapear`, `reconhecer`, `planejar`, `criticar`, `executar`, `revisar`, `revisarPr`, `qa`, `descrever`. O que não estiver listado usa o `padrao`. Para escrever com um modelo rápido e entender e julgar com um mais forte, copie `.cursor/agents/maestro-passo.md` para `maestro-forte.md`, troque o `name` e o `model`, e configure:

```json
"subagentes": { "padrao": "maestro-passo", "reconhecer": "maestro-forte", "revisar": "maestro-forte", "revisarPr": "maestro-forte" }
```

## Passo a passo

Para quando você quer ditar o ritmo. Cada comando numa conversa nova:

| Passo | Comando | Sai dali |
|---|---|---|
| Planejar | `/planejar <tarefa>` | `harness/tarefas/<id>/plano.md`, com o mapa do código e as fatias. É o único comando que espera o seu "aprovado" |
| Implementar | `/fatia`, **uma por conversa** | Teste primeiro, código pelo espelho, portões verdes, revisão fria, um commit |
| Testar na tela | `/qa` | A seção "QA na tela" do plano, com a evidência. Falha vira fatia nova |
| Abrir PR | `/pr backend`, depois `/pr frontend` | PR no GitHub, checks verdes, pronta para o revisor |
| Pós-revisão | `/pr <repo>` de novo | Comentários tratados e proposta de regra nova |
| Auditar sem alterar | `/conferir <repo> [PR]` | Relatório de uma branch ou PR, na conversa. Para corrigir o que ele achar: `/revisar <branch>` |
| Refazer o padrão | `/mapear <repo>` | O arquivo de padrão e os portões, com você lendo antes de valer |

O plano é o estado, e é o único arquivo da pasta da tarefa. Qualquer conversa pode ser fechada a qualquer momento: a próxima lê o plano e continua.

No Codex os comandos são chamados com `$` no lugar de `/` (`$fatia`, `$entregar`).

## O que a catraca verifica

| Quando | O quê | Efeito |
|---|---|---|
| Antes de cada comando de shell | `--no-verify`, `HUSKY=0`, `core.hooksPath`; push forçado; commit ou push em branch protegida; `gh pr merge` e aprovação; instalar, remover ou atualizar dependência | Bloqueia e explica ao agente |
| | `git reset --hard`, `git clean -f`, `git checkout .`, `git stash drop`, `git branch -D` | Pede a sua confirmação (no Codex, bloqueia e manda chamar você) |
| | Com o maestro conduzindo: commit, push, troca de branch, stash, reset e `gh pr` que altera | Bloqueia: são do maestro. O que pediria confirmação também é bloqueado, porque não há quem confirme |
| | `maestro.mjs retomar` no mesmo turno em que o PARE apareceu; `maestro.mjs encerrar` | Bloqueia o primeiro (quem libera um bloqueio é você) e pede a sua confirmação no segundo |
| Ao fim de cada turno | Bloqueios novos no diff ainda não commitado | Devolve a lista ao agente como próxima mensagem |
| | Com o maestro conduzindo: o operador parou sem PARE nem FIM | Devolve "rode o maestro" ao operador |
| `portoes.mjs` | **Bloqueios:** verificação desligada (`eslint-disable`, `@ts-ignore`, `NOSONAR`, teste `.only`/`.skip`), `debugger`, arquivo protegido, importação que fura camada, arquivo fora do escopo sem declarar | Reprova |
| | **Avisos:** fatia maior que o alvo, comentário demais, reformatação sem mudança real, pasta nova, arquivo novo sem teste | Não reprovam. Vão para o revisor, que julga cada um; tamanho nunca é achado |
| | Os portões do repositório (lint, tipos, testes, build), com `CI=true` | Reprova no primeiro vermelho, mostra só o fim do log. Verde: grava o recibo daquela árvore de arquivos |
| `esperar-checks.mjs` | Checks da PR (CI e Sonar) | Espera calado; no vermelho traz o log do passo que falhou e os apontamentos por linha, quando o check publica |
| Antes de a conversa ser compactada | — | Avisa você |

Só linha **adicionada** é julgada; código legado não gera bloqueio. Não existe orçamento de PR: o tamanho do diff inteiro não gera aviso nem bloqueio.

Rodar à mão:

```
node harness/bin/portoes.mjs backend                   # diff + portões do que está na pasta
node harness/bin/portoes.mjs backend --pr              # a branch inteira, contra a base
node harness/bin/portoes.mjs frontend --so-diff        # só a conferência do diff
node harness/bin/esperar-checks.mjs backend            # checks da PR da branch atual
node --test harness/bin/testes/*.test.mjs              # testes da própria catraca (Node 18+)
```

## `harness/config.json`

| Chave | Para quê | Quem preenche |
|---|---|---|
| `repos.<repo>.dir`, `.base` | Pasta do repositório e branch base | instalador e mapeamento |
| `repos.<repo>.portoes` | Os mesmos comandos que o CI roda na PR, na ordem | mapeamento |
| `repos.<repo>.subir` | Comando e URL para rodar local (usado no QA) | mapeamento |
| `convencoes` | Formato de branch, commit, título e modelo de PR; `prRascunho`; `idioma` dos commits e do título da PR (padrão `"en"`); `idiomaDaPr`, se a descrição da PR é em outro idioma (`"pt"`) | mapeamento; ajuste ao time |
| `branchesProtegidas` | Onde o agente não commita nem dá push | padrão + mapeamento |
| `protegidos` | Arquivos que só você altera | padrão |
| `proibido` | Texto que não pode aparecer em linha nova de código | padrão + mapeamento |
| `camadas` | Quem não pode importar o quê: `{ "em", "naoImporta", "motivo" }` | mapeamento |
| `pastasLivres` | Onde criar subpasta nova faz parte da receita | mapeamento |
| `testes` | Como reconhecer teste e quais arquivos novos dispensam teste | padrão |
| `orcamento.fatia` | O alvo de tamanho de uma fatia (arquivos, linhas sem contar testes, comentários). Orienta quem planeja; não bloqueia | padrão; ajuste ao gosto do time |
| `saida`, `checks` | Tamanho do log mostrado, tempo máximo de portão, ritmo da espera dos checks | padrão |
| `maestro` | Como o maestro conduz (tabela abaixo) | padrão; ajuste ao gosto |

Opções de `maestro`. O que não estiver no seu arquivo usa o padrão.

| Chave | Padrão | Para quê |
|---|---|---|
| `qa` | `"auto"` | `"humano"`: não tenta o QA na tela; a PR do frontend fica em rascunho, com a pendência de você testar |
| `tentativasPorPasso` | `2` | Novas tentativas de um passo cujo resultado não serviu |
| `voltasDeRevisao` | `2` | Reprovações seguidas (crítico, revisor, prova final) antes de seguir com o ponto em aberto ou a pendência |
| `voltasDeChecks` | `3` | Rodadas de correção de checks vermelhos |
| `ciclosDeQa` | `2` | Rodadas de correção de falhas do QA |
| `linhasPorLote`, `arquivosPorLote` | `400`, `8` | Tamanho de cada lote da revisão linha por linha, para caber numa janela de contexto |
| `maximoDeLotes` | `20` | Teto de lotes por repositório numa revisão; o que passar disso fica avisado no relatório |
| `esperaPorChamadaSeg` | `25` | Quanto uma chamada do maestro espera por portões, commit, push ou checks antes de devolver `REPETIR`. Fica abaixo do tempo que as ferramentas dão a um comando |
| `esperaDeChecksMin` | `45` | Quanto esperar pelos checks de um push antes de registrar a pendência e encerrar |
| `guardarPassos` | `false` | `true`: não poda `harness/trabalho/`. Só para depurar o harness |
| `subagentes` | `{ "padrao": "maestro-passo" }` | Qual subagente faz cada papel |

Mudar o `config.json` ou o padrão mapeado com uma condução aberta não para nada: o maestro segue com o arquivo novo e avisa da mudança no relatório final. O plano aprovado, se alguém mexer, volta sozinho à versão aprovada.

## Como o harness aprende

Toda vez que um revisor humano pegar algo fora do padrão, a parte C do `/pr` propõe a linha que faltava no arquivo de padrão ou a regra que faltava no `config.json`. Regra de texto (`proibido`, `camadas`) vale mais que instrução: instrução o modelo pode esquecer, a catraca não.

O mapeamento que o maestro faz sozinho, na primeira condução, não passou pelos seus olhos. Leia `.cursor/rules/padrao-<repo>.mdc` quando puder e corrija: é a lei que os agentes seguem. Quando o projeto mudar de padrão de propósito, rode `/mapear` de novo naquele repositório.

## Atualizar

`git pull` no clone do repositório do harness e rode o instalador de novo nesta raiz. Ele atualiza lei, roteiros e scripts, e não toca em `harness/config.json`, nos arquivos de padrão, em `harness/tarefas/` nem no que você editou (a versão nova vai para um arquivo ao lado, com final `.novo`). Não atualize com uma condução em andamento.

Vindo da versão 0.3, rode o instalador com `--limpar`: ele apaga das pastas de tarefa os arquivos de condução que aquela versão deixava lá (`maestro.json`, `passos/`, `pr-*.md`, `plano.selado.md`, `tarefa.md`). Os planos ficam.

Os arquivos de padrão e os planos descrevem o seu código. Se for versionar esta raiz, use um repositório privado do time.

## Com outros plugins

A lei abre dizendo que o padrão do projeto vence qualquer skill ou modo genérico. Ainda assim, não deixe um modo de outro plugin fixado nesta pasta enquanto usa o fluxo do harness: são dois roteiros disputando a mesma conversa e a mesma janela.

## Se algo não funcionar

- **Hooks não aparecem ou não disparam.** No Cursor, veja a aba Hooks em Customize e o canal de saída "Hooks"; a pasta precisa estar confiável. No Claude Code, `/hooks` lista o que foi carregado. No Codex, `/hooks` mostra o que falta revisar e confiar; se nada aparecer e a raiz não for um repositório git, rode `git init` nela.
- **`node` não encontrado pelo hook.** Comum com nvm quando o editor abre pelo ícone. Abra o editor pelo terminal ou troque `node` pelo caminho completo (`which node`) no arquivo de hooks da ferramenta.
- **A guarda barrou algo legítimo.** Rode você mesmo no terminal: a guarda só vale para o agente. Se for recorrente, ajuste `harness/bin/guarda.mjs` e acrescente o caso em `harness/bin/testes/guarda.test.mjs`.
- **Falso positivo no diff.** Ajuste `proibido`, `protegidos`, `testes.dispensados` ou `pastasLivres` no `config.json`.
- **A mesma mensagem da guarda aparece duas vezes no Cursor.** O Cursor também carrega os hooks de `.claude/settings.json`. É inofensivo; para rodar uma vez só, desligue a importação de configurações de terceiros nas configurações do Cursor.
- **O agente não usa o navegador no QA.** Ative o navegador nas configurações do Cursor e, em empresa com lista de origens, libere `http://localhost:<porta>`. Sem navegador o QA responde "bloqueado", e a PR do frontend fica em rascunho com a pendência de você testar.
- **A condução parou no meio, sem PARE nem FIM.** O operador encerrou o turno antes da hora. Mande `/entregar` de novo, sem tarefa. Com os hooks ativos, o de fim de turno já manda continuar sozinho.
- **O maestro bloqueou dizendo que não alcança o GitHub.** O comando dele está rodando sem rede (sandbox) ou o `gh` não está logado. Veja "Para ele andar sem você" e rode `gh auth status`.
- **O maestro bloqueou por mudança sem commit.** São mudanças suas, de antes da condução. `git -C <pasta> stash -u` guarda tudo (ou faça commit, se elas são parte da tarefa); depois mande `/entregar`, sem tarefa. Se a tarefa não passa por aquele repositório, é só mandar `/entregar`.
- **Sumiu um arquivo que eu editei num repositório da tarefa, com a condução em andamento.** O maestro tirou do caminho para poder trabalhar. Está num patch em `harness/.maestro/descartados/<tarefa>/`, e o relatório final diz qual. Para devolver: `git -C <pasta do repositório> apply ../harness/.maestro/descartados/<tarefa>/<arquivo>.patch`.
- **Um agente foi barrado ao tentar commit, push ou PR.** Há uma condução aberta, e durante ela isso é do maestro. `node harness/bin/maestro.mjs estado` mostra qual; `encerrar` larga.
- **`AÇÃO: ESPERAR` se repete.** O subagente terminou sem gravar o resultado e o operador não declarou isso. Rode `node harness/bin/maestro.mjs proximo --sem-resultado`: o maestro refaz o passo.
- **A PR saiu em inglês e o time escreve em português.** `"idiomaDaPr": "pt"` em `convencoes`, no `config.json`.
- **Quero ver o que cada subagente recebeu e respondeu.** `"guardarPassos": true` no bloco `maestro`, e rode de novo: `harness/trabalho/` passa a guardar cada pedido (`.pedido.md`) e cada resposta, numerados na ordem.

## O que o harness não faz

- Não torna desvio impossível: reduz, expõe e cobra. A catraca pega o que cabe em regra sobre o diff; o resto depende da qualidade do mapa e do revisor humano, que continua sendo o último portão.
- O maestro garante o processo (reconhecimento, espelho, portões, revisão de contexto limpo, checks), não o gosto. A decisão que um modelo tomou pela regra pode não ser a sua: por isso ela vai escrita para a PR.
- Hook que falha libera o comando em vez de travar o trabalho; as outras camadas (portões, CI, Sonar, revisão) continuam valendo.
- Conduz uma tarefa de cada vez por raiz.
- Não aprova, não faz merge, não instala dependência, não resolve conflito com a base e não altera CI, Sonar ou lint. Isso é seu.
