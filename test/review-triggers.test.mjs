// Router triggers: each row has cases that must match and cases that must not.
// D7's first version gave eight false results, so every negative here is a
// file or line a loose pattern would catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggersFor } from '../cli/lib/review.mjs';

const f = (path, added = [], extra = {}) => ({ path, added, removed: extra.removed ?? [], adds: extra.adds ?? Math.max(added.length, 1), dels: extra.dels ?? 0 });
const ids = (files, opts) => triggersFor(files, { plansDir: 'docs/plans', ...opts }).map((t) => t.id).sort();
const has = (files, id) => ids(files).includes(id);

const CASES = {
  ui: {
    yes: [f('src/components/Button.tsx'), f('app/page.vue'), f('styles/main.css'), f('web/index.html')],
    no: [f('src/api/handler.ts'), f('src/components/Button.test.tsx'), f('app/api/route.ts')],
  },
  prose: {
    yes: [f('README.md'), f('docs/guide.md'), f('CHANGELOG.md'), f('skills/review/SKILL.md'), f('CONTRIBUTING.md')],
    no: [f('docs/plans/review-loop/PLAN.md'), f('docs/plans/review-loop/checks.json'), f('src/readme.js'), f('requirements.txt', ['django==5.1']), f('CMakeLists.txt', ['add_executable(a a.c)']), f('test/fixtures/out.md')],
  },
  security: {
    yes: [
      f('src/auth/login.ts'),
      f('src/run.js', ["const out = execSync(`git ${args}`);"]),
      f('app/db.py', ['cur.execute(f"SELECT * FROM users WHERE id = {uid}")']),
      f('lib/load.py', ['data = pickle.loads(blob)']),
      f('src/files.js', ['const p = path.join(root, req.params.name);']),
      f('src/token.js', ["crypto.createHash('md5')"]),
      f('src/billing/invoice.ts'),
    ],
    no: [f('docs/auth.md'), f('src/blockquote.js', ['const blocked = true;']), f('src/author.js', ['export const authorName = "x";']), f('src/sum.js', ['const total = a + b;']), f('src/re.js', ['const m = /x(\\d+)/.exec(s);']), f('src/draw.js', ['const x = Math.random() * width;']), f('src/lexer/token.ts'), f('src/parser/tokens.js'), f('test/run.test.mjs', ["f('src/run.js', ['execSync(`git ${args}`)'])"])],
  },
  invariants: {
    yes: [f('src/w.js', ["const w = new Worker('w.js');"]), f('src/queue.js', ['await db.transaction(async (tx) => {']), f('src/cache.ts', ['cache.invalidate(key);']), f('src/parser/csv.js')],
    no: [f('src/ui/blocked.js', ['const blocked = true;']), f('README.md', ['We use a lock file.']), f('test/q.test.js', ['await db.transaction(fn);'])],
  },
  'tests-or-checks': {
    yes: [f('test/a.test.mjs'), f('src/__tests__/x.js'), f('pkg/foo_test.go'), f('tests/test_api.py'), f('.github/workflows/ci.yml'), f('docs/plans/x/checks.json'), f('vitest.config.ts'), f('package.json', ['    "test": "vitest run",'])],
    no: [f('src/contest.js'), f('src/testing-guide.md'), f('package.json', ['    "clean": "rm -rf playwright-report",'])],
  },
  migration: {
    yes: [f('db/migrations/001_init.sql'), f('prisma/schema.prisma'), f('alembic/versions/abc.py'), f('src/db.js', ['await knex.raw("ALTER TABLE users ADD COLUMN x int")'])],
    no: [f('docs/migration-guide.md'), f('src/migrate-ui.tsx', ['export const MigrateButton = () => null;'])],
  },
};

for (const [id, { yes, no }] of Object.entries(CASES)) {
  for (const file of yes) test(`${id} matches ${file.path}${file.added[0] ? ` (${file.added[0].trim()})` : ''}`, () => assert.ok(has([file], id), ids([file]).join(',')));
  for (const file of no) test(`${id} does not match ${file.path}${file.added[0] ? ` (${file.added[0].trim()})` : ''}`, () => assert.ok(!has([file], id), ids([file]).join(',')));
}

test('each trigger lists the files that matched it', () => {
  const t = triggersFor([f('src/auth/a.ts'), f('README.md'), f('src/b.ts')], { plansDir: 'docs/plans' });
  assert.deepEqual(t.find((x) => x.id === 'security').files, ['src/auth/a.ts']);
  assert.deepEqual(t.find((x) => x.id === 'prose').files, ['README.md']);
});

test('ui, prose and security name their partner skill', () => {
  const t = triggersFor([f('a.tsx'), f('README.md'), f('src/auth.ts')], { plansDir: 'docs/plans' });
  assert.equal(t.find((x) => x.id === 'ui').partner, 'loupe');
  assert.equal(t.find((x) => x.id === 'prose').partner, 'humanizing-writing');
  assert.equal(t.find((x) => x.id === 'security').partner, 'owasp-security');
});

test('prose marks people-facing docs for the voice pass, and skills or references without it', () => {
  const t = triggersFor([f('README.md'), f('docs/guide.md'), f('skills/review/SKILL.md'), f('references/x.md'), f('agents/a.md')], { plansDir: 'docs/plans' });
  const p = t.find((x) => x.id === 'prose');
  assert.deepEqual(p.voice, ['README.md', 'docs/guide.md']);
});

test('trivial: a small docs-only diff', () => {
  assert.ok(has([f('README.md', ['Fix teh typo'], { adds: 1, dels: 1 })], 'trivial'));
});

test('trivial does not match a small code change, a large docs change, or a plan-dir rename that touches code', () => {
  assert.ok(!has([f('src/a.js', ['x'], { adds: 1, dels: 1 })], 'trivial'));
  assert.ok(!has([f('docs/guide.md', [], { adds: 300, dels: 0 })], 'trivial'));
  assert.ok(!has([f('README.md', [], { adds: 1 }), f('src/auth.ts', [], { adds: 1 })], 'trivial'));
});

test('trivial does not match a dependency or build file change', () => {
  assert.ok(!has([f('requirements.txt', ['django==5.1'])], 'trivial'));
  assert.ok(!has([f('CMakeLists.txt', ['x'])], 'trivial'));
});

test('an empty diff has no triggers', () => {
  assert.deepEqual(triggersFor([], { plansDir: 'docs/plans' }), []);
});
