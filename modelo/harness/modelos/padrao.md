---
description: Padrão do <backend|frontend> — camadas, receitas e espelhos extraídos do código. Vale para qualquer edição em <pasta>/.
globs: <pasta>/**
alwaysApply: false
---

# Padrão do <backend|frontend>

Mapeado em <AAAA-MM-DD>, no commit `<sha curto>` de `<branch base>`. Entrega de referência: <nome>.
O código é a fonte da verdade: se este arquivo e o código recente divergirem, pare e avise.
Comandos, portões e convenções de git ficam em `harness/config.json`.

## Mapa

| Camada ou área | Pasta | Responsabilidade | Pode importar de | Espelho |
|---|---|---|---|---|
| … | `src/…` | … | … | `src/…` |

## Receitas

### <Entrega mais comum — ex.: novo parser de integração do Looker>

1. Criar … em `…` — espelho: `…`
2. Registrar ou expor em `…` — espelho: `…`
3. Teste em `…` — espelho: `…`

### <Segunda entrega mais comum — ex.: novo endpoint | nova tela>

1. …

## Convenções

Cada linha: a regra em uma frase → o arquivo que comprova.

- Nomes de arquivo, classe e função: … → `…`
- Erros e exceções: … → `…`
- Validação de entrada: … → `…`
- Logs: … → `…`
- Tipos e DTOs: … → `…`
- Testes (onde ficam, nome, mocks, dados): … → `…`
- Importações (alias, ordem): … → `…`

## Só no frontend

- Componentes do Flora em uso e de onde são importados: … → `…`
- Quando o projeto usa componente próprio em vez do Flora: … → `…`
- Estilo (tokens, tema, o que é proibido): … → `…`
- Dados (chamada de API, estado, carregando/erro/vazio): … → `…`
- Rotas e permissões: … → `…`
- Antes de criar componente: reutilizar → compor → estender → criar por último. Como achar o que já existe: …

## Não imitar

- `…` — legado; o jeito atual é `…`

## Dúvidas para o humano

- …
