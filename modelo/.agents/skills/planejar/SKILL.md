---
name: planejar
description: Transforma uma tarefa em plano fatiado (critérios de aceite, contrato, fatias com espelho e prova), sem escrever código. Só roda quando o humano chama /planejar.
disable-model-invocation: true
---

# /planejar <descrição ou card da tarefa>

Saída desta conversa: `harness/tarefas/<id>/plano.md` aprovado pelo humano. Nenhuma linha de código de produto, nenhuma branch criada.

## Passos

1. **Entenda.** Reescreva o objetivo em 2 linhas e os critérios de aceite como itens verificáveis ("dado…, quando…, então…"). Se falta informação, não pare para perguntar: decida pelo que o código já faz e anote em "Premissas". O humano corrige quando ler o plano.

2. **Reconheça o código.** Para cada repositório afetado, leia `.cursor/rules/padrao-<repo>.mdc`. Depois ache a entrega mais parecida que já existe e siga o fio dela da entrada ao dado, como manda `harness/roteiros/maestro/reconhecer.md` (seção "Como explorar"). A busca vai para um subagente de exploração; para você volta só o mapa. Escreva o mapa na seção "Mapa do código" do plano, no formato desse roteiro.

3. **Contrato.** Se a tarefa toca os dois repositórios, escreva o contrato da API (rota, método, entrada, saída, erros) no formato do contrato-espelho. Ele é o único ponto em comum: a fatia do frontend lê o contrato, nunca o código do backend.

4. **Decisões.** Compare o que a tarefa exige com a seção 2 da lei (`AGENTS.md`) e decida você mesmo, uma linha em "Premissas" para cada decisão: o caminho dentro do padrão quando existe; o menor desvio quando não existe (o que escolheu, por quê e o que descartou); e, quando só fecharia furando um limite, o que fica de fora e o que o humano precisa fazer. Não escreva em "Desvios aprovados": essa seção é só dele.

5. **Fatie.** Cada fatia:
   - é de um repositório só;
   - entrega UM comportamento que um teste prova, com o teste junto. Se o nome da fatia precisa de "e", são duas;
   - cabe com folga em `harness/config.json` → `orcamento.fatia`. Não há limite para o número de fatias;
   - termina verde sozinha: compila e os testes passam;
   - tem **Escopo** (pastas e arquivos que pode tocar, incluindo os de teste), **Espelho** (arquivos existentes a imitar), **Entrega** (o que passa a existir) e **Prova** (o teste ou comando que demonstra).

   Ordem: backend de dentro para fora (regra de negócio → parser/integração → API), depois frontend (tipos e serviço → componentes → tela), depois QA. Cada repositório vira uma PR, backend primeiro.

6. **Grave.** Crie `harness/tarefas/<id>/plano.md` a partir de `harness/modelos/plano.md`. `<id>` é o código do card mais um resumo em kebab-case; sem card, data mais resumo. Escreva o `<id>` em `harness/tarefas/ATUAL`. Nome de branch conforme `convencoes.branch`; se a tarefa continua uma branch que já existe, a branch do plano é ela. (Para só adequar ao padrão uma branch pronta, o comando é `/revisar <branch>`, sem plano.)

7. **Pare.** Mostre o plano resumido (objetivo, uma linha por fatia, premissas) e espere o humano responder "aprovado". É o único ponto em que este comando espera por ele. Só então troque `Status` para `aprovado`. Com o plano aprovado, `/entregar` sem tarefa conduz o resto sozinho; `/fatia` faz uma fatia por conversa.
