// node --test harness/bin/testes/*.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { definirStatus, escreverSecao, inserirSecao, lerPlano, marcarFatia, seloDoPlano, validarPlano } from '../plano.mjs';

const PLANO = `# ABC-1 — parser de vendas

Status: rascunho
Card: ABC-1
Branch: \`feature/ABC-1-parser\` (o mesmo nos dois repositórios)

## Objetivo

Expor as vendas por parceiro.

## Critérios de aceite

- [ ] CA1 — dado um parceiro, quando a API é chamada, então as vendas voltam
- [x] CA2 — dado um período vazio, quando a API é chamada, então volta 400

## Contrato

<Só quando a tarefa toca backend e frontend.>

## Fatias

Uma fatia = um comportamento com o teste dele = um commit pequeno.

- [x] **F1 · backend · parser de vendas**
  - Escopo: \`src/parsers/\`, \`src/routes/index.ts\`
  - Espelho: \`src/parsers/estoque.parser.ts\`
  - Entrega: parser registrado
  - Prova: \`npm test -- vendas\`
- [ ] **F2 · backend · rota de vendas**
  - **Escopo:** \`src/routes/\`
  - Espelho: \`src/routes/estoque.ts\`
  - Entrega: rota
  - Prova: teste da rota

## Premissas

- O total vem em centavos.

## Dúvidas

<!-- nada -->

## Desvios pendentes

—

## Desvios aprovados

## Decisões no caminho

—

## Pendências

—

## Estado

- Pronto: F1
`;

const CONFIG = { repos: { backend: { dir: 'pasta-que-nao-existe' }, frontend: { dir: 'outra' } }, branchesProtegidas: ['main', 'release/*'], protegidos: ['package.json', '.github/**'] };

test('lê título, status, branch, critérios, fatias e o que está pendente', () => {
  const plano = lerPlano(PLANO);
  assert.equal(plano.titulo, 'ABC-1 — parser de vendas');
  assert.equal(plano.status, 'rascunho');
  assert.equal(plano.branch, 'feature/ABC-1-parser');
  assert.deepEqual(plano.criterios.map((criterio) => criterio.id), ['CA1', 'CA2']);
  assert.equal(plano.contrato, '', 'o marcador do modelo conta como vazio');
  assert.equal(plano.duvidas, '', 'comentário conta como vazio');
  assert.equal(plano.desviosPendentes, '', 'travessão conta como vazio');
  assert.equal(plano.premissas, '- O total vem em centavos.');
  assert.deepEqual(plano.fatias.map((fatia) => [fatia.id, fatia.repo, fatia.nome, fatia.feita]), [
    ['F1', 'backend', 'parser de vendas', true],
    ['F2', 'backend', 'rota de vendas', false],
  ]);
  assert.deepEqual(plano.fatias[0].escopo, ['src/parsers/', 'src/routes/index.ts']);
  assert.deepEqual(plano.fatias[1].escopo, ['src/routes/'], 'campo em negrito também vale');
  assert.deepEqual(plano.fatias[1].espelho, ['src/routes/estoque.ts']);
});

test('o validador aponta cada erro de formato com o formato certo ao lado', () => {
  const torto = PLANO.replace('- [ ] **F2 · backend · rota de vendas**', '- [ ] F2 - backend - rota de vendas')
    .replace('- [ ] CA1 — dado', '- [ ] dado')
    .replace('Branch: `feature/ABC-1-parser`', 'Branch: `release/1.2`')
    .replace('`src/parsers/`, `src/routes/index.ts`', '`../fora`, `package.json`');
  const erros = validarPlano(lerPlano(torto), CONFIG).join('\n');
  assert.match(erros, /A branch "release\/1\.2" é protegida/);
  assert.match(erros, /Critério fora do formato: "- \[ \] dado um parceiro/);
  assert.match(erros, /Linha de fatia fora do formato: "- \[ \] F2 - backend - rota de vendas"\. O formato é exatamente: - \[ \] \*\*F1 · backend · nome da fatia\*\*/);
  assert.match(erros, /F1: Escopo "\.\.\/fora" tem que ser relativo à pasta do repositório/);
  assert.match(erros, /F1: Escopo "package\.json" é arquivo protegido: só o humano altera\. Tire do Escopo e planeje sem mexer nele/);
  assert.match(erros, /F1: o Espelho "src\/parsers\/estoque\.parser\.ts" não existe em pasta-que-nao-existe\//);
});

test('fatias numeradas fora de ordem, repositório inexistente, campos faltando e contrato vazio com dois repositórios', () => {
  const fatias = ['- [ ] **F1 · frontend · tela**', '  - Escopo: `src/telas/`', '- [ ] **F3 · backend · api**', '  - Escopo: src/api', '- [ ] **F3 · mobile · app**'].join('\n');
  const texto = PLANO.replace(/## Fatias[\s\S]*?## Premissas/, `## Fatias\n\n${fatias}\n\n## Premissas`);
  const erros = validarPlano(lerPlano(texto), CONFIG).join('\n');
  assert.match(erros, /F1: falta o campo "Espelho"/);
  assert.match(erros, /A 2ª fatia deveria se chamar F2, não F3/);
  assert.match(erros, /F3: o Escopo precisa de caminhos entre crases/);
  assert.match(erros, /F3: repositório "mobile" não existe\. Use: backend ou frontend/);
  assert.match(erros, /Ordem dos repositórios: backend antes de frontend/);
  assert.match(erros, /a seção "Contrato" não pode ficar vazia/);
});

test('o selo ignora o que o maestro reescreve e muda com qualquer outra alteração', () => {
  const selo = seloDoPlano(PLANO);
  const doMaestro = [
    definirStatus(PLANO, 'aprovado'),
    marcarFatia(PLANO, 'F2', true),
    marcarFatia(PLANO, 'F1', false),
    escreverSecao(PLANO, 'Estado', '- Pronto: F1, F2\n- Próximo passo: PR'),
    escreverSecao(PLANO, 'Decisões no caminho', '- backend: F1: usei o parser de estoque como base'),
    escreverSecao(PLANO, 'Pendências', '- backend: a fatia F2 não fechou'),
    PLANO.replace('- [x] CA2', '- [ ] CA2'),
  ];
  for (const texto of doMaestro) assert.equal(seloDoPlano(texto), selo);

  const adulterados = [
    PLANO.replace('## Desvios aprovados\n', '## Desvios aprovados\n\n- `backend/package.json` — dependência\n'),
    PLANO.replace('`src/routes/`', '`src/`'),
    PLANO.replace('parser registrado', 'parser registrado e cache novo'),
    PLANO.replace(/- \[ \] \*\*F2[\s\S]*?teste da rota\n/, ''),
    PLANO.replace('feature/ABC-1-parser', 'main'),
  ];
  for (const texto of adulterados) assert.notEqual(seloDoPlano(texto), selo);
});

test('inserirSecao põe o mapa do código antes das fatias, troca o que já existir e entra no selo', () => {
  const comMapa = inserirSecao(PLANO, 'Mapa do código', '### Entrega mais parecida\nEstoque por parceiro.', 'Fatias');
  assert.match(comMapa, /## Contrato\n\n<Só quando[^\n]*>\n\n## Mapa do código\n\n### Entrega mais parecida\nEstoque por parceiro\.\n\n## Fatias/);
  assert.equal(lerPlano(comMapa).fatias.length, 2, 'títulos de terceiro nível não quebram a leitura do plano');
  assert.deepEqual(validarPlano(lerPlano(comMapa), CONFIG).filter((erro) => !/Espelho/.test(erro)), []);

  const trocado = inserirSecao(comMapa, 'Mapa do código', '### Entrega mais parecida\nOutra.', 'Fatias');
  assert.equal(trocado.match(/## Mapa do código/g).length, 1);
  assert.match(trocado, /### Entrega mais parecida\nOutra\./);
  assert.notEqual(seloDoPlano(trocado), seloDoPlano(comMapa), 'depois de aprovado, o mapa não muda sem o selo acusar');
});

test('escreverSecao troca o corpo de uma seção do meio sem tocar nas vizinhas, e cria a que falta', () => {
  const trocado = escreverSecao(PLANO, 'Premissas', '- outra premissa');
  assert.equal(lerPlano(trocado).premissas, '- outra premissa');
  assert.equal(lerPlano(trocado).fatias.length, 2);
  assert.match(trocado, /## Premissas\n\n- outra premissa\n\n## Dúvidas/);
  assert.match(escreverSecao('# X\n', 'Estado', '- Pronto: —'), /^# X\n\n## Estado\n\n- Pronto: —\n$/);
});
