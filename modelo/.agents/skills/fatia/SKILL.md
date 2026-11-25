---
name: fatia
description: Implementa UMA fatia do plano da tarefa atual, pelo espelho, prova com os portões, passa pelo revisor e faz um commit. Só roda quando o humano chama /fatia.
disable-model-invocation: true
---

# /fatia [número]

Uma fatia por conversa. Se esta conversa já implementou outra fatia, pare e peça uma conversa nova.

Nos comandos abaixo, `<repo>` é `backend` ou `frontend`, e `<dir>` é a pasta dele: `harness/config.json` → `repos.<repo>.dir`.

## Passos

1. **Carregue só o necessário.** Leia `harness/tarefas/ATUAL` e depois `harness/tarefas/<id>/plano.md`. Pegue a fatia pedida ou a primeira sem `[x]`. Plano sem `Status: aprovado`: pare. Leia a fatia, o contrato, os arquivos de **Espelho** e `.cursor/rules/padrao-<repo>.mdc`. Nada além disso.

2. **Prepare o terreno.** No repositório da fatia: árvore limpa (`git -C <dir> status --short`; se não estiver, pare e avise) e a branch que está no plano. Se ela já existe, entre nela; se não, crie a partir da base atualizada.

3. **Diga o que vai fazer** em até 5 linhas: cada arquivo que cria ou altera e o espelho dele (o plano traz o "Mapa do código"). Algo fora do padrão: não pare. Decida pela seção 2 da lei (caminho dentro do padrão; sem ele, o menor desvio; limite não se fura) e guarde a decisão ou a pendência para o relatório.

4. **Implemente pelo espelho, teste primeiro.** O teste no formato do teste-espelho, vendo falhar; depois o mínimo de código que o faz passar. Mesmo esqueleto, mesmos nomes, mesmo tratamento de erro. Dentro do **Escopo**; se o trabalho precisa mesmo de um arquivo fora dele, diga no relatório qual e por quê.

5. **Prove.** `node harness/bin/portoes.mjs <repo> --escopo <caminhos do Escopo>`. Vermelho: conserte a causa e rode de novo. Três rodadas vermelhas no mesmo erro: pare e relate. Avisos: resolva os que der (aviso de tamanho não bloqueia).

6. **Revisão fria.** `git -C <dir> add <caminhos da fatia>` (nunca `git add -A` nem `.`) e chame o subagente `revisor` com: o repositório, o comando `git -C <dir> diff --cached`, o caminho da regra de padrão e os espelhos. Se a ferramenta não tem subagente com esse nome, abra um subagente comum e mande seguir `harness/roteiros/revisor.md`; sem subagentes, releia você mesmo o diff com esse roteiro. Corrija o que for reprovado e repita o passo 5; ou explique no relatório por que o achado não se aplica.

7. **Commit.** Um commit, mensagem no formato de `convencoes.commit` e no idioma de `convencoes.idioma` (sem a chave, inglês), só os arquivos da fatia. Sem push.

8. **Registre no plano.** Marque a fatia com `[x]`, reescreva a seção "Estado" (o que ficou pronto e o próximo passo) e acrescente em "Decisões no caminho" e em "Pendências" o que você decidiu ou deixou de fora nesta fatia.

9. **Relate em até 10 linhas:** o que foi entregue, a linha `RESULTADO` dos portões, o veredito do revisor, as decisões que você tomou e as pendências. Termine com o próximo comando, sempre em conversa nova: `/fatia` se ainda há fatia aberta; se foi a última, `/qa` (quando a tarefa tem tela) ou `/pr <repo>`.
