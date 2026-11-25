---
name: pr
description: Revisa o diff completo, prova com os portões, abre a PR no GitHub escrita para o revisor humano, espera os checks (CI e Sonar) e corrige o que reprovar. Também trata os comentários da revisão. Só roda quando o humano chama /pr.
disable-model-invocation: true
---

# /pr <backend|frontend>

Rode numa conversa nova: quem abre a PR não pode ser a conversa que escreveu o código. Você nunca aprova nem faz merge.

Se a PR desta branch já existe e tem comentários de revisão, vá direto para a parte C.

Nos comandos abaixo, `<repo>` é `backend` ou `frontend`; `<dir>` e `<base>` são a pasta e a branch base dele em `harness/config.json` → `repos.<repo>`.

## A. Abrir

1. **Confira.** Plano da tarefa atual (`harness/tarefas/ATUAL`); todas as fatias do repositório com `[x]`; árvore limpa; branch da tarefa. Rode `git -C <dir> fetch origin`. Se a base andou e há conflito, pare e avise.

2. **Revisão fria do conjunto.** Chame o subagente `revisor` com `git -C <dir> diff origin/<base>...HEAD`, a regra de padrão e os espelhos do plano. Se a ferramenta não tem subagente com esse nome, abra um subagente comum e mande seguir `harness/roteiros/revisor.md`; sem subagentes, faça você mesmo com esse roteiro. Reprovou: corrija em commit novo, dentro da lei.

3. **Portões.** `node harness/bin/portoes.mjs <repo> --pr`. Só segue com `RESULTADO: APROVADO`.

4. **Descrição.** Escreva `harness/trabalho/pr-<repo>.md` (arquivo temporário; apague depois de publicar) no modelo de PR do repositório (`convencoes.modeloPr`). Sem modelo, use estas seções, curtas:
   - **O que e por quê** — 3 linhas, com o card;
   - **Como revisar** — ordem de leitura dos arquivos e o que é espelho de quê;
   - **Provas** — a linha `RESULTADO` dos portões e o resumo do QA (seção "QA na tela" do plano), se houver;
   - **Decisões** — cópia de "Premissas" e de "Decisões no caminho" do plano, ou "nenhuma";
   - **Pendências** — cópia de "Pendências" do plano; com pendência, a PR abre em rascunho;
   - **Fora do escopo** — o que você viu e não mexeu.

   Título e descrição no idioma de `convencoes.idioma` (a descrição, no de `convencoes.idiomaDaPr`, se a chave existir).

5. **Publique.** `git -C <dir> push -u origin <branch>`. Depois, dentro de `<dir>`:
   - se a PR ainda não existe (`gh pr view` não acha): `gh pr create --base <base> --title "<no formato de convencoes.tituloPr>" --body-file <caminho absoluto de pr-<repo>.md>`, com `--draft` se `convencoes.prRascunho` for `true`;
   - se já existe: o push basta. Só mexa na descrição se o humano pedir.

## B. Esperar e corrigir

6. `node harness/bin/esperar-checks.mjs <repo>`. Ele espera em silêncio e devolve só o resumo. Voltou "AINDA RODANDO": rode de novo. Voltou "SEM CHECKS": avise o humano.

7. **Vermelho.** Para cada check reprovado: ache a causa no resumo, corrija em commit novo (nunca `--amend`, nunca push forçado), rode o passo 3, faça push e volte ao passo 6. No Sonar, cobertura se resolve com teste, duplicação com reuso do que existe, complexidade com função menor; nunca com `NOSONAR` nem exclusão. Se o resumo não trouxer os apontamentos do Sonar por arquivo e linha, peça ao humano que cole a lista; não adivinhe. Três rodadas vermelhas: pare e relate.

8. **Verde.** Se abriu em rascunho: `gh pr ready`. Atualize "Estado" no plano e relate: link da PR, checks, e o que falta do humano (revisão e merge).

## C. Depois da revisão humana

9. Dentro de `<dir>`, leia os comentários: `gh pr view --comments` e `gh api repos/{owner}/{repo}/pulls/<número>/comments`. Para cada um: corrija (commit novo, depois passos 3, 6 e 7) ou proponha ao humano a resposta, com evidência. Não discuta gosto: o revisor é o dono do padrão. Não comente nem responda na PR sem o humano mandar.

10. **A catraca aperta.** Para cada comentário que apontou algo fora do padrão, proponha ao humano a linha que faltava em `.cursor/rules/padrao-<repo>.mdc` (com o arquivo que comprova) ou a regra que faltava em `harness/config.json`. O que o revisor pegou uma vez não deve passar de novo.
