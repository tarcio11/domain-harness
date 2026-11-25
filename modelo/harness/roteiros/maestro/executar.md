# Roteiro: executar um trabalho

Você implementa UM trabalho (uma fatia do plano, ou a correção de achados) dentro do padrão do projeto. Depois de você, um script confere o escopo e roda os portões, e outro agente revisa o seu diff comparando com os espelhos. O que não seguir o padrão volta para você. Leia `AGENTS.md` antes de começar: é a lei do projeto.

Seus parâmetros: **Tarefa**, **Plano**, **Repositório** (nome e pasta), **Regra de padrão**, **Trabalho**, **Escopo**, **Espelhos**, **Achados a corrigir**, **Formato do commit**, **Resposta do humano** e **Arquivo de resultado**. Abaixo, `<repo>` é o nome do repositório e `<dir>` é a pasta dele.

## Limites

- Edite só arquivos dentro de `<dir>/` que estejam no **Escopo**. Precisar de arquivo fora do Escopo é desvio (passo 4).
- Não rode comando que mude o git (commit, push, troca de branch, stash, reset). Para desfazer um arquivo que você mexeu: `git -C <dir> checkout -- <arquivo>`; para um arquivo novo, apague.
- Não instale, remova nem atualize dependência. Não edite arquivo protegido (CI, Sonar, lint, TypeScript, `package.json`, lockfile, `.env`).
- Não desligue verificação (`eslint-disable`, `@ts-ignore`, `NOSONAR`, teste pulado ou enfraquecido).
- Não edite o plano nem nada em `harness/`, a não ser o arquivo de resultado.

## Passos

1. **Leia.** No plano: o objetivo, o contrato e a sua fatia (numa correção do repositório, todas as fatias dele). Depois a regra de padrão e cada arquivo de **Espelhos**, inteiro.

2. **Veja o que já existe.** Rode `git -C <dir> status --short`. Se houver mudanças, são de uma tentativa anterior deste mesmo trabalho: leia (`git -C <dir> diff`) e continue a partir delas. Não recomece do zero e não descarte.

3. **Achados e decisões.** Se "Achados a corrigir" não é "(nenhum)": leia cada arquivo citado e corrija exatamente o que eles apontam, nada mais. Se um achado estiver errado (o espelho ou a regra provam o contrário), não mude o código por causa dele: guarde a prova para o passo 8. Se há **Resposta do humano**, ela é uma decisão: siga.

4. **Antes de escrever, procure desvio.** Para cada arquivo que você vai criar ou alterar, diga qual é o espelho. Compare o que o trabalho exige com os 8 desvios da lei (`AGENTS.md`, seção 2): sem espelho, dependência, pasta ou camada nova, importação proibida, interface fora do design system, contrato existente alterado, arquivo protegido, arquivo fora do Escopo.
   Achou um desvio que o plano não lista em "Desvios aprovados"? Não escreva esse código; se já escreveu, desfaça. Grave o **Arquivo de resultado** com `RESULTADO: desvio` na primeira linha, seguido do bloco DESVIO DE PADRÃO completo (o da lei), e pare.

5. **Implemente pelo espelho.** Mesmo esqueleto, mesmos nomes, mesmo tratamento de erro, mesmo formato de teste. Procure antes de criar: se já existe função, tipo, componente ou constante que serve, use. O teste nasce junto. Nada de refatorar, renomear ou reformatar o que não é do trabalho.

6. **Prove.** Rode `node harness/bin/portoes.mjs <repo> --escopo <caminhos do Escopo, separados por espaço>`.
   - `RESULTADO: REPROVADO`: leia o erro, conserte a causa e rode de novo.
   - Três rodadas vermelhas no mesmo erro: pare. Grave `RESULTADO: falhou` na primeira linha e, abaixo, o erro e o que você tentou.
   - Avisos: resolva os que der dentro do Escopo (arquivo novo sem teste se resolve com teste).
   - Se o terminal cortar o comando por tempo, não insista: siga para o passo 7. O maestro roda os portões de qualquer jeito e devolve o erro, se houver.

7. **Releia o seu diff** como o revisor vai ler: `git -C <dir> status --short` e `git -C <dir> diff`. Só arquivos do Escopo? Sobrou resto de depuração, comentário narrando o que você fez, código morto, arquivo gerado? Limpe.

8. **Resultado.** Grave o **Arquivo de resultado** neste formato:

        RESULTADO: ok
        COMMIT: <mensagem de commit em uma linha, no Formato do commit>

        Feito: <o que passou a existir, em até 3 linhas>
        Contesto: <achado tal — por que não se aplica, com o arquivo que prova>
        Fora do escopo: <o que você viu e não mexeu>

   As linhas "Contesto" e "Fora do escopo" só entram quando houver o que dizer. Não faça o commit: quem faz é o maestro, com a mensagem que você escreveu.
