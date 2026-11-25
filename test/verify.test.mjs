import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newPlan } from '../cli/lib/scaffold.mjs';
import { verifyPlan, lastEvidence } from '../cli/lib/verify.mjs';
import { lintFile } from '../cli/lib/lint.mjs';

const made = [];
process.on('exit', () => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

export function tempRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jig-')));
  made.push(dir);
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  g('add', '-A'); g('commit', '-qm', 'init');
  return { dir, g };
}

test('jig new writes a full plan with checks.json and a real baseline', () => {
  const { dir } = tempRepo();
  const files = newPlan(dir, 'csv-export', { tier: 'full', title: 'CSV export' });
  assert.equal(files.length, 2);
  const text = readFileSync(files[0], 'utf8');
  assert.match(text, /^# CSV export\n\nStatus: draft · Tier: full · Baseline: [0-9a-f]{7,}/);
  assert.throws(() => newPlan(dir, 'csv-export', { tier: 'full' }), /already exists/);
  assert.throws(() => newPlan(dir, 'Bad Slug'), /kebab-case/);
});

test('verify runs checks, records evidence, and the recorded plan still lints', () => {
  const { dir, g } = tempRepo();
  const [planPath] = newPlan(dir, 'demo', { tier: 'full', title: 'Demo' });
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), JSON.stringify({
    version: 1,
    checks: [
      { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "console.log(\'ok 3\')"', expect: { exit: 0, stdout: 'ok \\d' }, timeout_s: 30, fast: true },
      { id: 'C2', slice: 'S1', kind: 'regression', cmd: 'node -e "console.error(\'boom\'); process.exit(3)"', timeout_s: 30, fast: true },
      { id: 'C3', slice: 'S1', kind: 'perf', cmd: 'node -e ""', timeout_s: 300, fast: false },
    ],
  }));
  g('add', '-A'); g('commit', '-qm', 'plan');

  const res = verifyPlan(dir, planPath, { slice: 'S1', fast: true, record: true });
  assert.deepEqual(res.results.map((r) => [r.id, r.pass]), [['C1', true], ['C2', false]]);
  assert.match(res.results[1].why, /exit 3 \(expected 0\): boom/);

  const ev = lastEvidence(dir);
  assert.equal(ev.results.length, 2);
  assert.equal(ev.fast, true);

  const text = readFileSync(planPath, 'utf8');
  assert.match(text, /jig verify S1: C1 pass; C2 FAIL \(exit 3/);
  const j16 = lintFile(planPath, { cwd: dir }).problems.filter((p) => p.rule === 'J16');
  assert.deepEqual(j16, []);
});

test('verify times out a hung check', () => {
  const { dir } = tempRepo();
  const [planPath] = newPlan(dir, 'hang', { tier: 'full' });
  writeFileSync(join(dir, 'docs/plans/hang/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "setTimeout(()=>{}, 10000)"', timeout_s: 1 }] }));
  const res = verifyPlan(dir, planPath, {});
  assert.equal(res.results[0].pass, false);
  assert.match(res.results[0].why, /timed out/);
});
