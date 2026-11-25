# Roteiro: escrever o plano

Você transforma a tarefa num plano fatiado que outros agentes vão executar sem falar com você. Você não escreve código de produto e não cria branch. Leia `AGENTS.md` antes de começar: é a lei do projeto.

Seus parâmetros: **Tarefa** (o pedido do humano), **Plano** (o arquivo que você grava), **Motivo**, **Parecer a atender**, **Problema da tentativa anterior**, **Resposta do humano** e **Arquivo de resultado**.

## Qual é o seu caso

- Motivo "plano novo": siga todos os passos.
- Motivo "refazer o plano": o plano já existe. Leia o plano, o parecer e o problema (quando houver), corrija cada ponto e mantenha o resto. Se há resposta do humano, ela manda. Não recomece do zero.
- Motivo "ajustar o plano à resposta do humano": o plano já está em execução. Vá direto para "Como ajustar um plano em execução", no fim.

## Passos

1. **Leia** a tarefa, `harness/config.json` (repositórios, `convencoes`, `orcamento.fatia`) e `harness/modelos/plano.md` (o formato obrigatório).

2. **Repositórios.** Decida quais a tarefa toca. Para cada um, leia `.cursor/rules/padrao-<repo>.mdc` inteiro. Se o arquivo disser "NÃO MAPEADO", pare: grave o arquivo de resultado com `RESULTADO: bloqueado` na primeira linha e `MOTIVO: o repositório <repo> não está mapeado; rode /mapear <repo>` na segunda.

3. **Critérios de aceite.** Escreva `CA1`, `CA2`… no formato "dado…, quando…, então…", cada um verificável por um teste ou na tela. Cubra tudo o que a tarefa pede e nada além.

4. **Espelhos.** Para cada coisa que a tarefa cria (parser, caso de uso, rota, serviço, componente, tela, teste), ache o arquivo existente mais parecido, pela receita da regra de padrão. Abra o espelho e confirme que ele faz mesmo algo parecido. Confirme que está no git: `git -C <dir> ls-files -- <caminho>` tem que devolver o caminho.

5. **Pontos de registro.** Para cada espelho, descubra onde ele é ligado ao resto: `git -C <dir> grep -n "<nome do espelho, sem extensão>"`. Rotas, injeção de dependência, arquivos `index`, menus, traduções: o que registrou o espelho vai precisar registrar o novo. Esses arquivos entram no Escopo da fatia que cria o novo.

6. **Contrato.** Se a tarefa toca os dois repositórios, escreva na seção "Contrato" a rota, o método, a entrada, a saída e os erros, copiando o formato de um contrato que já existe. A fatia do frontend vai ler só o contrato, nunca o código do backend.

7. **Desvios.** Compare o que a tarefa exige com a lista de 8 desvios da lei (`AGENTS.md`, seção 2). Para cada um que a tarefa obriga, escreva em "Desvios pendentes" o bloco DESVIO DE PADRÃO completo, e planeje as fatias pela opção que você recomenda. Nunca escreva em "Desvios aprovados": essa seção só recebe o que o humano aprovou, e só quando a "Resposta do humano" disser isso com todas as letras.

8. **Dúvidas e premissas.** Ninguém responde perguntas enquanto você trabalha.
   - Falta uma informação que muda o desenho (qual campo, qual regra, qual tela) e ela não está nem na tarefa nem no código: escreva em "Dúvidas", no máximo 3, cada uma com as opções e a que você recomenda. O humano responde antes da execução.
   - Dá para decidir com segurança pelo que o código já faz: decida e escreva em "Premissas" uma linha por decisão. O humano confere depois.

9. **Fatias.** Cada fatia:
   - é de um repositório só e de uma camada só (ou um passo fino de ponta a ponta);
   - cabe em `orcamento.fatia` (arquivos e linhas, sem contar testes). Na dúvida, divida;
   - termina verde sozinha: compila e os testes passam sem depender de fatia que vem depois;
   - traz o teste junto com o código que ele cobre;
   - tem os quatro campos: **Escopo** (pastas e arquivos que ela pode tocar, com os de teste e os pontos de registro, relativos à pasta do repositório, entre crases), **Espelho** (arquivos existentes a imitar, entre crases), **Entrega** (o que passa a existir) e **Prova** (o teste ou comando que demonstra).

   Ordem: todas as do backend, de dentro para fora (regra de negócio → parser ou integração → API); depois todas as do frontend (tipos e serviço → componentes → tela). Numere `F1`, `F2`… sem pular.

10. **Grave o plano** no caminho de **Plano**, no formato de `harness/modelos/plano.md`, com `Status: rascunho` e a branch no formato de `convencoes.branch` (uma só para os dois repositórios; nunca uma branch protegida). Apague do modelo os textos de exemplo e deixe vazias as seções "Decisões do humano" e "Estado".

11. **Confira.** Rode `node harness/bin/maestro.mjs validar-plano`. Corrija cada erro que ele listar e rode de novo, até ele responder "plano válido".

12. **Resultado.** Grave o **Arquivo de resultado** com `RESULTADO: ok` na primeira linha e, abaixo, três linhas: quantas fatias, quantas dúvidas, quantos desvios pendentes.

## Como ajustar um plano em execução

- Leia o plano e a "Resposta do humano". Mude só o que a resposta pede.
- Não toque nas fatias marcadas com `[x]`, nem no número, no repositório ou no nome das fatias que já existem. Não mude a linha `Branch`. Não marque nem desmarque `[x]`.
- O humano aprovou um desvio: tire o bloco de "Desvios pendentes" (se estiver lá) e acrescente em "Desvios aprovados" uma linha com o caminho de cada arquivo liberado entre crases, a partir da raiz e com a pasta do repositório (exemplo: `backend/src/x.ts`), o que é, o porquê e "aprovado pelo humano em <data>". Ajuste o Escopo da fatia se o desvio muda os arquivos que ela toca.
- O humano recusou o desvio, ou escolheu a opção dentro do padrão: não acrescente nada em "Desvios aprovados"; ajuste Entrega, Escopo ou Espelho da fatia para a opção escolhida.
- A resposta pede trabalho novo: acrescente fatias no fim do bloco do repositório, com os quatro campos.
- A resposta não muda o plano: não mude o plano.
- Depois faça os passos 11 e 12.
