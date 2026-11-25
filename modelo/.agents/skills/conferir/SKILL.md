---
name: conferir
description: Audita uma branch ou PR que já existe, feita com ou sem o harness, contra o padrão do projeto, os portões e os checks. Só relata; não altera código nem a PR. Só roda quando o humano chama /conferir.
disable-model-invocation: true
---

# /conferir <backend|frontend> [número da PR]

Você é auditor: não escreveu este código e não vai alterá-lo. Não precisa de plano. Não comente, não aprove e não mexa na PR: o relatório é para o humano.

Nos comandos abaixo, `<repo>` é `backend` ou `frontend`; `<dir>` e `<base>` são a pasta e a branch base dele em `harness/config.json` → `repos.<repo>`.

## Passos

1. **Prepare.** `.cursor/rules/padrao-<repo>.mdc` tem que estar mapeado; se diz "NÃO MAPEADO", pare e peça `/mapear <repo>`. Árvore limpa (`git -C <dir> status --short`; se não estiver, pare). Com número de PR: dentro de `<dir>`, `gh pr checkout <número>`. Sem número: audita a branch atual. Rode `git -C <dir> fetch origin`.

2. **Meça.** `git -C <dir> diff --stat origin/<base>...HEAD | tail -n 1`. Guarde o tamanho: ele decide como dividir a revisão no passo 4. Não abra o diff inteiro na sua conversa.

3. **Catraca e portões.** `node harness/bin/portoes.mjs <repo> --pr`. Guarde a saída inteira: bloqueios, avisos e portão vermelho são achados. Arquivo protegido alterado (`package.json`, CI, lint) não é erro por si: é pergunta para o humano ("foi você quem mudou?").

4. **Padrão.** Chame o subagente `revisor` com o comando `git -C <dir> diff origin/<base>...HEAD` e o caminho da regra de padrão; sem plano, ele acha os espelhos pela regra. Diff acima de `orcamento.pr`: um revisor por pasta de primeiro nível do diff (`... -- <pasta>`). Se a ferramenta não tem subagente com esse nome, abra um subagente comum e mande seguir `harness/roteiros/revisor.md`; sem subagentes, siga você mesmo esse roteiro, pasta por pasta.

5. **Checks.** Se existe PR: `node harness/bin/esperar-checks.mjs <repo>` e guarde o resumo.

6. **Critérios.** Se o humano passou o card ou os critérios de aceite, diga de cada um: atendido, não atendido ou não dá para saber pelo diff.

7. **Relatório.** Grave `harness/tarefas/auditoria-<branch em kebab-case>/relatorio.md` e mostre no chat, em até 25 linhas:
   - `VEREDITO: DENTRO DO PADRÃO`, `FORA DO PADRÃO (n bloqueantes)` ou `NÃO DEU PARA AUDITAR` (e por quê);
   - **Bloqueantes** — `arquivo:linha — problema — regra ou espelho que comprova — correção em uma frase`;
   - **Perguntas para o humano** — desvios que só ele pode confirmar (dependência, arquivo protegido, pasta nova);
   - **Avisos** — tamanho do diff, comentários, falta de teste, checks vermelhos;
   - **Fora do alcance** — o que você não conseguiu verificar.

8. **Pare.** Não corrija nada. Diga o próximo passo: para adequar, `/planejar adequar a branch <nome> ao padrão`, usando os bloqueantes do relatório como fatias e a branch existente como branch do plano.
