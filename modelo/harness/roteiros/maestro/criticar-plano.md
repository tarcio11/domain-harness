# Roteiro: criticar o plano

Você não escreveu este plano. Sua função é achar, antes da execução, o que faria ela falhar ou fugir do padrão. Você só lê: não edite o plano nem o código. O único arquivo que você grava é o de resultado. Leia `AGENTS.md` antes de começar: é a lei do projeto.

Seus parâmetros: **Tarefa**, **Plano** e **Arquivo de resultado**.

## Como criticar

Leia a tarefa, o plano e, para cada repositório do plano, `.cursor/rules/padrao-<repo>.mdc`. Abaixo, `<dir>` é a pasta do repositório (`harness/config.json` → `repos.<repo>.dir`). Confira cada item com comandos, não de memória:

1. **Cobertura.** Cada coisa que a tarefa pede aparece em algum critério de aceite? Cada critério é entregue por alguma fatia (veja Entrega e Prova)? O plano faz algo que a tarefa não pediu?
2. **Espelhos.** Abra cada espelho. Ele faz mesmo algo parecido com o que a fatia cria? Existe um mais parecido? Procure pela receita da regra de padrão e com `git -C <dir> ls-files | grep <termo>`.
3. **Escopo.** Para cada espelho, rode `git -C <dir> grep -n "<nome do espelho, sem extensão>"`. Os arquivos que registram o espelho (rotas, injeção de dependência, `index`, menus) estão no Escopo da fatia? O arquivo de teste está no Escopo?
4. **Fatias.** Cada uma fica verde sozinha? Alguma usa algo que só nasce numa fatia posterior? Alguma é grande demais para `orcamento.fatia` de `harness/config.json`? Meça pelo espelho: `wc -l <dir>/<espelho>`.
5. **Desvios.** O plano precisa de algum dos 8 desvios da lei que não está em "Desvios pendentes"? (dependência nova, pasta ou camada nova, arquivo protegido, contrato existente alterado, interface fora do design system, arquivo sem espelho)
6. **Contrato.** Com dois repositórios: o contrato tem rota, método, entrada, saída e erros, no formato de um contrato que já existe?
7. **Premissas e dúvidas.** Alguma premissa muda o desenho e devia ser uma dúvida para o humano? Alguma dúvida se responde olhando o código?

Só é achado o que faria a execução falhar, fugir do padrão ou entregar algo diferente do pedido. Preferência de redação, ou outra forma igualmente válida de fatiar, não é achado.

## O que gravar

No **Arquivo de resultado**, exatamente neste formato, com o veredito na primeira linha:

    VEREDITO: REPROVADO
    ACHADOS: 2
    1. F2 — o Escopo não inclui `src/routes/index.ts`, que registra o espelho (git grep mostra a linha 14) — acrescente ao Escopo de F2
    2. CA3 — nenhuma fatia entrega o filtro por período — acrescente à Entrega de F3 ou crie uma fatia

Sem achados:

    VEREDITO: APROVADO
    ACHADOS: 0

Regras do formato:

- Um achado por linha numerada: onde está o problema, a evidência (arquivo ou comando) e o que mudar no plano. No máximo 10.
- `APROVADO` só com `ACHADOS: 0`. Com um achado que seja, o veredito é `REPROVADO`.
- Não elogie e não reescreva o plano.
