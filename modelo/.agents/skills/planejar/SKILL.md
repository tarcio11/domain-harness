---
name: planejar
description: Transforma uma tarefa em plano fatiado (critérios de aceite, contrato, fatias com espelho e prova), sem escrever código. Só roda quando o humano chama /planejar.
disable-model-invocation: true
---

# /planejar <descrição ou card da tarefa>

Saída desta conversa: `harness/tarefas/<id>/plano.md` aprovado pelo humano. Nenhuma linha de código de produto, nenhuma branch criada.

## Passos

1. **Entenda.** Reescreva o objetivo em 2 linhas e os critérios de aceite como itens verificáveis ("dado…, quando…, então…"). Se falta informação que muda o desenho, faça até 3 perguntas e pare.

2. **Localize no padrão.** Para cada repositório afetado, leia `.cursor/rules/padrao-<repo>.mdc` e ache a receita e os espelhos dessa entrega. Busca no código vai para um subagente de exploração; para você volta só a lista de arquivos.

3. **Contrato.** Se a tarefa toca os dois repositórios, escreva o contrato da API (rota, método, entrada, saída, erros) no formato do contrato-espelho. Ele é o único ponto em comum: a fatia do frontend lê o contrato, nunca o código do backend.

4. **Desvios.** Compare o que a tarefa exige com a lista de desvios da lei (`AGENTS.md`, seção 2). Para cada um, apresente o bloco DESVIO DE PADRÃO e pare. Sem decisão do humano não há plano.

5. **Fatie.** Cada fatia:
   - é de um repositório só e de uma camada (ou um passo fino de ponta a ponta);
   - cabe em `harness/config.json` → `orcamento.fatia`;
   - termina verde sozinha: compila e os testes passam;
   - traz o teste junto com o código que ele cobre;
   - tem **Escopo** (pastas e arquivos que pode tocar, incluindo os de teste), **Espelho** (arquivos existentes a imitar), **Entrega** (o que passa a existir) e **Prova** (o teste ou comando que demonstra).

   Ordem: backend de dentro para fora (regra de negócio → parser/integração → API), depois frontend (tipos e serviço → componentes → tela), depois QA.

6. **PRs.** Uma PR por repositório, backend primeiro. Se as fatias de um repositório somarem mais que `orcamento.pr`, divida em mais de uma PR e diga onde cortar.

7. **Grave.** Crie `harness/tarefas/<id>/plano.md` a partir de `harness/modelos/plano.md`. `<id>` é o código do card mais um resumo em kebab-case; sem card, data mais resumo. Escreva o `<id>` em `harness/tarefas/ATUAL`. Nome de branch conforme `convencoes.branch`; se a tarefa continua uma branch que já existe (por exemplo, adequar uma PR depois do `/conferir`), a branch do plano é ela, e as fatias são os bloqueantes do relatório.

8. **Pare.** Mostre o plano resumido (objetivo, uma linha por fatia, desvios) e espere o humano responder "aprovado". Só então troque `Status` para `aprovado`.
