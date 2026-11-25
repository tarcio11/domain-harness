# Do setup à primeira entrega

Um exemplo completo de uso do harness, na ordem em que as coisas acontecem: o setup, uma tarefa inteira com o `/entregar`, uma branch pronta com o `/revisar` e, para quem quer ditar o ritmo, a mesma tarefa passo a passo. O projeto é inventado, mas tem a forma para a qual o harness foi feito:

- raiz `~/trabalho/parceiros/`, que não é um repositório;
- `api-parceiros/`: backend Node.js + TypeScript em camadas, que lê dados do Looker, passa por parsers e expõe por API;
- `web-parceiros/`: frontend CRA com o design system Flora;
- PR no GitHub, CI com Sonar, revisão por um colega.

As saídas dos scripts aparecem no formato real. O que os agentes escrevem (o mapa, o plano, as mensagens de commit) é ilustrativo: o que importa é o que sai de cada passo e o que você confere.

## Parte 1 — Setup (uma vez)

**1. Pré-requisitos.** Node 16+, git e `gh auth login` feito. No terminal, na raiz, os dois repositórios clonados lado a lado.

**2. Instalar.** Abro o Cursor na raiz, conversa nova, e colo o texto de [prompt-de-setup.md](prompt-de-setup.md). Ou faço à mão:

```bash
git clone https://github.com/tarcio11/domain-harness ~/domain-harness
node ~/domain-harness/instalar.mjs ~/trabalho/parceiros --com claude,codex
```

```text
HARNESS 0.4.0 em /Users/voce/trabalho/parceiros (ferramentas: cursor, claude, codex)
  criados: 73 · atualizados: 0 · iguais: 0 · do projeto, mantidos: 0 · conflitos: 0
Repositórios: backend → api-parceiros · frontend → web-parceiros
Próximos passos:
  […]
```

O instalador reconheceu sozinho qual pasta é backend e qual é frontend. Se não reconhecesse, eu preencheria `repos.backend.dir` e `repos.frontend.dir` em `harness/config.json`.

**3. Conferir.**

- Reabro a pasta no Cursor, marco como confiável e vejo três hooks em Customize → Hooks.
- Em Settings → Agents → Approvals & Execution, ponho na allowlist de comandos `node harness/bin/maestro.mjs` e `node harness/bin/portoes.mjs`. O maestro faz `git fetch`, `git push` e usa o `gh`; no sandbox, sem rede, ele bloquearia na primeira chamada avisando que não alcança o GitHub.
- `node harness/bin/doutor.mjs` na raiz. Neste momento ele acusa só "portões configurados" e "padrão mapeado", de cada repositório: o maestro resolve isso sozinho na primeira condução.
- Teste rápido da guarda: peço ao agente "rode `git status`" e olho o canal de saída "Hooks" do Cursor. Tem que aparecer a execução de `hook.mjs shell`. Sem execução listada, os hooks não estão ativos; o manual em `harness/README.md` tem o diagnóstico.

## Parte 2 — Uma tarefa inteira: `/entregar`

O card: **PARC-482 — Mostrar o sell-out mensal por canal na página do parceiro.** O dado vem de um look novo do Looker.

### 4. Um comando

Conversa nova, com o card inteiro:

```text
/entregar PARC-482 — Mostrar o sell-out mensal por canal na página do parceiro.
O dado vem do look 9911 do Looker (colunas: canal, mes, valor).
Critérios: (1) o card aparece na página do parceiro com um gráfico de barras por canal;
(2) seletor de mês, padrão no mês atual; (3) sem dado, mostra o estado vazio padrão;
(4) erro da API mostra o aviso padrão.
```

A conversa vira o **operador**: grava o meu texto, roda `node harness/bin/maestro.mjs iniciar` e passa a repetir `node harness/bin/maestro.mjs proximo`, fazendo o que a linha `AÇÃO:` manda.

```text
Condução de PARC-482-mostrar-sell-out-mensal iniciada. Agora rode: node harness/bin/maestro.mjs proximo
```

A primeira chamada confere o que só eu resolvo: `gh` logado, remoto alcançável, e se há mudança minha sem commit nos repositórios. Está tudo em ordem, então daqui até o relatório final eu não digito mais nada. (Se não estivesse, ele diria agora, comigo ainda na conversa: é o item 11.)

### 5. Primeiro ele entende o código

Como é a primeira condução nesta raiz, o maestro começa mapeando o padrão de cada repositório: um subagente lê `package.json`, lint, Sonar e os workflows da PR, grava os portões em `harness/config.json`, prova que eles passam, segue uma entrega existente de ponta a ponta e escreve `.cursor/rules/padrao-backend.mdc`. Isso acontece uma vez por repositório.

Depois vem o que acontece em toda tarefa, o reconhecimento:

```text
MAESTRO · PARC-482-mostrar-sell-out-mensal · preparo: reconhecer
AÇÃO: SUBAGENTE — Reconhecer o código para esta tarefa (tentativa 1 de 3)
1. Abra o subagente `maestro-passo`, em primeiro plano (o que bloqueia até terminar). […]
2. Passe a ele exatamente o texto entre as linhas ===, sem mudar nem acrescentar nada.
3. Espere ele terminar. Não leia arquivos nem confira o trabalho dele: quem confere é o maestro.
4. Rode de novo: node harness/bin/maestro.mjs proximo
[…]
===
Leia o arquivo `harness/trabalho/05-reconhecer.pedido.md` inteiro e faça exatamente o que ele manda, do começo ao fim. Não faça nada além disso. Quando terminar, responda só: feito.
===
```

O operador não lê código nem decide nada: repassa uma linha. O subagente, com a janela dele, acha a entrega mais parecida com o pedido, segue o fio dela da entrada ao dado e devolve um mapa curto:

```markdown
# Mapa do código

## Pedido
Card novo na página do parceiro com o sell-out do mês por canal. O dado vem do look 9911 do Looker.

## Entrega mais parecida
Estoque por parceiro — mesma forma: um look do Looker, um parser, uma rota e um card na página do parceiro.

## Fio da entrada ao dado
1. Entrada: `api-parceiros/src/routes/parceiros.routes.ts` — GET /parceiros/:id/estoque
2. `api-parceiros/src/usecases/estoque/listar-estoque.usecase.ts` — a regra
3. `api-parceiros/src/parsers/estoque/estoque.parser.ts` — linhas do look → EstoquePorSku[]
4. Dado: `api-parceiros/src/integrations/looker/looker.client.ts` — look 8802

Testes: `api-parceiros/src/parsers/estoque/estoque.parser.test.ts`
Registrado em: `api-parceiros/src/routes/index.ts`

## Modelos de dados
- EstoquePorSku em `api-parceiros/src/parsers/estoque/estoque.types.ts` — sku, quantidade, atualizadoEm

## Peças e espelhos
| Peça que o pedido cria ou altera | Espelho | Observação |
|---|---|---|
| parser do look de sell-out (novo) | `api-parceiros/src/parsers/estoque/estoque.parser.ts` | mesmo esqueleto e mesmo `ParserError` |
| card SelloutPorCanal (novo) | `web-parceiros/src/pages/Parceiro/Estoque/EstoqueCard.tsx` | mesmos componentes do Flora |

## Reuso
- `api-parceiros/src/parsers/shared/normalizar-linha.ts` — limpa as colunas de qualquer look

## Sem parecido
- gráfico de barras: o projeto não tem biblioteca de gráfico nem componente do Flora para isso
```

O script confere se cada arquivo entre crases existe; mapa com arquivo inventado volta para o subagente. O mapa aceito entra no plano, na seção "Mapa do código", e é dele que planejador, executores e revisores partem.

### 6. A decisão que antes era uma pergunta

O card pede um gráfico de barras, e o projeto não tem biblioteca de gráfico. Dependência nova é limite da lei: não entra por decisão de modelo. Ninguém para para me perguntar. O planejador segue a regra (primeiro o caminho dentro do padrão) e escreve o que decidiu, no idioma da PR:

```markdown
## Premissas

- CA1: bars drawn with the Flora proportion bar used in EstoqueCard, one row per channel — the project has no chart library, and a new dependency is a limit only a human can lift — a real bar chart was discarded.
- Default month is the current month, as in the stock card.
```

Um crítico, que não escreveu o plano, procura o que faria a execução falhar: espelho errado, ponto de registro fora do escopo, critério sem fatia, fatia que entrega mais de um comportamento. Reprovou, volta ao planejador. Aprovado e validado, o plano segue sozinho. Ele fica em `harness/tarefas/PARC-482-mostrar-sell-out-mensal/plano.md`, e é o único arquivo dessa pasta.

As fatias saem pequenas, um comportamento com o teste dele em cada uma:

```markdown
- [ ] **F1 · backend · parser: linha válida do look**
  - Escopo: `src/parsers/sellout/`
  - Espelho: `src/parsers/estoque/estoque.parser.ts`, `src/parsers/estoque/estoque.parser.test.ts`
  - Entrega: `SelloutParser` converte uma linha válida em `SelloutPorCanal`
  - Prova: `sellout.parser.test.ts` (linha válida)
- [ ] **F2 · backend · parser: valor nulo é ignorado**
- [ ] **F3 · backend · parser: canal desconhecido lança ParserError**
- [ ] **F4 · backend · caso de uso listar sell-out por mês**
- [ ] **F5 · backend · rota GET /parceiros/:id/sellout**
- [ ] **F6 · backend · rota: mês inválido devolve 422**
- [ ] **F7 · frontend · tipos e serviço de sell-out**
…
- [ ] **F13 · frontend · card na página do parceiro**
```

Treze fatias. Não há teto, nem alguém para aprovar.

### 7. O que acontece em cada fatia

1. O maestro entra na branch da tarefa (ou cria, a partir da base atualizada) e anota onde o histórico estava.
2. Um executor escreve o teste, vê falhar, implementa pelo espelho, roda os portões e grava o resultado, com a mensagem de commit em inglês, no formato dos commits do repositório.
3. O maestro confere no git: algo mudou; nenhuma verificação desligada; nenhum arquivo protegido; nada fora do escopo sem declarar; portões verdes para exatamente aqueles arquivos. Se o executor não rodou os portões, ou mexeu depois de rodar, o maestro roda.
4. Um revisor de contexto limpo compara o diff com os espelhos. Para aprovar, ele tem que dizer com que arquivo comparou cada arquivo novo.
5. Só então o maestro faz o commit e marca `[x]` na fatia.

Quando algo falha, a conversa não me chama. Na F4, o executor escreveu `// eslint-disable-next-line` e respondeu "ok". O executor seguinte recebeu, no pedido, o caminho de um arquivo com isto:

```text
O maestro conferiu o diff e não aceitou. Corrija a causa de cada item:
- [BLOQUEIO] api-parceiros/src/usecases/sellout/listar-sellout.usecase.ts:18 — desliga o lint (eslint-disable)
```

Na F5 o executor precisou registrar a rota num arquivo que o plano não previu. Em vez de parar, mexeu e declarou no resultado:

```text
RESULTADO: ok
COMMIT: feat(sellout): add GET /parceiros/:id/sellout route

Feito: sell-out route registered next to the stock route.
ESCOPO EXTRA: `src/routes/index.ts` — the route list lives here; the stock route is registered the same way
```

E na F9 o Flora não tinha seletor de mês. O executor escolheu pela regra e registrou:

```text
DECISÃO: month selector built with the Flora Select and a list of the last 12 months — Flora has no month picker — a native date input was discarded
```

O revisor da fatia recebe essas declarações e julga se elas se sustentam. As decisões vão para a descrição da PR.

### 8. A PR lida linha por linha, e os checks

Com as fatias do backend prontas, o diff inteiro é dividido em lotes que cabem numa janela de contexto, e cada lote vai para um revisor que lê todas as linhas e compara com os espelhos. O que ele aponta vira um ajuste: outro executor, portões, revisor, um commit pequeno. No lote 2, o revisor achou um bloco repetido entre o parser novo e o de estoque; saiu o commit `refactor(sellout): reuse normalizarLinha from the shared parser helpers`.

Depois vêm a descrição da PR, o push, a PR em rascunho e a espera dos checks. O Sonar reprovou a cobertura. O resumo dos checks virou um pedido de correção, outro executor escreveu o teste, commit novo, push, e o maestro esperou de novo:

```text
MAESTRO · PARC-482-mostrar-sell-out-mensal · backend: checks
AÇÃO: REPETIR — Os checks da PR #431 de backend ainda estão rodando (4 min).
Rode de novo: node harness/bin/maestro.mjs proximo
```

Verde, a PR saiu do rascunho e o maestro passou para o frontend. Depois das fatias e da revisão linha por linha, o QA na tela: um subagente sobe os dois servidores, testa cada critério no navegador e responde uma linha por critério. O CA3 falhou (`onde: frontend`), virou correção, e o QA rodou de novo: tudo passou.

### 9. O fim

```text
MAESTRO · PARC-482-mostrar-sell-out-mensal · entregue
AÇÃO: FIM
Mostre ao humano exatamente o texto entre as linhas === e encerre.
===
ENTREGA — PARC-482 — Sell-out mensal por canal

PR de backend: #431 — 3 checks verdes, pronta para revisão — https://github.com/empresa/api-parceiros/pull/431
PR de frontend: #212 — 3 checks verdes, pronta para revisão — https://github.com/empresa/web-parceiros/pull/212

Commits:
- backend 3cc0f09 feat(sellout): parse a valid sell-out row
- backend 81a2d4e feat(sellout): skip rows with null value
[…]
- backend 5f0c7aa test(sellout): cover the use case error path
- frontend 0d41b7e feat(sellout): add sell-out types and service
[…]

Premissas do plano (estão na descrição da PR; confira):
- CA1: bars drawn with the Flora proportion bar used in EstoqueCard, one row per channel — […]
- Default month is the current month, as in the stock card.

Decisões que o agente tomou sozinho (estão na descrição da PR; confira):
- frontend: F9: month selector built with the Flora Select and a list of the last 12 months — Flora has no month picker — a native date input was discarded

Avisos da condução:
- O padrão do backend não estava mapeado, e o maestro mapeou sozinho. Leia .cursor/rules/padrao-backend.mdc quando puder e corrija o que estiver errado: é a lei que os agentes seguem.
- O padrão do frontend não estava mapeado, e o maestro mapeou sozinho. […]

Falta de você: revisar e fazer o merge.
===
```

Na PR do frontend, depois do texto que o redator escreveu para o revisor (o que e por quê, como revisar), vem o que o script conferiu e o que os agentes decidiram:

```markdown
---

## Proofs (generated by the harness, not by the model)

- Local gates (lint, tipos, testes, build): green for commit a91c3e2.
- Diff checks: 0 blocks.
- On-screen QA: passed.
- Deviations approved by the human: none.
- Commits, each one reviewed by a clean-context agent before it existed:
  - 0d41b7e feat(sellout): add sell-out types and service
  […]

## Decisions made by the agent

Made without asking, by the project rule: the path inside the pattern first; without one, the smallest deviation. Please check them in review.

Plan assumptions:
  - CA1: bars drawn with the Flora proportion bar used in EstoqueCard, one row per channel — […]
  - Default month is the current month, as in the stock card.

- F9: month selector built with the Flora Select and a list of the last 12 months — Flora has no month picker — a native date input was discarded
```

O que eu confiro: as duas PRs, a seção de decisões (se eu preferir o gráfico de verdade, instalo a biblioteca eu mesmo e peço a mudança) e, com os meus olhos, a tela. Na raiz sobrou só o `plano.md` da tarefa, com as marcas `[x]`, as decisões e o estado: a pasta de trabalho dos subagentes foi apagada.

O time escreve PR em português? `"idiomaDaPr": "pt"` em `convencoes`, no `harness/config.json`, e o mesmo bloco sai em português. Os commits continuam no idioma de `convencoes.idioma`.

### 10. Quando algo não fecha

Não vira pergunta. Três exemplos do que eu veria no lugar:

**Uma fatia que não passa.** A F10 não ficou verde depois das tentativas. O maestro desfez o que ela deixou, guardou a tentativa num patch e publicou o que já tinha commit, em rascunho. As fatias que vinham depois ficaram de fora, porque dependiam dela:

```text
PR de frontend: #212 — 3 checks verdes, em rascunho — https://github.com/empresa/web-parceiros/pull/212

PENDÊNCIAS — o que não fechou (por isso a PR ficou em rascunho):
- frontend: A fatia F10 · card: estado vazio não fechou e ficou de fora da entrega, com as fatias que vinham depois dela: "F10 · card: estado vazio: corrigir" não fechou em 6 tentativas. O que foi tentado está em harness/.maestro/descartados/PARC-482-mostrar-sell-out-mensal/F10.patch.
    | Os portões reprovaram o que está na pasta. Conserte a causa. Saída do maestro ao rodar:
    | PORTÕES · frontend · fatia
    | ✔ diff — 0 bloqueio(s), 0 aviso(s)
    | ✔ lint (7s)
    | ✔ tipos (11s)
    | ✖ testes falhou (24s) — últimas 40 linhas:
    |   | FAIL src/pages/Parceiro/Sellout/SelloutCard.test.tsx
    |   |   ● SelloutCard › shows the default empty state
    |   |     Unable to find an element with the text: Nenhum dado para o período
    |   log completo: harness/.logs/frontend-testes.log (busque nele; não abra inteiro)
    | RESULTADO: REPROVADO — portão "testes". Conserte a causa; não desligue a verificação.

Falta de você: resolver as pendências acima e, depois, revisar e fazer o merge.
```

A mesma lista está na PR, na seção "Pending", com o fim do log recolhido, e no plano, na seção "Pendências".

**O QA não deu para fazer.** A ferramenta não deu navegador ao subagente, ou ele caiu numa tela de login. Ele não simula nem digita credencial: responde "bloqueado". A PR do frontend fica em rascunho com a pendência de eu testar na tela, e o resto segue.

**O revisor interno não se convenceu.** Depois das rodadas, o revisor de uma fatia ainda apontava um nome de função. Os portões estavam verdes, então o commit entrou, e o ponto foi para a PR, em "Decisions", como ponto em aberto. Quem arbitra é o revisor humano.

### 11. Os únicos bloqueios

O maestro só devolve a conversa para mim no que nenhum modelo resolve, e o mais cedo que dá. Se eu tivesse deixado um arquivo sem commit no `web-parceiros`, a primeira chamada, segundos depois do `/entregar`, teria sido esta:

```text
MAESTRO · PARC-482-mostrar-sell-out-mensal · preparo: mapear
AÇÃO: PARE
Isto é um bloqueio que só o humano resolve. Mostre a ele exatamente o texto entre as linhas === e encerre o seu turno. Não tente resolver nem contornar.
Quando ele responder: rode `node harness/bin/maestro.mjs retomar` e depois `node harness/bin/maestro.mjs proximo`.
===
BLOQUEIO — Há mudanças sem commit em web-parceiros/, e elas são suas: o maestro não mexe nelas. Faça commit, guarde (git stash) ou descarte.
Para ver: git -C web-parceiros status --short
Para guardar tudo: git -C web-parceiros stash -u
Se esta tarefa não mexe aí, deixe como está: a condução não toca nesse repositório.

Quando resolver, mande /entregar de novo, sem tarefa: a condução continua de onde parou.
===
```

Nessa hora o maestro ainda não tem plano, então não sabe se a tarefa passa pelo frontend. Eu sei: passa. Guardo com `git -C web-parceiros stash -u` e mando `/entregar`. Se eu só mandasse `/entregar`, ele seguiria e bloquearia de novo com o plano aprovado, antes da primeira fatia, e nunca no meio do caminho.

Os outros bloqueios são da mesma família: `gh` sem login ou sem rede, branch local e remota que se separaram, push recusado. Resolvo e mando `/entregar`, sem tarefa.

**Enquanto ele trabalha**, os repositórios da tarefa são dele: troca de branch, commit, limpeza da pasta entre um passo e outro. Eu não edito nada ali até o `FIM`; o que aparecer no meio do caminho ele tira da pasta e guarda num patch, com aviso no relatório. Numa tarefa só de backend, o frontend não é tocado, e eu posso continuar trabalhando nele.

**Se a conversa cair no meio**, nada se perde: o estado está no disco. Conversa nova, `/entregar` sem tarefa, e ele continua. `node harness/bin/maestro.mjs estado` mostra onde está; `encerrar` larga a condução sem mexer no git.

## Parte 3 — Uma branch que já existe: `/revisar`

Tenho a branch `feature/PARC-455-pedidos`, escrita antes do harness, com a PR 418 aberta. Quero que ela fique no padrão do projeto. Conversa nova:

```text
/revisar feature/PARC-455-pedidos
```

Podia ser `/revisar #418`, o link da PR, ou só `/revisar` com o repositório já na branch. O que eu escrever a mais ("de olho no tratamento de erro") chega aos revisores.

```text
Revisão da branch feature/PARC-455-pedidos iniciada (backend). Agora rode: node harness/bin/maestro.mjs proximo
```

### 12. O que acontece, sem mim

1. **Entra na branch** de cada repositório em que ela tem commits, com o remoto atualizado. Mudança minha sem commit bloqueia aqui, antes de qualquer leitura.
2. **Reconhece**: entende o que a branch faz e acha a entrega irmã, para ter com que comparar.
3. **Lê linha por linha**, em lotes. Cada revisor recebe os arquivos do lote, o mapa e, como fato, o que a catraca já viu ali:

   ```text
   - Arquivos do lote: `src/parsers/pedidos/index.ts`, `src/parsers/pedidos/pedidos.parser.ts`, […]
   - O que a catraca achou neste lote: [BLOQUEIO] api-parceiros/src/parsers/pedidos/index.ts:12 — importa "../../infra/http": domínio não conhece infraestrutura
   ```

4. **Ajusta.** Cada lote com achado vira um commit pequeno, que passa pelos portões e por um revisor antes de existir. O trabalho é melhorar o código que a branch escreveu, sem mudar o que ele faz e sem tocar no que ela não escreveu.
5. **Publica**: push na mesma branch e, na PR que já existe, uma seção nova no fim da descrição. O que estava escrito lá fica como estava:

   ```markdown
   ---

   ## Automated review — 2026-11-25

   Line-by-line review of this branch against the project pattern: 14 file(s) in 3 batch(es).

   Changes pushed:
   - `9b1e2f4` refactor(pedidos): receive the http client by parameter — the parser no longer imports infra.
   - `c07aa31` test(pedidos): add the parser test in the stock parser format — covers valid row, null value and unknown channel.

   ### Decisions made by the agent

   Made without asking, by the project rule: the path inside the pattern first; without one, the smallest deviation. Please check them in review.

   - Review: kept the parser signature — two callers use it — renaming was discarded

   ### Proofs (generated by the harness, not by the model)

   - Local gates (lint, tipos, testes, build): green for commit c07aa31.
   - Diff checks: 0 blocks.
   ```

6. **Espera os checks** do push e corrige o que vier vermelho.

```text
REVISÃO — Revisão da branch feature/PARC-455-pedidos

PR de backend: #418 — 3 checks verdes, pronta para revisão — https://github.com/empresa/api-parceiros/pull/418

Commits:
- backend 9b1e2f4 refactor(pedidos): receive the http client by parameter
- backend c07aa31 test(pedidos): add the parser test in the stock parser format

Decisões que o agente tomou sozinho (estão na descrição da PR; confira):
- backend: Revisão: kept the parser signature — two callers use it — renaming was discarded

Falta de você: revisar e fazer o merge.
```

O que o `/revisar` não faz: não tira nem põe a PR em rascunho (ela é de quem abriu), não muda o título, não mexe em arquivo protegido que a branch alterou (um `package.json` que eu mudei continua como eu deixei) e não cria pasta nem arquivo na raiz. Sem PR aberta, ele abre uma, em rascunho, com a descrição. Revisar de novo acrescenta outra seção datada.

Serve igual para a PR de um colega, antes de eu aprovar. Se eu quiser só o relatório, sem nenhuma alteração: `/conferir backend 418`.

## Parte 4 — A mesma tarefa, passo a passo

Para quando eu quero estar no meio: cada etapa numa conversa, eu aprovando o plano e olhando cada fatia. É mais lento, de propósito.

### 13. Planejar

Conversa nova, com o card inteiro:

```text
/planejar PARC-482 — Mostrar o sell-out mensal por canal na página do parceiro.
[o mesmo texto do item 4]
```

O agente não escreve código aqui. Ele reescreve o objetivo, faz o reconhecimento (o mesmo mapa do item 5), escreve o contrato, decide o que a tarefa pede fora do padrão e registra em "Premissas", fatia, e me mostra o resumo: objetivo, uma linha por fatia e as premissas. É o único ponto em que ele espera por mim.

Leio a premissa do gráfico. Se eu concordo, respondo `aprovado`. Se eu quero o gráfico de verdade, quem libera o limite sou eu: rodo o `npm install` da biblioteca (a guarda barra o agente) e escrevo uma linha em "Desvios aprovados" do plano, com `web-parceiros/package.json` e `web-parceiros/package-lock.json` entre crases. É essa linha que faz a catraca mostrar esses arquivos como `[liberado]` em vez de bloqueio.

O que eu confiro antes de aprovar: cada fatia é de um repositório só, tem espelho que existe, e a prova é um teste de verdade. Respondo `aprovado` e fecho a conversa.

Daqui eu posso seguir fatia por fatia, como abaixo, ou mandar `/entregar` sem tarefa: o maestro adota o plano aprovado e conduz o resto sozinho.

### 14. Uma fatia por conversa

Conversa nova, só isto:

```text
/fatia
```

O agente lê o plano, pega a F1, abre os dois espelhos e a regra de padrão, cria a branch da tarefa no `api-parceiros`, diz em cinco linhas o que vai criar e o espelho de cada arquivo, escreve o teste, implementa e prova:

```text
PORTÕES · backend · fatia
✔ diff — 0 bloqueio(s), 0 aviso(s)
✔ lint (6s)
✔ tipos (9s)
✖ testes falhou (21s) — últimas 40 linhas:
  | FAIL src/parsers/sellout/sellout.parser.test.ts
  |   ● SelloutParser › parses a valid row
  |     Expected: 1250  Received: "1250"
  log completo: harness/.logs/backend-testes.log (busque nele; não abra inteiro)
RESULTADO: REPROVADO — portão "testes". Conserte a causa; não desligue a verificação.
```

Ele conserta o parser (não o teste), roda de novo até `RESULTADO: APROVADO`, chama o subagente `revisor` sobre o diff, corrige o que o revisor reprovar, faz um commit e marca `[x]` na F1.

O relatório final cabe na tela: o que entregou, a linha `RESULTADO`, o veredito do revisor, as decisões que tomou e o próximo comando. O que eu confiro: `git -C api-parceiros show --stat` mostra só arquivos de `src/parsers/sellout/`, e o parser novo, lado a lado com o de estoque, parece irmão.

Fecho a conversa, abro outra, `/fatia` de novo: é a F2. Nunca duas fatias na mesma conversa.

**Quando a catraca entra.** Na F4 o agente, apertado com um aviso do lint, escreve `// eslint-disable-next-line`. No fim do turno ele recebe sozinho:

```text
CATRACA DO HARNESS — o diff desta conversa tem 1 bloqueio(s):
[BLOQUEIO] api-parceiros/src/usecases/sellout/listar-sellout.usecase.ts:18 — desliga o lint (eslint-disable)
Corrija a causa agora. Isto é limite da lei (seção 2): não contorne. Se o trabalho não fecha sem ele, desfaça a mudança, entregue o resto e registre a pendência.
```

E volta a trabalhar: tira o comentário e resolve o que o lint apontava.

### 15. PR do backend

Conversa nova:

```text
/pr backend
```

Ele confere que as fatias do backend estão marcadas, chama o revisor sobre o diff inteiro contra a base, roda `node harness/bin/portoes.mjs backend --pr`, escreve a descrição para o revisor humano (o que e por quê, como revisar, provas, decisões, pendências, fora do escopo), faz push, abre a PR em rascunho e espera:

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

### 16. Fatias do frontend

Não espero o merge do backend para seguir: o contrato está no plano, e a fatia do frontend lê o contrato, não o código do backend. Uma conversa por fatia: tipos e serviço, o card com componentes do Flora, o encaixe na página.

O que eu confiro em cada uma: o card novo usa os mesmos componentes do Flora que o espelho, nenhuma cor ou espaçamento fixo, teste junto.

### 17. QA na tela

Conversa nova:

```text
/qa
```

O agente monta o roteiro a partir dos quatro critérios, sobe backend e frontend com os comandos de `repos.*.subir`, abre o navegador do Cursor e para no login: eu entro, ele continua. Testa cada critério, mais carregando, vazio, erro e a tela vizinha, e escreve o resultado no próprio plano, na seção "QA na tela":

```markdown
| Critério | Resultado | Evidência |
|---|---|---|
| CA1 card com valores por canal | passou | captura 01 |
| CA2 seletor de mês, padrão no atual | passou | captura 02 |
| CA3 sem dado mostra estado vazio padrão | FALHOU | captura 03: card some em vez de mostrar o vazio |
| CA4 erro da API mostra aviso padrão | passou | captura 04, 500 simulado |
```

Ele não corrige. Acrescenta ao plano uma fatia ("estado vazio do card", com espelho e prova) e encerra. Conversa nova, `/fatia`, depois `/qa` de novo: tudo passou.

### 18. PR do frontend

```text
/pr frontend
```

Mesmo caminho: revisor, portões, descrição com o resumo do QA, PR em rascunho, checks, verde.

### 19. A revisão humana

O colega comenta na PR do backend: "nome de teste aqui é sempre no presente, sem 'should'". Conversa nova:

```text
/pr backend
```

Como a PR já existe e tem comentário, o agente vai para a parte C: lê os comentários, renomeia os testes em commit novo, roda portões e checks, e propõe:

```text
Linha que faltava em .cursor/rules/padrao-backend.mdc, seção Convenções:
- Nome de teste: verbo no presente, sem "should" → src/parsers/estoque/estoque.parser.test.ts
Posso acrescentar?
```

Respondo que sim. O que o revisor pegou uma vez virou lei: a próxima tarefa já nasce certa, no passo a passo ou no `/entregar`. Se desse para pegar por texto, eu pediria também uma regra em `proibido` no `config.json`.

### 20. Fechar

O colega aprova e faz o merge das duas PRs. Eu troco `Status` do plano para `concluído`.

## Parte 5 — Variações

### Nas extensões do Claude Code e do Codex

Mesma raiz, mesma lei, mesmos roteiros. Muda a forma de chamar:

| | Agente do Cursor | Claude Code | Codex |
|---|---|---|---|
| Chamar um comando | `/entregar`, `/revisar` | `/entregar`, `/revisar` | `$entregar`, `$revisar` |
| Ver os hooks | Customize → Hooks | `/hooks` | `/hooks` (revisar e confiar) |

Dá para misturar: planejar numa ferramenta e implementar em outra, porque o estado está no disco, não na conversa.

### Só auditar, sem alterar

```text
/conferir backend 418
```

O agente faz checkout da PR, roda catraca e portões contra a base, manda o revisor comparar o diff com o padrão, lê os checks e devolve o relatório na conversa: veredito, bloqueantes com arquivo e linha, perguntas que só eu respondo ("o `package.json` mudou: foi você?"). Não altera nada, não comenta na PR e não grava arquivo. Para corrigir o que ele achou: `/revisar feature/PARC-455-pedidos`.

### Pedido pequeno

"Troca o texto do botão para 'Exportar CSV'." Um arquivo, nenhuma decisão: peço direto, sem plano. A lei continua valendo: o agente abre o espelho, a catraca confere o diff no fim do turno, e antes do commit eu rodo `node harness/bin/portoes.mjs frontend`.

## Cola

| Quero… | Faço |
|---|---|
| Instalar ou atualizar | `node ~/domain-harness/instalar.mjs <raiz> [--com claude,codex] [--limpar]` |
| Saber se está tudo no lugar | `node harness/bin/doutor.mjs` |
| Entregar uma tarefa inteira, do pedido à PR | `/entregar <card e critérios>` |
| Deixar no padrão uma branch ou PR que já existe | `/revisar <branch, número ou link da PR>` |
| Continuar uma condução que parou ou bloqueou | `/entregar`, sem tarefa |
| Saber onde a condução está | `node harness/bin/maestro.mjs estado` |
| Largar uma condução | `node harness/bin/maestro.mjs encerrar` |
| Ver o que o agente decidiu sozinho | a seção "Decisões" da PR, ou do `plano.md` |
| Recuperar algo que o maestro descartou | `harness/.maestro/descartados/<tarefa>/` |
| PR com a descrição em português | `"idiomaDaPr": "pt"` em `convencoes`, no `harness/config.json` |
| Liberar um limite da lei (uma dependência nova) | eu instalo, e escrevo uma linha em "Desvios aprovados" do plano, com o caminho entre crases |
| Começar uma tarefa passo a passo | `/planejar <card e critérios>` |
| Fazer a próxima fatia | conversa nova, `/fatia` |
| Ver se o que está na pasta passa | `node harness/bin/portoes.mjs backend` |
| Testar na tela | `/qa` |
| Abrir a PR, ou tratar a revisão | `/pr backend` |
| Só olhar os checks da PR | `node harness/bin/esperar-checks.mjs backend` |
| Auditar uma PR sem alterar nada | `/conferir backend 418` |
| Ensinar algo novo ao harness | uma linha no arquivo de padrão, ou uma regra em `harness/config.json` |
