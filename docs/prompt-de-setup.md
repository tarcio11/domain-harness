# Prompt de setup

Cole o texto abaixo numa conversa nova do agente, aberta na pasta raiz do projeto (a que contém os repositórios de backend e frontend). Serve no agente do Cursor, no Claude Code e no Codex.

Antes de colar, ajuste só uma coisa: na linha do passo 3, apague `--com claude,codex` se você não usa essas extensões, ou deixe só a que usa.

```text
Você vai instalar o "domain harness" nesta pasta raiz. Siga os passos na ordem, sem pular e sem improvisar.

Regras para esta conversa:
- Não altere nenhum arquivo dentro dos repositórios do produto.
- Não faça commit, push nem instale dependência.
- Se um passo falhar, pare e me mostre o erro. Não tente consertar por outro caminho.
- Não rode /mapear, /entregar nem /revisar nesta conversa.

Passo 1 — Confirme a raiz.
Rode `pwd` e `ls -a`. A raiz é a pasta que CONTÉM os repositórios de backend e frontend (cada um com a sua pasta `.git`). Se você estiver dentro de um dos repositórios, ou se não enxergar os dois, pare e me avise.

Passo 2 — Baixe o harness para fora da raiz.
Rode: git clone --depth 1 https://github.com/tarcio11/domain-harness ~/domain-harness
Se a pasta ~/domain-harness já existir, rode no lugar: git -C ~/domain-harness pull --ff-only

Passo 3 — Instale.
Rode, trocando <RAIZ> pelo caminho que o `pwd` mostrou:
node ~/domain-harness/instalar.mjs "<RAIZ>" --com claude,codex

Passo 4 — Leia o relatório do instalador e me mostre inteiro.
- Se houver CONFLITOS: não resolva sozinho. Para cada um, mostre o que há no meu arquivo e no arquivo `.novo` e me pergunte como juntar.
- Se houver RESTOS da versão anterior, ou RESTOS de condução: liste e me pergunte antes de apagar. (Os de condução saem rodando o instalador de novo com --limpar; os planos ficam.)
- Se ele disser que não conseguiu decidir qual pasta é backend e qual é frontend: me pergunte e grave a resposta em harness/config.json, nos campos repos.backend.dir e repos.frontend.dir. É a única edição permitida nesta conversa.

Passo 5 — Confira.
Na raiz, rode `node harness/bin/doutor.mjs` e me mostre a saída inteira.
Depois rode `node --test harness/bin/testes/*.test.mjs` e me diga só os totais de testes que passaram e falharam.

Passo 6 — Pare e responda só com isto:
1. O que foi instalado (a linha de contagem do instalador) e para quais ferramentas.
2. Cada pendência do doutor e o que eu preciso fazer para resolver. Pendências de "portões configurados" e "padrão mapeado" são esperadas agora: o maestro mapeia sozinho na primeira condução.
3. O que eu preciso conferir à mão: no Cursor, reabrir a pasta como confiável e ver os três hooks em Customize → Hooks; no Claude Code e no Codex, abrir /hooks e confirmar que os hooks do harness aparecem (no Codex, revisar e confiar).
4. Para o maestro andar sozinho: no Cursor, pôr `node harness/bin/maestro.mjs` e `node harness/bin/portoes.mjs` na allowlist de comandos (Settings → Agents → Approvals & Execution), porque ele precisa de rede para `git fetch`, `git push` e `gh`.
5. Os próximos comandos, cada um numa conversa nova: `/entregar <tarefa>` para uma tarefa inteira, ou `/revisar <branch ou PR>` para uma branch que já existe. Se eu quiser ler e aprovar o padrão antes de qualquer entrega: `/mapear backend` e depois `/mapear frontend`.
```

## O que esperar

O relatório do instalador, numa raiz limpa com os dois adaptadores, é parecido com este:

```text
HARNESS 0.4.0 em /Users/voce/trabalho/parceiros (ferramentas: cursor, claude, codex)
  criados: 73 · atualizados: 0 · iguais: 0 · do projeto, mantidos: 0 · conflitos: 0
Repositórios: backend → api-parceiros · frontend → web-parceiros
```

E o doutor, antes do mapeamento, acusa só o que ainda falta mapear:

```text
✔ backend: repositório em "api-parceiros", branch main
✖ backend: portões configurados
    → rode /mapear backend (ou deixe: o /entregar e o /revisar mapeiam sozinhos na primeira vez)
✖ backend: padrão mapeado
    → rode /mapear backend (ou deixe: o /entregar e o /revisar mapeiam sozinhos na primeira vez)
```

Atualizando uma raiz que já tinha a versão 0.3, o relatório traz também os arquivos de condução que aquela versão deixava nas pastas de tarefa:

```text
RESTOS de condução — 7 arquivo(s) que a versão anterior deixava nas pastas de tarefa (maestro.json, passos/, pr-*.md…) e que esta não usa mais.
  Para apagar (os planos ficam): rode o instalador de novo com --limpar
```

## Por que o prompt é assim

- **Clone fora da raiz.** O repositório do harness é público e genérico; a raiz do seu projeto guarda o mapa do seu código. Os dois não se misturam, e atualizar depois é `git pull` mais o instalador.
- **O instalador decide, não o agente.** Copiar arquivo por arquivo é onde um agente erra. O script sabe o que é motor, o que é do projeto e o que você editou.
- **Parar antes de qualquer comando.** Mapear e entregar leem muito código. Numa conversa nova cada um começa com a janela vazia.
- **O mapeamento não é mais um passo seu.** O `/entregar` e o `/revisar` mapeiam o padrão de cada repositório na primeira vez, sozinhos, e avisam no relatório para você ler o arquivo. O `/mapear` continua existindo para quem prefere ler e aprovar antes.
- **Conflito é pergunta.** Um `AGENTS.md` ou `.claude/settings.json` que já existia é seu: o agente não junta por conta própria.
- **A allowlist é sua.** O agente só avisa. Liberar um comando para rodar sem confirmação e fora do sandbox é uma decisão de segurança da sua máquina.
