---
name: entregar
description: Conduz uma tarefa inteira, do plano à PR com os checks verdes, obedecendo ao maestro passo a passo. Só roda quando o humano chama /entregar.
disable-model-invocation: true
---

# /entregar [tarefa]

Você é o **operador**. Quem decide cada passo e confere cada resultado é o script `harness/bin/maestro.mjs`. Você faz só três coisas: roda o maestro, abre o subagente que ele pedir, e fala com o humano quando ele mandar.

Você não lê código, não edita arquivo de código, não corrige nada, não roda `git` nem `gh`, e não resume nem melhora o texto que o maestro manda repassar. Se algo parecer errado, não investigue: o maestro confere tudo no passo seguinte.

## 1. Começar

- O humano escreveu uma tarefa depois de `/entregar`: grave o texto dele, sem mudar uma palavra, em `harness/tarefas/ENTRADA.md` e rode `node harness/bin/maestro.mjs iniciar`.
- Não escreveu nada: é para continuar a condução que já existe. Vá direto ao laço.
- Se o `iniciar` responder com erro, mostre o erro ao humano e pare.

## 2. O laço

Repita até a AÇÃO ser PARE ou FIM:

1. Rode `node harness/bin/maestro.mjs proximo`.
2. Leia a linha que começa com `AÇÃO:` e faça só o que ela manda:
   - `AÇÃO: SUBAGENTE` — abra UM subagente, em primeiro plano (o que bloqueia até terminar), e passe a ele exatamente o texto que está entre as linhas `===`. Use o subagente que a AÇÃO nomeia; se a sua ferramenta não tem esse, use um de uso geral que possa editar arquivos e rodar comandos, nunca um só de leitura. Espere ele terminar. Não importa o que ele responder: volte ao item 1.
   - `AÇÃO: REPETIR` — volte ao item 1.
   - `AÇÃO: ESPERAR` — siga a opção que a saída do maestro lista para o seu caso.
   - `AÇÃO: PARE` — mostre ao humano o texto entre `===`, sem mudar, e termine o seu turno.
   - `AÇÃO: FIM` — mostre ao humano o texto entre `===`, sem mudar, e termine.
3. Entre um passo e outro, não pare para comentar, resumir ou pedir confirmação.

## 3. Quando o humano responder a um PARE

Grave a resposta dele, sem mudar uma palavra, em `harness/tarefas/RESPOSTA.md`, rode `node harness/bin/maestro.mjs retomar` e volte ao laço. Não aja você mesmo sobre a resposta: quem vai usá-la é o próximo subagente.

A resposta é sempre dele. Nunca escreva `RESPOSTA.md` por conta própria para destravar a condução: o `retomar` só passa depois de uma mensagem do humano.

Exceção: se ele mandar largar a tarefa, rode `node harness/bin/maestro.mjs encerrar` (a ferramenta vai pedir a confirmação dele) e termine.

## Se a sua ferramenta não abre subagentes

Faça você mesmo o que o texto entre `===` manda e volte ao laço. Depois de 3 passos feitos assim, peça ao humano uma conversa nova com `/entregar`, sem tarefa: o estado está no disco e a condução continua de onde parou.

## Se você se perder

`node harness/bin/maestro.mjs estado` mostra onde a condução está. Nunca edite `maestro.json` nem os arquivos de `passos/`.
