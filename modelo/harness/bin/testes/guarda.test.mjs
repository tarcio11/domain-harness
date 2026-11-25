// node --test harness/bin/testes/*.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avaliarComando, separarSegmentos } from '../guarda.mjs';

const REPO = '/raiz/backend';

function avaliar(comando, { branch = 'feature/ABC-1-parser', cwd = REPO, maestroAtivo = false } = {}) {
  return avaliarComando(comando, {
    cwd,
    ehRepoDoProduto: (pasta) => pasta.startsWith(REPO),
    branchDe: () => branch,
    ehBranchProtegida: (nome) => ['main', 'develop'].includes(nome),
    maestroAtivo,
  });
}

const MAESTRO = { maestroAtivo: true };

const casos = [
  // [comando, permissão esperada, regra esperada, opções]
  ['git status', 'allow'],
  ['git commit -m "feat: parser de vendas"', 'allow'],
  ['git commit -m "explica o --no-verify e o -n"', 'allow'],
  ['git commit -am "ajuste"', 'allow'],
  ['git commit --no-verify -m "x"', 'deny', 'pular-verificacao'],
  ['git commit -n -m "x"', 'deny', 'pular-verificacao'],
  ['git commit -nm "x"', 'deny', 'pular-verificacao'],
  ['git commit -anm "x"', 'deny', 'pular-verificacao'],
  ['git commit -m -n', 'allow'],
  ['cd /raiz/backend && git add src && git commit -m "x" --no-verify', 'deny', 'pular-verificacao'],
  ['HUSKY=0 git commit -m "x"', 'deny', 'pular-verificacao'],
  ['export HUSKY=0', 'deny', 'pular-verificacao'],
  ['git -c core.hooksPath=/dev/null commit -m "x"', 'deny', 'pular-verificacao'],
  ['git config core.hooksPath .nada', 'deny', 'pular-verificacao'],
  ['git config --unset core.hooksPath', 'deny', 'pular-verificacao'],
  ['git config --get core.hooksPath', 'allow'],
  ['grep -r "core.hooksPath" .', 'allow'],
  ['echo "$(git commit --no-verify -m x)"', 'deny', 'pular-verificacao'],

  ['git commit -m "x"', 'deny', 'branch-protegida', { branch: 'main' }],
  ['git commit -m "x"', 'allow', undefined, { branch: 'main', cwd: '/raiz' }],
  ['git -C /raiz/backend commit -m "x"', 'deny', 'branch-protegida', { branch: 'main', cwd: '/raiz' }],
  ['cd backend && git commit -m "x"', 'deny', 'branch-protegida', { branch: 'main', cwd: '/raiz' }],

  ['git push -u origin feature/ABC-1-parser', 'allow'],
  ['git push', 'allow'],
  ['git push', 'deny', 'branch-protegida', { branch: 'main' }],
  ['git push origin main', 'deny', 'branch-protegida'],
  ['git push origin HEAD:main', 'deny', 'branch-protegida'],
  ['git push origin HEAD', 'deny', 'branch-protegida', { branch: 'develop' }],
  ['git push origin refs/heads/develop', 'deny', 'branch-protegida'],
  ['git push --all', 'deny', 'branch-protegida'],
  ['git push --force', 'deny', 'push-forcado'],
  ['git push -f origin feature/x', 'deny', 'push-forcado'],
  ['git push --force-with-lease origin feature/x', 'deny', 'push-forcado'],
  ['git push origin +feature/x', 'deny', 'push-forcado'],
  ['git push --no-verify', 'deny', 'pular-verificacao'],
  ['git push origin --delete feature/x', 'deny', 'apagar-remoto'],
  ['git push origin :feature/x', 'deny', 'apagar-remoto'],
  ['git push 2>&1 | tail -n 5', 'allow'],

  ['git reset --hard HEAD~1', 'ask', 'descarta-trabalho'],
  ['git reset --soft HEAD~1', 'allow'],
  ['git clean -fd', 'ask', 'descarta-trabalho'],
  ['git clean -nd', 'allow'],
  ['git checkout -- .', 'ask', 'descarta-trabalho'],
  ['git checkout -b feature/x', 'allow'],
  ['git restore .', 'ask', 'descarta-trabalho'],
  ['git restore src/a.ts', 'allow'],
  ['git stash drop', 'ask', 'descarta-trabalho'],
  ['git branch -D feature/x', 'ask', 'descarta-trabalho'],

  ['gh pr create --base main --title "x" --body-file pr.md --draft', 'allow'],
  ['gh pr checks 12 --json name,bucket', 'allow'],
  ['gh pr merge 12 --squash', 'deny', 'decisao-do-revisor'],
  ['gh -R org/repo pr merge 12', 'deny', 'decisao-do-revisor'],
  ['gh pr review 12 --approve', 'deny', 'decisao-do-revisor'],
  ['gh pr review 12 --comment -b "ok"', 'allow'],

  ['npm install', 'allow'],
  ['npm ci', 'allow'],
  ['npm run build', 'allow'],
  ['npm test -- --coverage', 'allow'],
  ['npm --prefix backend install', 'allow'],
  ['npm install date-fns', 'deny', 'dependencia'],
  ['npm i -D jest', 'deny', 'dependencia'],
  ['npm install --prefix backend lodash', 'deny', 'dependencia'],
  ['npm uninstall lodash', 'deny', 'dependencia'],
  ['npm update', 'deny', 'dependencia'],
  ['npm audit fix', 'deny', 'dependencia'],
  ['npm install -g typescript', 'allow'],
  ['yarn', 'allow'],
  ['yarn install --frozen-lockfile', 'allow'],
  ['yarn add axios', 'deny', 'dependencia'],
  ['pnpm add zod', 'deny', 'dependencia'],
  ['npx tsc --noEmit', 'allow'],

  ['bash -c "git commit -m x --no-verify"', 'deny', 'pular-verificacao'],
  ['sh -lc \'cd backend && git push --force\'', 'deny', 'push-forcado'],
  ['eval "git push origin main"', 'deny', 'branch-protegida'],
  ['bash -c "npm run build"', 'allow'],
  ['bash scripts/deploy.sh', 'allow'],

  ['git commit -F - <<EOF\nexplica o git push --force\nnpm install lodash\nEOF', 'allow'],
  ['cat > nota.md <<\'FIM\'\ngit commit --no-verify\nFIM\ngit push --force', 'deny', 'push-forcado'],

  ['git commit -m "feat: x"', 'deny', 'so-o-maestro', MAESTRO],
  ['git push -u origin feature/ABC-1-parser', 'deny', 'so-o-maestro', MAESTRO],
  ['git checkout -b outra', 'deny', 'so-o-maestro', MAESTRO],
  ['git checkout main', 'deny', 'so-o-maestro', MAESTRO],
  ['git stash', 'deny', 'so-o-maestro', MAESTRO],
  ['git reset HEAD~1', 'deny', 'so-o-maestro', MAESTRO],
  ['gh pr create --title x --body y', 'deny', 'so-o-maestro', MAESTRO],
  ['git checkout -- src/a.ts', 'allow', undefined, MAESTRO],
  ['git checkout -- .', 'deny', 'descarta-trabalho', MAESTRO],
  ['git clean -fd', 'deny', 'descarta-trabalho', MAESTRO],
  ['git restore .', 'deny', 'descarta-trabalho', MAESTRO],
  ['git clean -fd', 'ask', 'descarta-trabalho'],
  ['git status --short', 'allow', undefined, MAESTRO],
  ['git diff --cached abc123', 'allow', undefined, MAESTRO],
  ['git add src/a.ts', 'allow', undefined, MAESTRO],
  ['gh pr checks 12', 'allow', undefined, MAESTRO],
  ['node harness/bin/maestro.mjs proximo', 'allow', undefined, MAESTRO],
  ['node harness/bin/portoes.mjs backend --escopo src/parsers', 'allow', undefined, MAESTRO],
  ['git commit -m "x"', 'allow', undefined, { ...MAESTRO, cwd: '/raiz' }],

  ['git add src && git commit -m "x" && git push --force', 'deny', 'push-forcado'],
  ['git reset --hard && git push --force', 'deny', 'push-forcado'],
];

for (const [comando, permissao, regra, opcoes] of casos) {
  test(`${permissao.padEnd(5)} ${comando}${opcoes ? ` ${JSON.stringify(opcoes)}` : ''}`, () => {
    const veredito = avaliar(comando, opcoes);
    assert.equal(veredito.permissao, permissao);
    assert.equal(veredito.regra, regra);
  });
}

test('separarSegmentos respeita aspas, escapes e redirecionamento', () => {
  assert.deepEqual(separarSegmentos('git commit -m "a && b; c" && echo \'x | y\' 2>&1'), [
    ['git', 'commit', '-m', 'a && b; c'],
    ['echo', 'x | y', '2>&1'],
  ]);
  assert.deepEqual(separarSegmentos('git commit \\\n  -m ok'), [['git', 'commit', '-m', 'ok']]);
});
