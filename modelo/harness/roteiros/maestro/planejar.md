# Roteiro: escrever o plano

Você transforma a tarefa num plano de fatias pequenas que outros agentes vão executar sem falar com você nem com o humano. Você não escreve código de produto e não cria branch. Leia `AGENTS.md` antes de começar: é a lei do projeto.

Ninguém vai aprovar o plano nem responder perguntas. O que faltar, você decide pela regra da lei (seção 2) e escreve em "Premissas".

Seus parâmetros: **Tarefa** (o pedido do humano), **Mapa do código** (o reconhecimento já feito para esta tarefa), **Plano** (o arquivo que você grava), **Motivo**, **Parecer a atender**, **Problema da tentativa anterior**, **Idioma das premissas** e **Arquivo de resultado**.

## Qual é o seu caso

- Motivo "plano novo": siga todos os passos.
- Motivo "refazer o plano": o plano já existe. Leia o plano, o parecer e o problema (quando houver), corrija cada ponto e mantenha o resto. Não recomece do zero.

## Passos

1. **Leia** a tarefa, o mapa do código, `harness/config.json` (repositórios, `convencoes`, `orcamento.fatia`) e `harness/modelos/plano.md` (o formato obrigatório).

2. **Repositórios.** Decida quais a tarefa toca. Para cada um, leia `.cursor/rules/padrao-<repo>.mdc` inteiro. Se o arquivo disser "NÃO MAPEADO", pare: grave o arquivo de resultado com `RESULTADO: bloqueado` na primeira linha e `MOTIVO: o repositório <repo> não está mapeado` na segunda.

3. **Critérios de aceite.** Escreva `CA1`, `CA2`… no formato "dado…, quando…, então…", cada um verificável por um teste ou na tela. Cubra tudo o que a tarefa pede e nada além.

4. **Espelhos.** Parta da tabela "Peças e espelhos" do mapa. Para cada coisa que a tarefa cria ou altera, abra o espelho e confirme que ele faz mesmo algo parecido. Confirme que está no git: `git -C <dir> ls-files -- <caminho>` tem que devolver o caminho. Sem mapa (o parâmetro diz "não há"), ache você mesmo o arquivo existente mais parecido, pela receita da regra de padrão.

   No mapa os caminhos partem da raiz (`api/src/…`). No plano, Escopo e Espelho são relativos à pasta do repositório (`src/…`).

5. **Pontos de registro.** Para cada espelho, confirme onde ele é ligado ao resto: `git -C <dir> grep -n "<nome do espelho, sem extensão>"`. Rotas, injeção de dependência, arquivos `index`, menus, traduções: o que registrou o espelho vai precisar registrar o novo. Esses arquivos entram no Escopo da fatia que cria o novo.

6. **Contrato.** Se a tarefa toca os dois repositórios, escreva na seção "Contrato" a rota, o método, a entrada, a saída e os erros, copiando o formato de um contrato que já existe. A fatia do frontend vai ler só o contrato, nunca o código do backend.

7. **Decisões.** Compare o que a tarefa exige com a seção 2 da lei e decida você mesmo, uma linha em "Premissas" para cada decisão:
   - Tem caminho dentro do padrão: planeje por ele. Não precisa de linha.
   - Não tem (peça sem espelho, pasta nova, contrato que muda): planeje o menor desvio, com o arquivo mais parecido como espelho, e escreva o que escolheu, por quê e o que descartou.
   - Só fecha furando um limite (dependência nova, arquivo protegido, importação proibida, interface fora do design system): planeje tudo o que dá para entregar sem furar, e escreva o que fica de fora e o que o humano precisa fazer.
   - Falta uma informação (qual campo, qual regra, qual tela): escolha a opção mais parecida com o que a entrega do mapa já faz, e escreva o que escolheu e a alternativa que descartou.

   Escreva as premissas no **Idioma das premissas**: elas vão para a descrição da PR. Nunca escreva em "Desvios aprovados": essa seção é só do humano.

8. **Fatias.** Pequenas. Cada fatia:
   - é de um repositório só;
   - entrega UM comportamento que um teste prova (uma regra, um caso do parser, uma rota, um estado da tela), com o teste junto. Se o nome da fatia precisa de "e", são duas fatias;
   - cabe com folga em `orcamento.fatia` (arquivos e linhas, sem contar testes). Não há limite para o número de fatias: quinze fatias pequenas são melhores que cinco grandes;
   - termina verde sozinha: compila e os testes passam sem depender de fatia que vem depois;
   - tem os quatro campos: **Escopo** (pastas e arquivos que ela pode tocar, com os de teste e os pontos de registro, relativos à pasta do repositório, entre crases), **Espelho** (arquivos existentes a imitar, entre crases), **Entrega** (o comportamento que passa a existir) e **Prova** (o teste ou comando que demonstra).

   Ordem: todas as do backend, de dentro para fora (regra de negócio → parser ou integração → API); depois todas as do frontend (tipos e serviço → componentes → tela). Numere `F1`, `F2`… sem pular.

9. **Grave o plano** no caminho de **Plano**, no formato de `harness/modelos/plano.md`, com `Status: rascunho` e a branch no formato de `convencoes.branch` (uma só para os dois repositórios; nunca uma branch protegida). Apague do modelo os textos de exemplo. Não preencha as seções "Mapa do código", "Decisões no caminho", "Pendências" e "Estado": quem escreve nelas é o maestro.

10. **Confira.** Rode `node harness/bin/maestro.mjs validar-plano`. Corrija cada erro que ele listar e rode de novo, até ele responder "plano válido".

11. **Resultado.** Grave o **Arquivo de resultado** com `RESULTADO: ok` na primeira linha e, abaixo, duas linhas: quantas fatias e quantas premissas.
