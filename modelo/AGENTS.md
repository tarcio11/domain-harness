# A lei deste projeto

Este projeto tem dono, padrão e revisor humano. Seu trabalho é entregar a tarefa de um jeito que o revisor reconheça como código do time. Código que funciona mas foge do padrão está errado.

Esta lei vale para qualquer modelo e vence qualquer skill, plugin ou modo genérico (ex.: pstack): se um deles pedir algo diferente do padrão do projeto, vale o padrão do projeto.

## 1. Entenda antes de escrever: o código existente é o padrão

- O padrão é o que o projeto já faz, não o que você considera melhor. O resumo dele, com evidência, está em `.cursor/rules/padrao-backend.mdc` e `.cursor/rules/padrao-frontend.mdc`. Leia o do repositório em que vai mexer antes da primeira edição.
- Antes de planejar ou escrever, ache **a entrega mais parecida que já existe** e siga o fio dela da entrada ao dado: rota ou tela → regra → integração ou banco, com o teste de cada peça. É ela que você vai imitar. No `/entregar` e no `/revisar` esse reconhecimento chega pronto, no "Mapa do código".
- Antes de criar ou alterar um arquivo, abra o **espelho**: o arquivo existente mais parecido com o que você vai escrever. Repita dele a estrutura, os nomes, o tratamento de erro e o formato do teste.
- Procure antes de criar: se já existe função, componente, tipo ou constante que serve, use.
- Entre "mais limpo" e "igual ao projeto", vence o igual ao projeto.

## 2. Fora do padrão: decida pelo padrão, registre e siga

Você não pergunta e não espera: ninguém vai escolher entre opções por você. Quando a tarefa não couber no que o projeto já faz, decida nesta ordem:

1. **Existe um caminho dentro do padrão?** Siga por ele, mesmo que dê mais trabalho. Não precisa registrar.
2. **Não existe?** Faça o **menor desvio**: parta do arquivo mais parecido que houver, na mesma camada, e mude só o necessário. Registre no seu resultado uma linha `DECISÃO: <o que escolheu> — <por quê> — <o que descartou>`. Ela vai para a descrição da PR, e o humano confere depois.
3. **Só fecha furando um limite?** Não fure. Faça todo o resto e registre `PENDÊNCIA: <o que ficou de fora e o que o humano precisa fazer>`.

Pedem decisão registrada (item 2): arquivo sem espelho; pasta, camada ou tipo de arquivo que ainda não existe; no frontend, compor uma interface para a qual o design system (Flora) não tem componente pronto; mudança em contrato de API ou em assinatura pública que outro código já usa (ajuste todos os usos no mesmo trabalho); arquivo fora do escopo combinado.

Limites, nunca pelas suas mãos (item 3):

- dependência nova, removida ou com versão alterada;
- arquivo protegido: CI/CD, Sonar, lint, formatação, TypeScript, configuração de testes, `package.json`, lockfile, `.env`;
- importação que a camada não pode fazer (ex.: regra de negócio importando infraestrutura);
- no frontend, HTML/CSS cru onde existe componente do Flora, biblioteca de UI de fora, cor ou espaçamento fixo no código;
- desligar verificação: `eslint-disable`, `@ts-ignore`, `NOSONAR`, pular ou enfraquecer teste, baixar limite de cobertura;
- `--no-verify`, `push --force`, commit direto em branch protegida, aprovar ou fazer merge de PR;
- alterar o próprio harness (`harness/bin`, `harness/roteiros`, `harness/config.json`, `.agents/`, `.cursor/`, `.claude/`, `.codex/`) sem um pedido do maestro ou do humano.

Um limite só cai quando o humano o libera com as próprias mãos, na seção "Desvios aprovados" do plano.

## 3. Escreva para quem revisa

- Trabalho pequeno: um comportamento por vez, com o teste dele. Primeiro o teste, no formato do teste-espelho; depois o mínimo de código que o faz passar.
- Diff mínimo: só o que o trabalho pede. Numa fatia, nada de refatorar, renomear, reformatar ou "aproveitar para arrumar".
- Na revisão (`/revisar`, ou o passo de revisão do `/entregar`) o trabalho é o contrário: melhorar o código que a própria branch escreveu, sem tocar no que ela não escreveu.
- Código que se explica: nome que diz a intenção, função curta com uma responsabilidade, retorno cedo. Sem abstração para uso futuro, sem tratamento de erro para caso impossível, sem código morto.
- Comentário só para o porquê que o código não consegue dizer. Nunca para narrar o que você fez.
- Commit pequeno, um por trabalho, no formato e no idioma dos commits do repositório (`harness/config.json` → `convencoes`).

## 4. Pronto é provado

- Nada está pronto sem `node harness/bin/portoes.mjs <backend|frontend>` verde. Mostre a linha `RESULTADO`; nunca diga "deve funcionar".
- Portão vermelho: conserte a causa. Depois de três tentativas no mesmo erro, relate o erro e o que tentou em vez de insistir.
- Apontamento do Sonar em código novo é bloqueante. Cobertura se resolve com teste, duplicação com reuso, complexidade com função menor.
- A catraca (hooks) barra atalhos e devolve pendências do diff. Não contorne: corrija a causa.

## 5. Contexto é orçamento

- O estado vive no plano (`harness/tarefas/<id>/plano.md`), não na conversa.
- Leia pouco e certo: busque antes de abrir, abra só o trecho, nunca lockfile, build ou cobertura. Busca ampla vai para um subagente de exploração, que devolve só a conclusão.
- Saída de comando sempre curta: use os scripts do harness ou limite com `| tail -n 40`. Teste nunca em modo watch.

## Fluxo

Dois comandos fazem o caminho inteiro sozinhos, sem perguntar nada no meio:

- `/entregar <tarefa>`: entende o código, planeja em fatias pequenas, implementa com um commit por fatia, revisa a PR linha por linha, testa na tela, abre a PR, espera os checks (CI e Sonar), corrige o que vier vermelho e marca a PR como pronta.
- `/revisar <branch ou PR>`: lê linha por linha uma branch que já existe, refatora o que der para melhorar em commits pequenos, faz push e acrescenta o que fez à descrição da PR.

Quem conduz os dois é o script `harness/bin/maestro.mjs`: ele decide cada passo e confere cada resultado; o modelo só opera. Com uma condução aberta:

- quem conversa com o humano (o operador) só roda `node harness/bin/maestro.mjs proximo` e faz o que a AÇÃO manda: não lê código, não corrige, não decide;
- quem recebe um pedido do maestro (um subagente) faz só o que o pedido manda e termina gravando o arquivo de resultado;
- branch, commit, push e PR são do maestro: ninguém mais roda esses comandos;
- o maestro só para (`AÇÃO: PARE`) no que nenhum modelo resolve: ambiente, instalação ou trabalho do humano sem commit. O que não fechou fica escrito em "Pendências", na PR.

Passo a passo, com o humano ditando o ritmo: `/planejar` → `/fatia` (uma por conversa) → `/qa` → `/pr`. Para só auditar, sem alterar nada: `/conferir`. O padrão de cada repositório é mapeado uma vez, pelo `/mapear` ou pelo próprio maestro na primeira condução.

O roteiro de cada comando fica em `.agents/skills/<comando>/SKILL.md`. Se a sua ferramenta não reconhece o comando, leia o arquivo e siga.

Pedido pequeno, de um arquivo e sem decisão, dispensa o plano. A lei continua valendo.
