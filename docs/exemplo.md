# Do setup à primeira entrega

Um exemplo completo de uso do harness, na ordem em que as coisas acontecem: o setup, o mapeamento, a primeira tarefa passo a passo (Parte 3) e a mesma tarefa no piloto automático (Parte 4). O projeto é inventado, mas tem a forma para a qual o harness foi feito:

- raiz `~/trabalho/parceiros/`, que não é um repositório;
- `api-parceiros/`: backend Node.js + TypeScript em camadas, que lê dados do Looker, passa por parsers e expõe por API;
- `web-parceiros/`: frontend CRA com o design system Flora;
- PR no GitHub, CI com Sonar, revisão por um colega.

As saídas dos scripts aparecem no formato real. As falas do agente são ilustrativas: o que importa é o que ele entrega em cada passo e o que você confere.

## Parte 1 — Setup (uma vez)

**1. Pré-requisitos.** Node 16+, git e `gh auth login` feito. No terminal, na raiz, os dois repositórios clonados lado a lado.

**2. Instalar.** Abro o Cursor na raiz, conversa nova, e colo o texto de [prompt-de-setup.md](prompt-de-setup.md). Ou faço à mão:

```bash
git clone https://github.com/tarcio11/domain-harness ~/domain-harness
node ~/domain-harness/instalar.mjs ~/trabalho/parceiros --com claude,codex
```

```text
HARNESS 0.3.0 em /Users/voce/trabalho/parceiros (ferramentas: cursor, claude, codex)
  criados: 65 · atualizados: 0 · iguais: 0 · do projeto, mantidos: 0 · conflitos: 0
Repositórios: backend → api-parceiros · frontend → web-parceiros
```

O instalador reconheceu sozinho qual pasta é backend e qual é frontend. Se não reconhecesse, eu preencheria `repos.backend.dir` e `repos.frontend.dir` em `harness/config.json`.

**3. Conferir.**

- Reabro a pasta no Cursor, marco como confiável e vejo três hooks em Customize → Hooks.
- `node harness/bin/doutor.mjs` na raiz. Neste momento ele acusa só "portões configurados" e "padrão mapeado", que é o próximo passo.
- Teste rápido da guarda: peço ao agente "rode `git status`" e olho o canal de saída "Hooks" do Cursor. Tem que aparecer a execução de `hook.mjs shell`. Sem execução listada, os hooks não estão ativos; o manual em `harness/README.md` tem o diagnóstico.

## Parte 2 — Mapear (uma vez por repositório)

**4. Backend.** Conversa nova:

```text
/mapear backend use a integração de estoque como referência
```

O agente roda o doutor, lê `package.json`, lint, Sonar e os workflows da PR, grava os portões em `harness/config.json`, roda `node harness/bin/portoes.mjs backend` na árvore limpa para provar que a base está verde, segue a integração de estoque de ponta a ponta (Looker → parser → caso de uso → rota → testes) e escreve `.cursor/rules/padrao-backend.mdc`.

Ele termina com um resumo e as dúvidas. Exemplo de dúvida boa: "achei dois jeitos de validar entrada, `zod` em 9 arquivos recentes e validação manual em 4 antigos; registrei `zod` como padrão e o manual em 'Não imitar'. Confirma?"

**5. Revisar o mapa.** É a parte mais importante do setup inteiro, porque esse arquivo vira lei. Abro `.cursor/rules/padrao-backend.mdc` e confiro cinco coisas:

1. Os espelhos são arquivos que eu mesmo indicaria a um dev novo como exemplo?
2. A receita "novo parser de integração" tem todos os passos, inclusive onde registrar e onde fica o teste?
3. A tabela de camadas diz certo quem pode importar de quem?
4. "Não imitar" pegou o legado que me incomoda?
5. Cada linha de convenção aponta para um arquivo que existe?

Corrijo à mão o que estiver errado e respondo as dúvidas. Depois olho `harness/config.json`: os `portoes` são os mesmos comandos do CI, e `camadas` reflete a tabela.

**6. Frontend.** Outra conversa nova: `/mapear frontend`. Mesma revisão, com atenção à seção "Só no frontend": quais componentes do Flora o projeto usa, de onde importa, e como descobrir o que já existe antes de criar componente.

Agora `node harness/bin/doutor.mjs` termina com `RESULTADO: tudo certo`.

## Parte 3 — A primeira tarefa, passo a passo

É o jeito de conhecer o harness: cada etapa numa conversa, eu no meio de todas. Depois que o mapa estiver bom, a Parte 4 faz o mesmo caminho sozinha.

O card: **PARC-482 — Mostrar o sell-out mensal por canal na página do parceiro.** O dado vem de um look novo do Looker.

### 7. Planejar

Conversa nova. Colo o card inteiro, com os critérios de aceite:

```text
/planejar PARC-482 — Mostrar o sell-out mensal por canal na página do parceiro.
O dado vem do look 9911 do Looker (colunas: canal, mes, valor).
Critérios: (1) o card aparece na página do parceiro com um gráfico de barras por canal;
(2) seletor de mês, padrão no mês atual; (3) sem dado, mostra o estado vazio padrão;
(4) erro da API mostra o aviso padrão.
```

O agente não escreve código aqui. Ele reescreve o objetivo, acha no mapa a receita de parser e a de tela, e para num desvio:

```text
DESVIO DE PADRÃO — aguardando decisão
O que a tarefa exige: gráfico de barras por canal.
O que o padrão cobre hoje: tabelas e indicadores com componentes do Flora (web-parceiros/src/pages/Parceiro/Estoque/EstoqueCard.tsx). Não há biblioteca de gráfico no projeto.
Por que não cabe no padrão: gráfico exige dependência nova (item 2 da lei).
Opção A, dentro do padrão: tabela canal × valor com barra de proporção, como no EstoqueCard (custo: não é o gráfico pedido).
Opção B, desvio mínimo: adicionar a biblioteca de gráfico que o time escolher, usada só neste card (impacto: package.json, lockfile, bundle maior).
Recomendo: A, e levar B ao time como decisão separada.
```

Respondo `A`. Se eu escolhesse B, eu mesmo rodaria o `npm install` (a guarda barra o agente), e o plano ganharia uma linha em "Desvios aprovados" com `web-parceiros/package.json` e `web-parceiros/package-lock.json` entre crases. É essa linha que faz a catraca mostrar esses arquivos como `[liberado]` em vez de bloqueio.

O plano sai em `harness/tarefas/PARC-482-sellout-por-canal/plano.md`. O miolo:

```markdown
## Contrato
GET /parceiros/:id/sellout?mes=2026-11 → 200 { canais: [{ canal, valor }] } · 404 parceiro · 422 mês inválido

## Fatias
- [ ] **F1 · backend · parser do look de sell-out**
  - Escopo: `src/parsers/sellout/`
  - Espelho: `src/parsers/estoque/estoque.parser.ts`, `src/parsers/estoque/estoque.parser.test.ts`
  - Entrega: `SelloutParser` converte as linhas do look em `SelloutPorCanal[]`
  - Prova: `sellout.parser.test.ts` (linha válida, valor nulo, canal desconhecido)
- [ ] **F2 · backend · caso de uso e rota**
- [ ] **F3 · frontend · tipos e serviço**
- [ ] **F4 · frontend · card SelloutPorCanal**
- [ ] **F5 · frontend · card na página do parceiro**

## PRs
- backend: F1–F2
- frontend: F3–F5 (depois da PR do backend)
```

O que eu confiro antes de aprovar: cada fatia é de um repositório só, tem espelho que existe, e a prova é um teste de verdade. Respondo `aprovado` e fecho a conversa.

### 8. Fatias do backend

Conversa nova, só isto:

```text
/fatia
```

O agente lê o plano, pega a F1, abre os dois espelhos e a regra de padrão, cria a branch `feature/PARC-482-sellout-por-canal` no `api-parceiros`, diz em cinco linhas o que vai criar e o espelho de cada arquivo, implementa e prova:

```text
PORTÕES · backend · fatia
✔ diff — 0 bloqueio(s), 0 aviso(s)
✔ lint (6s)
✔ tipos (9s)
✖ testes falhou (21s) — últimas 40 linhas:
  | FAIL src/parsers/sellout/sellout.parser.test.ts
  |   ● SelloutParser › deve ignorar linha com valor nulo
  |     Expected length: 2  Received length: 3
  log completo: harness/.logs/backend-testes.log (busque nele; não abra inteiro)
RESULTADO: REPROVADO — portão "testes". Conserte a causa; não desligue a verificação.
```

Ele conserta o parser (não o teste), roda de novo até `RESULTADO: APROVADO — 4 portões verdes, 0 bloqueios.`, chama o subagente `revisor` sobre o diff, corrige o que o revisor reprovar, faz um commit e marca `[x]` na F1.

O relatório final cabe na tela: o que entregou, a linha `RESULTADO`, o veredito do revisor e o próximo comando. O que eu confiro: `git -C api-parceiros show --stat` mostra só arquivos de `src/parsers/sellout/`, e o parser novo, lado a lado com o de estoque, parece irmão.

Fecho a conversa, abro outra, `/fatia` de novo: é a F2. Nunca duas fatias na mesma conversa.

**Quando a catraca entra.** Na F2 o agente, apertado com um aviso do lint, escreve `// eslint-disable-next-line`. No fim do turno ele recebe sozinho:

```text
CATRACA DO HARNESS — o diff desta conversa tem 1 bloqueio(s):
[BLOQUEIO] api-parceiros/src/usecases/sellout/listar-sellout.usecase.ts:18 — desliga o lint (eslint-disable)
Corrija a causa agora. Se for um desvio legítimo, não contorne: desfaça a mudança, responda com o bloco DESVIO DE PADRÃO e espere o humano.
```

E volta a trabalhar: tira o comentário e resolve o que o lint apontava.

### 9. PR do backend

Conversa nova:

```text
/pr backend
```

Ele confere que F1 e F2 estão marcadas, chama o revisor sobre o diff inteiro contra a base, roda `node harness/bin/portoes.mjs backend --pr`, escreve a descrição para o revisor humano (o que e por quê, como revisar, provas, desvios, fora do escopo), faz push, abre a PR em rascunho e espera:

```text
PR #431 (rascunho) — https://github.com/empresa/api-parceiros/pull/431
✔ CI / build
✔ CI / test
✖ SonarQube Code Analysis
    Quality Gate failed
    - 71.4% Coverage on New Code (required ≥ 80%)
    src/usecases/sellout/listar-sellout.usecase.ts:31 — Add tests covering this branch.
RESULTADO: REPROVADO — 1 de 3 checks. Conserte a causa em commit novo.
```

Ele escreve o teste do caminho de erro, roda os portões, faz commit novo, push, espera de novo. Com `RESULTADO: VERDE — 3 checks.`, tira do rascunho com `gh pr ready` e me devolve o link. Eu peço a revisão a um colega. Merge é sempre humano: a guarda barra `gh pr merge`.

### 10. Fatias do frontend

Não espero o merge do backend para seguir: o contrato está no plano, e a fatia do frontend lê o contrato, não o código do backend. Três conversas, três `/fatia`: tipos e serviço, o card com componentes do Flora, o encaixe na página.

O que eu confiro em cada uma: o card novo usa os mesmos componentes do Flora que o espelho, nenhuma cor ou espaçamento fixo, teste junto.

### 11. QA na tela

Conversa nova:

```text
/qa
```

O agente monta o roteiro a partir dos quatro critérios, sobe backend e frontend com os comandos de `repos.*.subir`, abre o navegador do Cursor e para no login: eu entro, ele continua. Testa cada critério, mais carregando, vazio, erro e a tela vizinha, e grava `harness/tarefas/PARC-482-sellout-por-canal/qa.md`:

```markdown
| Critério | Resultado | Evidência |
|---|---|---|
| CA1 card com valores por canal | passou | captura 01 |
| CA2 seletor de mês, padrão no atual | passou | captura 02 |
| CA3 sem dado mostra estado vazio padrão | FALHOU | captura 03: card some em vez de mostrar o vazio |
| CA4 erro da API mostra aviso padrão | passou | captura 04, 500 simulado |
```

Ele não corrige. Acrescenta ao plano a F6 ("estado vazio do card", com espelho e prova) e encerra. Conversa nova, `/fatia`, depois `/qa` de novo: tudo passou.

### 12. PR do frontend

```text
/pr frontend
```

Mesmo caminho: revisor, portões, descrição com o resumo do QA, PR em rascunho, checks, verde.

### 13. A revisão humana

O colega comenta na PR do backend: "nome de teste aqui é sempre 'deve …', em português". Conversa nova:

```text
/pr backend
```

Como a PR já existe e tem comentário, o agente vai para a parte C: lê os comentários, renomeia os testes em commit novo, roda portões e checks, e propõe:

```text
Linha que faltava em .cursor/rules/padrao-backend.mdc, seção Convenções:
- Nome de teste: "deve <verbo>", em português → src/parsers/estoque/estoque.parser.test.ts
Posso acrescentar?
```

Respondo que sim. O que o revisor pegou uma vez virou lei: a próxima tarefa já nasce certa. Se desse para pegar por texto, eu pediria também uma regra em `proibido` no `config.json`.

### 14. Fechar

O colega aprova e faz o merge das duas PRs. Eu troco `Status` do plano para `concluído`. Na próxima tarefa, `/planejar` aponta `harness/tarefas/ATUAL` para o plano novo.

## Parte 4 — A mesma tarefa no piloto automático

Tudo o que a Parte 3 fez em onze conversas, o `/entregar` faz numa só, e eu só apareço quando a decisão é minha. O mapa da Parte 2 é o mesmo.

### 15. Preparar (uma vez)

No Cursor, em Settings → Agents → Approvals & Execution, ponho na allowlist de comandos:

```text
node harness/bin/maestro.mjs
node harness/bin/portoes.mjs
```

O maestro faz `git fetch`, `git push` e usa o `gh`. No sandbox, sem rede, ele pararia logo no começo avisando que não alcança o GitHub. `node harness/bin/doutor.mjs` tem que mostrar as duas linhas do `/entregar` em verde.

### 16. Um comando

Conversa nova, com o card inteiro:

```text
/entregar PARC-482 — Mostrar o sell-out mensal por canal na página do parceiro.
O dado vem do look 9911 do Looker (colunas: canal, mes, valor).
Critérios: (1) o card aparece na página do parceiro com um gráfico de barras por canal;
(2) seletor de mês, padrão no mês atual; (3) sem dado, mostra o estado vazio padrão;
(4) erro da API mostra o aviso padrão.
```

A conversa vira o **operador**: grava o meu texto, roda `node harness/bin/maestro.mjs iniciar` e passa a repetir `node harness/bin/maestro.mjs proximo`, fazendo o que a linha `AÇÃO:` manda. Cada chamada devolve algo assim:

```text
MAESTRO · PARC-482-mostrar-sell-out-mensal · plano
AÇÃO: SUBAGENTE — Escrever o plano (tentativa 1 de 5)
1. Abra o subagente `maestro-passo`, em primeiro plano (o que bloqueia até terminar). […]
2. Passe a ele exatamente o texto entre as linhas ===, sem mudar nem acrescentar nada.
3. Espere ele terminar. Não leia arquivos nem confira o trabalho dele: quem confere é o maestro.
4. Rode de novo: node harness/bin/maestro.mjs proximo
===
Leia o arquivo `harness/tarefas/PARC-482-mostrar-sell-out-mensal/passos/01-plano.pedido.md` inteiro e faça exatamente o que ele manda, do começo ao fim. Não faça nada além disso. Quando terminar, responda só: feito.
===
```

O operador não lê código nem decide nada: repassa uma linha. O arquivo de pedido tem os parâmetros, o roteiro e o formato exato da resposta. O planejador, um subagente com a janela dele, lê o card, o mapa e os espelhos, escreve o plano e confere o formato com `maestro.mjs validar-plano`. Depois um crítico, que não escreveu o plano, procura o que faria a execução falhar: espelho errado, ponto de registro fora do escopo, critério sem fatia.

### 17. A primeira parada: o desvio do gráfico

O plano saiu com um desvio pendente, e desvio é decisão minha. O operador mostra e encerra o turno:

```text
AÇÃO: PARE
===
PLANO — PARC-482 — sell-out por canal (harness/tarefas/PARC-482-mostrar-sell-out-mensal/plano.md)
Mostrar o sell-out mensal por canal na página do parceiro.
- F1 · backend · parser do look de sell-out
- F2 · backend · caso de uso e rota
- F3 · frontend · tipos e serviço
- F4 · frontend · card SelloutPorCanal
- F5 · frontend · card na página do parceiro
Premissas:
- O mês padrão é o mês corrente, como no card de estoque.

Desvios pendentes:
DESVIO DE PADRÃO — aguardando decisão
O que a tarefa exige: gráfico de barras por canal.
[…]
Recomendo: A, e levar B ao time como decisão separada.

Responda "aprovado" para o maestro seguir, ou diga o que mudar no plano.
===
```

Respondo na conversa: `Opção A. Não quero dependência nova.` O operador grava a minha resposta em `harness/tarefas/RESPOSTA.md`, roda `maestro.mjs retomar`, e o planejador refaz o plano pela opção A. Sem desvio e sem dúvida, o plano segue sozinho. A minha resposta fica no plano, em "Decisões do humano".

Se eu quisesse aprovar todo plano antes de qualquer código, poria `"aprovarPlano": "sempre"` em `harness/config.json`.

### 18. O que acontece sem mim

Para cada fatia, na ordem do plano:

1. O maestro entra na branch da tarefa (ou cria, a partir da base atualizada) e anota onde o histórico estava.
2. Um executor implementa pelo espelho, dentro do escopo, roda os portões e grava o resultado com a mensagem de commit.
3. O maestro confere no git: algo mudou; nada fora do escopo; nenhuma verificação desligada; portões verdes para exatamente aqueles arquivos. Se o executor não rodou os portões, ou mexeu depois de rodar, o maestro roda.
4. Um revisor de contexto limpo compara o diff com os espelhos. Para aprovar, ele tem que dizer com que espelho comparou cada arquivo novo.
5. Só então o maestro faz o commit e marca `[x]` na fatia.

Quando algo falha, a conversa nem me chama. Na F2, o executor escreveu `// eslint-disable-next-line` e respondeu "ok". O executor seguinte recebeu, no pedido, o caminho deste arquivo:

```text
O maestro conferiu o diff e não aceitou. Corrija a causa de cada item:
- [BLOQUEIO] api-parceiros/src/usecases/sellout/listar-sellout.usecase.ts:18 — desliga o lint (eslint-disable)
```

Com as fatias do backend prontas, vêm a revisão do conjunto, a descrição da PR (as provas quem escreve é o maestro), o push, a PR em rascunho e a espera dos checks. O Sonar reprovou a cobertura. O resumo dos checks virou um pedido de correção, outro executor escreveu o teste, o revisor aprovou, commit novo, push, e o maestro esperou de novo:

```text
MAESTRO · PARC-482-mostrar-sell-out-mensal · backend: checks
AÇÃO: REPETIR — Os checks da PR #431 de backend ainda estão rodando (4 min).
Rode de novo: node harness/bin/maestro.mjs proximo
```

Verde, a PR saiu do rascunho e o maestro passou para o frontend. Depois das três fatias e da revisão do conjunto, o QA na tela: um subagente sobe os dois servidores, testa cada critério no navegador e responde uma linha por critério. O CA3 falhou (`onde: frontend`), virou correção, e o QA rodou de novo: tudo passou.

### 19. Quando ele não consegue

Se o QA cai numa tela de login, ou a ferramenta não dá navegador ao subagente, ele não simula nem digita credencial: responde "bloqueado". O maestro não trava por isso: segue, deixa a PR do frontend em rascunho e avisa no relatório que falta eu testar. Se eu preferir testar sempre eu mesmo, ponho `"qa": "humano"` no `config.json`.

As outras paradas estão no manual (`harness/README.md`): um passo que não fecha depois das tentativas, PR sem nenhum check, conflito com a base, plano ou harness alterado no meio da condução.

### 20. O fim

```text
AÇÃO: FIM
===
ENTREGA — PARC-482 — sell-out por canal

PR de backend: #431 — 3 checks verdes, pronta para revisão — https://github.com/empresa/api-parceiros/pull/431
PR de frontend: #212 — 3 checks verdes, pronta para revisão — https://github.com/empresa/web-parceiros/pull/212

Commits:
- backend 3cc0f09 feat(sellout): parser do look de sell-out
- backend 81a2d4e feat(sellout): caso de uso e rota
- backend 5f0c7aa test(sellout): cobre o erro do caso de uso
[…]

Premissas do plano (confira):
- O mês padrão é o mês corrente, como no card de estoque.

O que foi decidido no caminho:
- Plano aprovado sem você: o validador e o crítico aprovaram, e não havia dúvida nem desvio.

Falta de você: revisar e fazer o merge.
Trilha da condução: harness/tarefas/PARC-482-mostrar-sell-out-mensal/passos/
===
```

O que eu confiro: as duas PRs (a descrição termina com o bloco "Provas", escrito pelo script com o que ele mesmo conferiu), as premissas e, com os meus olhos, a tela. Para ver como um passo foi feito, `passos/` tem o pedido e a resposta de cada um, numerados.

O colega comentou na PR? `/pr backend`, como no passo 13: a condução já terminou, e o passo a passo cuida da revisão.

**Se a conversa cair no meio**, nada se perde: o estado está em `harness/tarefas/<id>/`. Conversa nova, `/entregar` sem tarefa, e ele continua. `node harness/bin/maestro.mjs estado` mostra onde está; `encerrar` larga a condução sem mexer no git.

## Parte 5 — Variações

### PR antiga, feita sem o harness

Tenho a PR 418 do backend, aberta antes de instalar tudo isso. Com o mapa pronto, conversa nova:

```text
/conferir backend 418
```

O agente faz checkout da PR, roda catraca e portões contra a base, manda o revisor comparar o diff com o padrão (os espelhos ele acha pelo mapa), lê os checks da PR e devolve um relatório. Não altera nada e não comenta na PR.

```text
VEREDITO: FORA DO PADRÃO (3 bloqueantes)
Bloqueantes
- src/services/pedidos.service.ts:44 — regra de negócio dentro do controller — camadas (padrao-backend.mdc) — mover para um caso de uso
- src/parsers/pedidos/index.ts:12 — importa "../../infra/http" — domínio não conhece infraestrutura — receber o cliente por parâmetro
- src/parsers/pedidos/pedidos.parser.ts — sem teste — espelho estoque.parser.test.ts — criar pedidos.parser.test.ts
Perguntas para o humano
- package.json mudou (dependência dayjs): foi decisão sua?
Avisos
- diff grande para revisar: 612 linhas (máximo 400), sem contar testes. Divida.
```

Para adequar: `/planejar adequar a branch feature/PARC-455-pedidos ao padrão`. Os bloqueantes viram fatias, a branch do plano é a que já existe, e daí em diante é `/fatia` e `/pr backend` (que só faz push, porque a PR já está aberta).

Serve igual para revisar a PR de um colega antes de eu aprovar.

### Nas extensões do Claude Code e do Codex

Mesma raiz, mesma lei, mesmos roteiros. Muda a forma de chamar:

| | Agente do Cursor | Claude Code | Codex |
|---|---|---|---|
| Chamar um passo | `/fatia` | `/fatia` | `$fatia` |
| Ver os hooks | Customize → Hooks | `/hooks` | `/hooks` (revisar e confiar) |

Dá para misturar: planejar numa ferramenta e implementar em outra, porque o estado está no plano, não na conversa. Vale também para os dois jeitos: um plano aprovado pelo `/planejar` é adotado pelo `/entregar`, sem tarefa, que conduz daí em diante.

### Pedido pequeno

"Troca o texto do botão para 'Exportar CSV'." Um arquivo, nenhuma decisão: peço direto, sem plano. A lei continua valendo: o agente abre o espelho, a catraca confere o diff no fim do turno, e antes do commit eu rodo `node harness/bin/portoes.mjs frontend`.

## Cola

| Quero… | Faço |
|---|---|
| Instalar ou atualizar | `node ~/domain-harness/instalar.mjs <raiz> [--com claude,codex]` |
| Saber se está tudo no lugar | `node harness/bin/doutor.mjs` |
| Entregar uma tarefa inteira, do plano à PR | `/entregar <card e critérios>` |
| Continuar uma entrega que parou | conversa nova, `/entregar` |
| Saber onde a entrega está | `node harness/bin/maestro.mjs estado` |
| Largar uma entrega | `node harness/bin/maestro.mjs encerrar` |
| Começar uma tarefa passo a passo | `/planejar <card e critérios>` |
| Fazer a próxima fatia | conversa nova, `/fatia` |
| Ver se o que está na árvore passa | `node harness/bin/portoes.mjs backend` |
| Testar na tela | `/qa` |
| Abrir a PR, ou tratar a revisão | `/pr backend` |
| Só olhar os checks da PR | `node harness/bin/esperar-checks.mjs backend` |
| Auditar uma PR que já existe | `/conferir backend 418` |
| Liberar um desvio que aprovei | uma linha em "Desvios aprovados" do plano, com o caminho entre crases |
| Ensinar algo novo ao harness | uma linha no arquivo de padrão, ou uma regra em `harness/config.json` |
