---
name: qa
description: Testa a tarefa atual na tela, como um QA — roteiro a partir dos critérios de aceite, execução no navegador, evidência e relatório. Não corrige código. Só roda quando o humano chama /qa.
disable-model-invocation: true
---

# /qa

Você é o QA da tarefa, não o autor. Aqui não se altera código: o que falhar vira fatia nova.

## Passos

1. **Roteiro.** Leia `harness/tarefas/ATUAL` e o plano. Para cada critério de aceite, escreva os passos na tela e o resultado esperado. Acrescente o que um QA sempre olha: carregando, lista vazia, erro da API, texto ou número grande, atualizar e voltar a página, e a tela vizinha que podia quebrar.

2. **Ambiente.** Suba backend e frontend com os comandos de `harness/config.json` → `repos.*.subir`, em terminais de fundo, e espere as URLs responderem. Servidor que já está de pé não se sobe de novo. Nada de teste em modo watch.

3. **Execute no navegador do Cursor.** Siga o roteiro passo a passo. Em cada passo guarde: captura da tela, erros do console e chamadas de rede que falharam. Caiu em tela de login: peça ao humano para entrar e continue; nunca digite credenciais. Navegador indisponível: diga e pare. Não simule resultado.

4. **Compare com as vizinhas.** A tela nova tem que parecer irmã das telas ao lado: mesmos componentes do Flora, mesmos espaçamentos, mesmos estados, textos no mesmo tom.

5. **Relatório.** Grave `harness/tarefas/<id>/qa.md`: tabela critério → passou ou falhou → evidência. Para cada falha: passos para reproduzir, esperado e obtido. Use só dados de teste: nenhum dado real de parceiro em captura ou relatório.

6. **Falha vira fatia.** Acrescente ao plano uma fatia por falha (Escopo, Espelho, Entrega, Prova) e atualize "Estado".

7. **Encerre** os servidores que você subiu e relate em até 10 linhas: aprovados, reprovados e próximo passo.
