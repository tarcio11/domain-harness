---
name: mapear
description: Mapeia um repositório do projeto (backend ou frontend) e grava o padrão dele com evidência, os portões e as convenções. Só roda quando o humano chama /mapear.
disable-model-invocation: true
---

# /mapear <backend|frontend>

Você vai transformar o código existente em lei escrita. Não escreva código de produto. Um repositório por conversa.

Nos passos abaixo, `<repo>` é `backend` ou `frontend`, e `<dir>` é a pasta real dele dentro da raiz.

## Regras do mapeamento

- Só entra o que tem evidência: toda afirmação termina com `→ caminho/do/arquivo`. Sem evidência, vai para "Dúvidas para o humano". Não invente convenção.
- O padrão é o jeito mais frequente nos arquivos mais recentes. O outro jeito vai para "Não imitar".
- Aponte, não copie: caminho de arquivo no lugar de trecho de código.
- Orçamento: no máximo 25 arquivos abertos; de arquivo grande, só o trecho. Nunca abra lockfile, build, cobertura ou `node_modules`.
- O arquivo de padrão final tem no máximo 120 linhas.

## Passos

1. **Instalação.** Rode `node harness/bin/doutor.mjs` e leia as pendências. Descubra a pasta do repositório pedido (as pastas da raiz que têm `.git`) e grave em `harness/config.json` → `repos.<repo>.dir`.

2. **Fatos.** Leia só: `package.json`, configuração de lint, formatação, TypeScript e testes, `sonar-project.properties`, os workflows de `.github/workflows` que rodam em pull request, `.husky/`, o modelo de PR e a parte do `README` que ensina a rodar. Se o repositório já tem `AGENTS.md`, `CLAUDE.md` ou regras em `.cursor/rules`, leia também: são parte do padrão, e o que conflitar com a lei vai para "Dúvidas para o humano". E rode:
   - `git -C <dir> symbolic-ref --short refs/remotes/origin/HEAD` (branch base)
   - `git -C <dir> log --oneline -15` (convenção de commit)
   - `git -C <dir> branch -r --sort=-committerdate | head -15` (convenção de branch)

   Grave em `harness/config.json`:
   - `repos.<repo>.base`;
   - `repos.<repo>.portoes`: os mesmos comandos que o CI roda na PR, na mesma ordem (lint, tipos, testes com cobertura, build), cada um como `{ "nome": "...", "cmd": "..." }`. Nunca em modo watch;
   - `repos.<repo>.subir`: comando e URL para rodar local;
   - `convencoes`: formato de branch, de commit e de título de PR, e o caminho do modelo de PR; `prRascunho: false` se os workflows ignoram PR em rascunho;
   - `branchesProtegidas`: acrescente as do repositório.

3. **Prova dos portões.** Com a árvore limpa, rode `node harness/bin/portoes.mjs <repo>`. Tem que dar verde na base. Portão que já falha na base vai para "Dúvidas para o humano".

4. **Estrutura.** Liste as pastas de código até 3 níveis. Identifique as camadas ou áreas e, por amostragem das importações, quem pode importar de quem.

5. **Fio de referência.** Siga UMA entrega existente de ponta a ponta: a que o humano indicou ou, se ele não indicou, a mais recente e completa (diga qual escolheu).
   - backend: integração do Looker → parser → caso de uso ou serviço → controller/rota → resposta, e o teste de cada peça;
   - frontend: rota/página → componentes (Flora) → hook ou serviço que chama a API → tipos, e o teste de cada peça.

   Cada peça do fio vira um **espelho** e um passo de **receita**.

6. **Confirmação.** Para cada tipo de peça, confira um segundo exemplo recente. Bateu, é convenção. Há dois jeitos, vale o mais frequente e mais recente.

7. **Escreva a lei.** Copie `harness/modelos/padrao.md` para `.cursor/rules/padrao-<repo>.mdc` (substitui o aviso "NÃO MAPEADO"), ajuste `globs` para `<dir>/**` e preencha. No frontend, registre como descobrir o que já existe antes de criar componente (se o projeto tem índice de componentes e rotas, é por ele).

8. **Alimente a catraca** em `harness/config.json`, só com o que o código comprova:
   - `camadas`: uma entrada por regra de dependência, no formato `{ "em": "<dir>/src/dominio/", "naoImporta": ["/infra/", "express"], "motivo": "…" }`;
   - `pastasLivres`: pastas onde criar subpasta nova faz parte da receita (ex.: `<dir>/src/usecases/`);
   - `proibido`: o que o lint e o Sonar do projeto já proíbem e dá para pegar por texto (ex.: biblioteca de UI de fora, `style={{`).

9. **Entregue.** Rode `node harness/bin/doutor.mjs` de novo. Mostre em até 15 linhas: o que foi mapeado, a entrega de referência e as dúvidas. Peça ao humano que leia `.cursor/rules/padrao-<repo>.mdc` e corrija: depois de aprovado, é lei.
