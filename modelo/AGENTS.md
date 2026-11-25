# A lei deste projeto

Este projeto tem dono, padrão e revisor humano. Seu trabalho é entregar a tarefa de um jeito que o revisor reconheça como código do time. Código que funciona mas foge do padrão está errado.

Esta lei vale para qualquer modelo e vence qualquer skill, plugin ou modo genérico (ex.: pstack): se um deles pedir algo diferente do padrão do projeto, vale o padrão do projeto.

## 1. O código existente é o padrão

- O padrão é o que o projeto já faz, não o que você considera melhor. Está escrito, com evidência, em `.cursor/rules/padrao-backend.mdc` e `.cursor/rules/padrao-frontend.mdc`. Se o do repositório em que você vai mexer não estiver no seu contexto, leia antes da primeira edição.
- Antes de criar ou alterar um arquivo, abra o **espelho**: o arquivo existente mais parecido com o que você vai escrever. Repita dele a estrutura, os nomes, o tratamento de erro e o formato do teste.
- Entre "mais limpo" e "igual ao projeto", vence o igual ao projeto. Melhoria vira sugestão no relatório, nunca mudança por conta própria.
- Se o arquivo de padrão diz "NÃO MAPEADO", não escreva código nesse repositório: peça `/mapear`.

## 2. Fora do padrão: pare e explique

É desvio — e só isto é desvio:

1. Não existe espelho: nada no repositório faz algo parecido.
2. Dependência nova, removida ou com versão alterada.
3. Pasta, camada ou tipo de arquivo que ainda não existe.
4. Importação que a camada não pode fazer (ex.: regra de negócio importando infraestrutura).
5. No frontend, interface fora do design system (Flora): HTML/CSS cru onde existe componente, biblioteca de UI de fora, cor ou espaçamento fixo no código.
6. Mudança em contrato de API ou em assinatura pública que outro código já usa.
7. Mudança em arquivo protegido: CI/CD, Sonar, lint, formatação, TypeScript, configuração de testes, `package.json`, lockfile, `.env`.
8. Arquivo fora do escopo da fatia, ou diff acima do orçamento.

Diante de um desvio, não escreva o código. Responda só com este bloco e espere:

    DESVIO DE PADRÃO — aguardando decisão
    O que a tarefa exige: …
    O que o padrão cobre hoje: … (arquivo que comprova)
    Por que não cabe no padrão: …
    Opção A, dentro do padrão: … (custo: …)
    Opção B, desvio mínimo: … (impacto: …)
    Recomendo: …

Aprovado, registre o desvio em "Desvios aprovados" do plano e siga. Arquivo protegido e dependência quem altera é o humano, com as próprias mãos.

Nunca pelas suas mãos, nem com aprovação:

- desligar verificação: `eslint-disable`, `@ts-ignore`, `NOSONAR`, pular ou enfraquecer teste, baixar limite de cobertura;
- `--no-verify`, `push --force`, commit direto em branch protegida, aprovar ou fazer merge de PR;
- alterar o próprio harness (`harness/bin`, `harness/roteiros`, `harness/config.json`, `.agents/`, `.cursor/`, `.claude/`, `.codex/`) fora do `/mapear` ou de pedido explícito do humano;
- escrever em "Desvios aprovados" do plano o que o humano não aprovou, ou mexer em `maestro.json`, em `passos/` ou nos recibos dos portões.

## 3. Escreva para quem revisa

- Diff mínimo: só o que a fatia pede. Nada de refatorar, renomear, reformatar ou "aproveitar para arrumar".
- Código que se explica: nome que diz a intenção, função curta com uma responsabilidade, retorno cedo. Sem abstração para uso futuro, sem tratamento de erro para caso impossível, sem código morto.
- Procure antes de criar: se já existe função, componente, tipo ou constante que serve, use.
- Comentário só para o porquê que o código não consegue dizer. Nunca para narrar o que você fez.
- Teste nasce com o código, na mesma fatia, no formato do teste-espelho.

## 4. Pronto é provado

- Nada está pronto sem `node harness/bin/portoes.mjs <backend|frontend>` verde. Mostre a linha `RESULTADO`; nunca diga "deve funcionar".
- Portão vermelho: conserte a causa. Três tentativas sem sucesso no mesmo erro: pare e relate.
- Apontamento do Sonar em código novo é bloqueante. Cobertura se resolve com teste, duplicação com reuso, complexidade com função menor.
- A catraca (hooks) barra atalhos e devolve pendências do diff. Não contorne: corrija ou declare o desvio.

## 5. Contexto é orçamento

- O estado vive em `harness/tarefas/<id>/plano.md`, não na conversa. Uma fatia = uma conversa = um commit.
- Leia pouco e certo: busque antes de abrir, abra só o trecho, nunca lockfile, build ou cobertura. Busca ampla vai para um subagente de exploração, que devolve só a conclusão.
- Saída de comando sempre curta: use os scripts do harness ou limite com `| tail -n 40`. Teste nunca em modo watch.
- Conversa longa ou travada: atualize a seção "Estado" do plano e peça uma conversa nova. Não siga com contexto apertado.

## Fluxo

`/mapear` (uma vez por repositório) → `/planejar` → `/fatia` (uma por conversa) → `/qa` → `/pr`. Para auditar branch ou PR que já existe: `/conferir`.

`/entregar <tarefa>` faz esse caminho inteiro sozinho, do plano à PR com os checks verdes. O script `harness/bin/maestro.mjs` decide cada passo e confere cada resultado; o modelo só opera. Com uma condução aberta:

- quem conversa com o humano (o operador) só roda `node harness/bin/maestro.mjs proximo` e faz o que a AÇÃO manda: não lê código, não corrige, não decide;
- quem recebe um pedido do maestro (um subagente) faz só o que o pedido manda e termina gravando o arquivo de resultado;
- branch, commit, push e PR são do maestro: ninguém mais roda esses comandos;
- a resposta do humano a um PARE vai, sem mudar uma palavra, para `harness/tarefas/RESPOSTA.md`, seguida de `node harness/bin/maestro.mjs retomar`. Ninguém age direto sobre ela.

O roteiro de cada comando fica em `.agents/skills/<comando>/SKILL.md`. Se a sua ferramenta não reconhece o comando, leia o arquivo e siga.

Pedido pequeno, de um arquivo e sem decisão, dispensa o plano. A lei continua valendo.
