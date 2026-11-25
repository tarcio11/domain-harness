# Roteiro: executar um trabalho

Você implementa UM trabalho (uma fatia do plano, ou a correção de achados) dentro do padrão do projeto. Depois de você, um script confere o escopo e roda os portões, e outro agente revisa o seu diff comparando com os espelhos. O que não seguir o padrão volta para você. Leia `AGENTS.md` antes de começar: é a lei do projeto.

Ninguém vai responder perguntas nem escolher entre opções. Na dúvida, você decide pela seção 2 da lei e registra a decisão no resultado.

Seus parâmetros: **Tarefa**, **Plano**, **Mapa do código**, **Repositório** (nome e pasta), **Regra de padrão**, **Trabalho**, **Escopo**, **Espelhos**, **Achados a corrigir**, **Formato do commit**, **Idioma das decisões** e **Arquivo de resultado**. Abaixo, `<repo>` é o nome do repositório e `<dir>` é a pasta dele.

## Limites

- Edite só arquivos dentro de `<dir>/`. O **Escopo** é o combinado; se o trabalho precisa mesmo de um arquivo fora dele (um ponto de registro que o plano não previu), pode mexer, e declara no resultado (passo 8).
- Não rode comando que mude o git (commit, push, troca de branch, stash, reset). Para desfazer um arquivo que você mexeu: `git -C <dir> checkout -- <arquivo>`; para um arquivo novo, apague.
- Não instale, remova nem atualize dependência. Não edite arquivo protegido (CI, Sonar, lint, TypeScript, `package.json`, lockfile, `.env`).
- Não desligue verificação (`eslint-disable`, `@ts-ignore`, `NOSONAR`, teste pulado ou enfraquecido).
- Não edite o plano nem nada em `harness/`, a não ser o arquivo de resultado.

## Passos

1. **Leia.** Se há plano: o objetivo, o mapa do código, o contrato e a sua fatia (numa correção do repositório, todas as fatias dele). Depois a regra de padrão e cada arquivo de **Espelhos**, inteiro. Sem espelhos no parâmetro, eles estão no mapa do código, na tabela "Peças e espelhos".

2. **Veja o que já existe.** Rode `git -C <dir> status --short`. Se houver mudanças, são de uma tentativa anterior deste mesmo trabalho: leia (`git -C <dir> diff`) e continue a partir delas. Não recomece do zero e não descarte.

3. **Achados.** Se "Achados a corrigir" não é "(nenhum)": leia cada arquivo citado e corrija exatamente o que eles apontam, nada mais. Se um achado estiver errado (o espelho ou a regra provam o contrário), não mude o código por causa dele: guarde a prova para o passo 8.

4. **Fora do padrão? Decida.** Para cada arquivo que você vai criar ou alterar, diga qual é o espelho. Se o trabalho não cabe no que o projeto já faz, siga a ordem da lei (seção 2), sem parar:
   - há um caminho dentro do padrão: vá por ele, mesmo que dê mais código;
   - não há (arquivo sem espelho, pasta nova, contrato que muda): faça o menor desvio, partindo do arquivo mais parecido da mesma camada, e guarde uma linha `DECISÃO` para o resultado;
   - só fecha furando um limite (dependência, arquivo protegido, importação proibida, interface fora do design system, verificação desligada): não fure. Faça todo o resto e guarde uma linha `PENDÊNCIA` para o resultado.

5. **Implemente pelo espelho, teste primeiro.** Escreva o teste no formato do teste-espelho e veja falhar; depois o mínimo de código que o faz passar. Mesmo esqueleto, mesmos nomes e mesmo tratamento de erro do espelho. Procure antes de criar: se já existe função, tipo, componente ou constante que serve, use. Nada de refatorar, renomear ou reformatar o que não é do trabalho.

6. **Prove.** Rode `node harness/bin/portoes.mjs <repo> --escopo <caminhos do Escopo, separados por espaço>`.
   - `RESULTADO: REPROVADO`: leia o erro, conserte a causa e rode de novo.
   - Três rodadas vermelhas no mesmo erro: pare de insistir. Grave `RESULTADO: falhou` na primeira linha e, abaixo, o erro e o que você tentou.
   - Avisos: resolva os que der (arquivo novo sem teste se resolve com teste). Aviso de tamanho não bloqueia.
   - Se o terminal cortar o comando por tempo, não insista: siga para o passo 7. O maestro roda os portões de qualquer jeito e devolve o erro, se houver.

7. **Releia o seu diff** como o revisor vai ler: `git -C <dir> status --short` e `git -C <dir> diff`. Sobrou resto de depuração, comentário narrando o que você fez, código morto, arquivo gerado, mudança que o trabalho não pediu? Limpe.

8. **Resultado.** Grave o **Arquivo de resultado** neste formato:

        RESULTADO: ok
        COMMIT: <mensagem de commit em uma linha, no Formato do commit>

        Feito: <o que passou a existir, em uma linha>
        DECISÃO: <o que escolheu> — <por quê> — <o que descartou>
        PENDÊNCIA: <o que ficou de fora e o que o humano precisa fazer>
        ESCOPO EXTRA: `<arquivo fora do Escopo que você mexeu>` — <por que o trabalho precisava dele>
        Contesto: <achado tal — por que não se aplica, com o arquivo que prova>

   - A mensagem de commit segue o formato e o idioma do parâmetro **Formato do commit**, não o idioma deste roteiro.
   - `Feito`, `DECISÃO` e `PENDÊNCIA` vão para a descrição da PR: escreva no **Idioma das decisões**.
   - As linhas `DECISÃO`, `PENDÊNCIA`, `ESCOPO EXTRA` e `Contesto` só entram quando houver o que dizer, uma linha para cada item.
   - Não faça o commit: quem faz é o maestro, com a mensagem que você escreveu.
