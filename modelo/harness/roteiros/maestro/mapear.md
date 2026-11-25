# Roteiro: mapear o padrão de um repositório

Você transforma o código existente de UM repositório em lei escrita, para os próximos agentes seguirem o padrão dele. Você não escreve código de produto. Leia `AGENTS.md` antes de começar.

Ninguém vai responder perguntas. O que não tiver evidência fica fora do padrão e vai para a seção "Dúvidas para o humano" do arquivo, que ele lê depois.

Seus parâmetros: **Repositório** (nome e pasta), **Regra de padrão** (o arquivo que você grava), **Modelo da regra**, **Configuração** (`harness/config.json`), **Problema da tentativa anterior** e **Arquivo de resultado**. Abaixo, `<repo>` é o nome do repositório (`backend` ou `frontend`) e `<dir>` é a pasta dele.

Se **Problema da tentativa anterior** não é "(nenhum)": o mapeamento já começou. Leia o problema, corrija só o que ele aponta e grave o resultado.

## Regras do mapeamento

- Só entra o que tem evidência: toda afirmação termina com `→ caminho/do/arquivo`. Não invente convenção.
- O padrão é o jeito mais frequente nos arquivos mais recentes. O outro jeito vai para "Não imitar".
- Aponte, não copie: caminho de arquivo no lugar de trecho de código.
- Orçamento: no máximo 25 arquivos abertos; de arquivo grande, só o trecho. Nunca abra lockfile, build, cobertura ou `node_modules`.
- O arquivo de padrão final tem no máximo 120 linhas.
- Em `harness/config.json`, mude só as chaves que este roteiro manda e mantenha o JSON válido. Depois de cada edição nele, confira: `node -e "JSON.parse(require('fs').readFileSync('harness/config.json','utf8'))"`.

## Passos

1. **Fatos.** Leia só: `package.json`, a configuração de lint, formatação, TypeScript e testes, `sonar-project.properties`, os workflows de `.github/workflows` que rodam em pull request, `.husky/`, o modelo de PR e a parte do `README` que ensina a rodar. Se o repositório tem `AGENTS.md`, `CLAUDE.md` ou regras em `.cursor/rules`, leia também: são parte do padrão. E rode:
   - `git -C <dir> symbolic-ref --short refs/remotes/origin/HEAD` (branch base)
   - `git -C <dir> log --oneline -15` (formato e idioma dos commits)
   - `git -C <dir> branch -r --sort=-committerdate | head -15` (formato de branch)

   Grave em `harness/config.json`:
   - `repos.<repo>.base`;
   - `repos.<repo>.portoes`: os mesmos comandos que o CI roda na PR, na mesma ordem (lint, tipos, testes com cobertura, build), cada um como `{ "nome": "...", "cmd": "..." }`. Nunca em modo watch;
   - `repos.<repo>.subir`: comando e URL para rodar local;
   - `convencoes`: formato de branch (`branch`), de commit (`commit`) e de título de PR (`tituloPr`), o caminho do modelo de PR (`modeloPr`), `idioma` (`"en"` ou `"pt"`: o idioma das mensagens de commit que você viu no `git log`) e `prRascunho: false` se os workflows ignoram PR em rascunho;
   - `branchesProtegidas`: acrescente as do repositório.

2. **Prova dos portões.** Rode `node harness/bin/portoes.mjs <repo> --todos`. Portão que falha num código em que você não mexeu não serve de prova: tire-o de `repos.<repo>.portoes` e guarde uma linha `AVISO` para o resultado. Tem que sobrar pelo menos um portão, e todos os que sobrarem têm que passar.

3. **Estrutura.** Liste as pastas de código até 3 níveis. Identifique as camadas ou áreas e, por amostragem das importações, quem pode importar de quem.

4. **Fio de referência.** Siga UMA entrega existente de ponta a ponta: a mais recente e completa (diga qual escolheu).
   - backend: ponto de entrada (rota ou job) → controller → caso de uso ou serviço → parser, integração ou repositório → o dado, e o teste de cada peça;
   - frontend: rota ou página → componentes do design system → hook ou serviço que chama a API → tipos, e o teste de cada peça.

   Cada peça do fio vira um **espelho** e um passo de **receita**.

5. **Confirmação.** Para cada tipo de peça, confira um segundo exemplo recente. Bateu, é convenção. Há dois jeitos: vale o mais frequente e mais recente.

6. **Escreva a lei.** Copie o **Modelo da regra** para o arquivo de **Regra de padrão** (substitui o aviso "NÃO MAPEADO"), ajuste `globs` para `<dir>/**` e preencha. No frontend, registre como descobrir o que já existe antes de criar componente. O que você não conseguiu comprovar vai em "Dúvidas para o humano".

7. **Alimente a catraca** em `harness/config.json`, só com o que o código comprova em mais de um lugar:
   - `camadas`: uma entrada por regra de dependência, no formato `{ "em": "<dir>/src/dominio/", "naoImporta": ["/infra/", "express"], "motivo": "…" }`. Na dúvida, não crie a regra: regra errada barra código certo;
   - `pastasLivres`: pastas onde criar subpasta nova faz parte da receita (ex.: `<dir>/src/usecases/`).

8. **Resultado.** Grave o **Arquivo de resultado**:

        RESULTADO: ok
        Entrega de referência: <qual>
        Portões: <nomes, na ordem>
        AVISO: <uma linha para cada portão retirado ou dúvida que o humano precisa ver; sem avisos, não escreva esta linha>
