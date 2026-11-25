---
name: entregar
description: Conduz uma tarefa inteira, do pedido à PR com os checks verdes, sem perguntar nada no meio, obedecendo ao maestro passo a passo. Só roda quando o humano chama /entregar.
disable-model-invocation: true
---

# /entregar [tarefa]

Você é o **operador**. Quem decide cada passo e confere cada resultado é o script `harness/bin/maestro.mjs`. Você faz só duas coisas: roda o maestro e abre o subagente que ele pedir.

Você não lê código, não edita arquivo de código, não corrige nada, não roda `git` nem `gh`, não faz perguntas ao humano e não resume nem melhora o texto que o maestro manda repassar. Se algo parecer errado, não investigue: o maestro confere tudo no passo seguinte.

## 1. Começar

- O humano escreveu uma tarefa depois de `/entregar`: grave o texto dele, sem mudar uma palavra, em `harness/trabalho/ENTRADA.md` e rode `node harness/bin/maestro.mjs iniciar`.
- Não escreveu nada: é para continuar a condução que já existe. Rode `node harness/bin/maestro.mjs retomar` e vá direto ao laço.
- Se o comando responder com `AÇÃO: PARE`, mostre ao humano o texto entre `===` e termine.

## 2. O laço

Repita até a AÇÃO ser FIM ou PARE:

1. Rode `node harness/bin/maestro.mjs proximo`.
2. Leia a linha que começa com `AÇÃO:` e faça só o que ela manda:
   - `AÇÃO: SUBAGENTE` — abra UM subagente, em primeiro plano (o que bloqueia até terminar), e passe a ele exatamente o texto que está entre as linhas `===`. Use o subagente que a AÇÃO nomeia; se a sua ferramenta não tem esse, use um de uso geral que possa editar arquivos e rodar comandos, nunca um só de leitura. Espere ele terminar. Não importa o que ele responder: volte ao item 1.
   - `AÇÃO: REPETIR` — volte ao item 1.
   - `AÇÃO: ESPERAR` — siga a opção que a saída do maestro lista para o seu caso.
   - `AÇÃO: FIM` — mostre ao humano o texto entre `===`, sem mudar, e termine.
   - `AÇÃO: PARE` — é um bloqueio que só o humano resolve (ambiente, instalação, mudança dele sem commit). Mostre a ele o texto entre `===`, sem mudar, e termine o seu turno.
3. Entre um passo e outro, não pare para comentar, resumir ou pedir confirmação. O maestro não faz perguntas ao humano, e você também não: decisão é com os subagentes, e o que não fechar o maestro escreve na PR.

## 3. Depois de um PARE

Quando o humano responder (ele resolveu o bloqueio), rode `node harness/bin/maestro.mjs retomar` e volte ao laço. Nunca rode `retomar` no mesmo turno em que o PARE apareceu: quem libera um bloqueio é o humano.

Se ele mandar largar a tarefa, rode `node harness/bin/maestro.mjs encerrar` (a ferramenta vai pedir a confirmação dele) e termine.

## Se a sua ferramenta não abre subagentes

Faça você mesmo o que o texto entre `===` manda e volte ao laço. Depois de 3 passos feitos assim, peça ao humano uma conversa nova com `/entregar`, sem tarefa: o estado está no disco e a condução continua de onde parou.

## Se você se perder

`node harness/bin/maestro.mjs estado` mostra onde a condução está. Nunca edite arquivos de `harness/.maestro/` nem de `harness/trabalho/` por conta própria.
