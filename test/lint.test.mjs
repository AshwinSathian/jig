import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintText, lintFile } from '../cli/lib/lint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = join(ROOT, 'evals/fixtures/plans/good');
const read = (p) => readFileSync(join(GOOD, p), 'utf8');
const checksOf = (p) => ({ exists: true, data: JSON.parse(read(p)), error: null });
const NO_CHECKS = { exists: false, data: null, error: null };

const lint = (text, checks = NO_CHECKS) => lintText(text, { root: ROOT, rel: null, checks });
const errors = (ps) => ps.filter((p) => p.level === 'error');

for (const [name, checks] of [['brief', NO_CHECKS], ['full', checksOf('full/checks.json')], ['program', NO_CHECKS]]) {
  test(`good ${name} plan has no errors`, () => {
    assert.deepEqual(errors(lint(read(`${name}/PLAN.md`), checks)), []);
  });
}

// Each mutation breaks one rule in a good plan. The linter must report that rule.
const full = read('full/PLAN.md');
const fullChecks = checksOf('full/checks.json');
const brief = read('brief/PLAN.md');
const MUTATIONS = [
  ['J01', full, (t) => t.replace(/^# .*\n/, '')],
  ['J02', full, (t) => t.replace('Status: building', 'Status: in-review')],
  ['J02', full, (t) => t.replace('Tier: full', 'Tier: epic')],
  ['J03', full, (t) => t.replace(/^Now:.*\n/m, '')],
  ['J04', full, (t) => t.replace('## Out of scope', '## Non-goals')],
  ['J04', full, (t) => t.replace(/## Questions\n- None.\n\n## Assumptions\n- 100k rows is the ceiling, from the ticket.\n/, '## Assumptions\n- 100k rows is the ceiling, from the ticket.\n\n## Questions\n- None.\n')],
  ['J05', full, (t) => t.replace('Done when:', 'Success:')],
  ['J05', full, (t) => t.replace('- C1, C2 and C3 pass under `jig verify`', '- it works for users')],
  ['J06', brief, (t) => t.replace('## Out of scope', 'Filler line.\n'.repeat(30) + '\n## Out of scope')],
  ['J07', full, (t) => t.replace('## Log\n', '## Log\n' + '- 2026-11-25: entry\n'.repeat(400))],
  ['J08', full, (t) => t.replace('### S2: Export button [doing]', '### Export button')],
  ['J08', full, (t) => t.replace('[doing]', '[wip]')],
  ['J09', full, (t) => t.replace('Touch: `cli/lib/lint.mjs`\n', '')],
  ['J09', full, (t) => t.replace('Checks: C3, C4\n', '')],
  ['J10', full, (t) => t.replace('Checks: C3, C4', 'Checks: C3, C9')],
  ['J10', brief, (t) => t.replace('Checks: `npm test -- rateLimit`', 'Checks: C1')],
  ['J11', full, (t) => t.replace('`src/api/reports/export.ts (new)`', '`src/api/reports/export.ts`')],
  ['J12', full, (t) => t.replace('### S2: Export button [doing]', '### S2: Export button (~2d) [doing]')],
  ['J12', full, (t) => t.replace('Goal: the toolbar button', 'Estimated effort: 3 days. Goal: the toolbar button')],
  ['J14', full, (t) => t.replace(' Reason: it already handles quoting.', '')],
  ['J14', full, (t) => t.replace(' Decided: owner 2026-11-25', '')],
  ['J15', full, (t) => t.replace(' Fallback: keyset paging on `id`.', '')],
  ['J16', full, (t) => t.replace('- 2026-11-25: Plan approved by owner.', '- Plan approved by owner.')],
  ['J17', full, (t) => t, { exists: true, data: { version: 1, checks: [{ id: 'C1', slice: 'S7', kind: 'vibes', cmd: '', timeout_s: 9999 }] }, error: null }],
  ['J18', full, (t) => t.replace('Now: S2 in progress', 'Now: S5 in progress')],
  ['J19', full, (t) => t.replace('[done]', '[doing]')],
  ['J22', full, (t) => t, withCmd('C1', 'npx jest --retries 3 export.accept'), 'warning'],
  ['J22', full, (t) => t, withCmd('C1', 'sleep 5 && node -e ""'), 'warning'],
  ['J22', full, (t) => t, withCmd('C1', 'until node -e ""; do echo again; done'), 'warning'],
  ['J23', full, (t) => t, withCmd('C1', 'npm test -- export.accept || true')],
  ['J23', full, (t) => t, withCmd('C1', 'npm test -- export.accept; exit 0')],
  ['J23', full, (t) => t, withCmd('C1', 'npm test -- export.accept || :')],
  ['J24', full, (t) => t.replace('Checks: C3, C4', 'Checks: C3, C4, C1'), null, 'warning'],
  ['J22', full, (t) => t, withCmd('C1', 'npx cypress run --config retries=2'), 'warning'],
  ['J22', full, (t) => t, withCmd('C1', 'for i in 1 2 3; do npm test && break; done'), 'warning'],
  ['J22', full, (t) => t, withCmd('C1', 'while ! npm test; do :; done'), 'warning'],
  ['J23', full, (t) => t, withCmd('C1', 'npm test -- export.accept || true # flaky')],
  ['J23', full, (t) => t, withCmd('C1', 'npm test -- export.accept || echo failed')],
  ['J23', full, (t) => t, withCmd('C1', 'npm test -- export.accept; true')],
  ['J23', full, (t) => t, withCmd('C1', 'npm test -- export.accept 2>&1 | tail -20')],
];

// The good full fixture's checks with one cmd replaced.
function withCmd(id, cmd) {
  const data = JSON.parse(JSON.stringify(fullChecks.data));
  data.checks.find((c) => c.id === id).cmd = cmd;
  return { exists: true, data, error: null };
}

for (const [rule, base, mutate, checks, level = 'error'] of MUTATIONS) {
  test(`mutation for ${rule} is caught`, () => {
    const isFull = base === full;
    const ps = lint(mutate(base), checks ?? (isFull ? fullChecks : NO_CHECKS));
    assert.ok(ps.some((p) => p.rule === rule && p.level === level), `expected ${level} ${rule}, got ${JSON.stringify(ps.map((p) => `${p.level} ${p.rule}`))}`);
  });
}

test('the good full plan, and checks that can still fail, raise no J22, J23 or J24', () => {
  assert.deepEqual(lint(full, fullChecks).filter((p) => ['J22', 'J23', 'J24'].includes(p.rule)), []);
  for (const cmd of [
    'pkill -f server || true; npm test',
    'rm -rf dist || true && npm test',
    'docker rm -f db || true; docker run -d db && npm run e2e',
    'node --test test/retry.test.mjs',
    'npx jest -t "retry backoff"',
    'npx vitest run src/retry',
    'node --test --test-name-pattern "waits until the lock is released and do not double-charge" test/lock.test.mjs',
    'set -o pipefail; npm test 2>&1 | tail -20',
  ]) {
    assert.deepEqual(lint(full, withCmd('C1', cmd)).filter((p) => ['J22', 'J23'].includes(p.rule)).map((p) => p.rule), [], cmd);
  }
});

test('vague words and risk grids are warnings, not errors', () => {
  const ps = lint(brief.replace('Goal: requests past 10', 'Goal: soon, requests past 10').replace('## Log', 'Likelihood: High, Impact: High, Score 9\n\n## Log'));
  assert.ok(ps.some((p) => p.rule === 'J13' && p.level === 'warning'));
  assert.ok(ps.some((p) => p.rule === 'J15' && p.level === 'warning'));
  assert.deepEqual(errors(ps), []);
});

test('durations in requirements are not estimates', () => {
  const ps = lint(brief.replace('## Out of scope', 'Logs are kept for 30 days.\n\n## Out of scope'));
  assert.ok(!ps.some((p) => p.rule === 'J12'));
});

test('log is append-only against the committed version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jig-lint-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  mkdirSync(join(dir, 'docs/plans/x'), { recursive: true });
  const text = brief.replace(/Touch: .*/, 'Touch: `a.txt (new)`');
  writeFileSync(join(dir, 'docs/plans/x/PLAN.md'), text);
  g('add', '-A'); g('commit', '-qm', 'x');
  const okAppend = text.replace(/\n$/, '\n- 2026-11-26: Slice done.\n');
  writeFileSync(join(dir, 'docs/plans/x/PLAN.md'), okAppend);
  assert.ok(!lintFile('docs/plans/x/PLAN.md', { cwd: dir }).problems.some((p) => p.rule === 'J16'));
  writeFileSync(join(dir, 'docs/plans/x/PLAN.md'), text.replace('Plan approved by owner.', 'Plan drafted.'));
  assert.ok(lintFile('docs/plans/x/PLAN.md', { cwd: dir }).problems.some((p) => p.rule === 'J16'));
});
