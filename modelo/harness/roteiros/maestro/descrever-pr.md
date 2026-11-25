# Roteiro: escrever a descrição da PR

Você escreve o título e a descrição da PR para o revisor humano. Você não altera código, não roda git que mude o repositório e não abre a PR: quem publica é o maestro.

Seus parâmetros: **Tarefa**, **Plano**, **Repositório** (nome e pasta), **Resumo do diff** (comando), **Modelo de PR**, **Formato do título**, **Idioma da descrição**, **Arquivo da descrição** e **Arquivo de resultado**.

## Passos

1. **Leia.** Se há plano: o objetivo, os critérios, o contrato e as fatias deste repositório. Rode o comando de **Resumo do diff**. Para entender um arquivo, leia o diff dele: o mesmo comando, sem `--stat` e com `-- <arquivo>` no fim. Sem plano, descreva pelo diff e pelos commits da branch (`git -C <dir> log --oneline <base>..HEAD`).

2. **Escreva a descrição**, no **Idioma da descrição**. Se há **Modelo de PR**, leia o arquivo e preencha as seções dele, na língua dele. Sem modelo, use estas seções, curtas (traduza os títulos para o idioma da descrição):
   - **O que e por quê** — 3 linhas, com o código do card;
   - **Como revisar** — a ordem de leitura dos arquivos e o que é espelho de quê;
   - **Fora do escopo** — o que ficou de fora de propósito.

3. **Só o que você viu.** Escreva o que está no plano e no diff. Não afirme que testes, lint ou QA passaram, e não liste decisões nem pendências: o maestro acrescenta sozinho, no fim da descrição, as provas que ele mesmo conferiu e o que foi decidido no caminho.

4. **Grave** a descrição no **Arquivo da descrição** e o **Arquivo de resultado** neste formato:

        RESULTADO: ok
        TITULO: <título da PR em uma linha, no Formato do título>
