# Roteiro: criticar o plano

Você não escreveu este plano. Sua função é achar, antes da execução, o que faria ela falhar ou fugir do padrão. Você só lê: não edite o plano nem o código. O único arquivo que você grava é o de resultado. Leia `AGENTS.md` antes de começar: é a lei do projeto.

Seus parâmetros: **Tarefa**, **Plano** e **Arquivo de resultado**.

## Como criticar

Leia a tarefa, o plano (o "Mapa do código" está nele) e, para cada repositório do plano, `.cursor/rules/padrao-<repo>.mdc`. Abaixo, `<dir>` é a pasta do repositório (`harness/config.json` → `repos.<repo>.dir`). Confira cada item com comandos, não de memória:

1. **Cobertura.** Cada coisa que a tarefa pede aparece em algum critério de aceite? Cada critério é entregue por alguma fatia (veja Entrega e Prova)? O plano faz algo que a tarefa não pediu?
2. **Espelhos.** Abra cada espelho. Ele faz mesmo algo parecido com o que a fatia cria? O mapa aponta um mais parecido? Procure pela receita da regra de padrão e com `git -C <dir> ls-files | grep <termo>`.
3. **Escopo.** Para cada espelho, rode `git -C <dir> grep -n "<nome do espelho, sem extensão>"`. Os arquivos que registram o espelho (rotas, injeção de dependência, `index`, menus) estão no Escopo da fatia? O arquivo de teste está no Escopo?
4. **Fatias.** Cada uma fica verde sozinha? Alguma usa algo que só nasce numa fatia posterior? Alguma entrega mais de um comportamento, ou não cabe com folga em `orcamento.fatia` de `harness/config.json`? Meça pelo espelho: `wc -l <dir>/<espelho>`. Fatia grande é achado: a correção é dividir.
5. **Limites.** O plano fura algum limite da lei (seção 2): dependência nova, arquivo protegido, importação que a camada não pode fazer, interface fora do design system, verificação desligada? Limite não se planeja: o que depende dele sai das fatias e vai para "Premissas".
6. **Contrato.** Com dois repositórios: o contrato tem rota, método, entrada, saída e erros, no formato de um contrato que já existe?
7. **Premissas.** Alguma premissa contraria o que o código já faz? (Abra o arquivo e confira.) Alguma decisão fora do padrão ficou sem linha em "Premissas"?

Só é achado o que faria a execução falhar, fugir do padrão ou entregar algo diferente do pedido. Preferência de redação, ou outra forma igualmente válida de fatiar, não é achado. Premissa razoável não é achado: ninguém vai responder dúvidas, e o plano tem que decidir.

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
