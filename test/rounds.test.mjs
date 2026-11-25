// Gap 3: failing checks get three rounds, then go to a person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hook, planRepo, base } from './helpers.mjs';
import { verifyPlan } from '../cli/lib/verify.mjs';
import { newPlan } from '../cli/lib/scaffold.mjs';

// C1 passes when .git/ok exists (inside .git, so toggling it doesn't change
// the working tree). C2 always passes unless told otherwise.
function repo({ c2 = 'node -e ""' } = {}) {
  const r = planRepo();
  writeFileSync(join(r.dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [
    { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "process.exit(require(\'fs\').existsSync(\'.git/ok\') ? 0 : 1)"', timeout_s: 10, fast: true },
    { id: 'C2', slice: 'S1', kind: 'acceptance', cmd: c2, timeout_s: 10, fast: true },
  ] }));
  r.g('add', '-A'); r.g('commit', '-qm', 'checks');
  hook('session-start', base(r.dir));
  writeFileSync(join(r.dir, 'src/a.js'), 'export const a = 2;\n');
  r.pass = (yes) => (yes ? writeFileSync(join(r.dir, '.git/ok'), '') : rmSync(join(r.dir, '.git/ok'), { force: true }));
  r.verify = () => verifyPlan(r.dir, r.planPath, { slice: 'S1' });
  r.stop = (extra) => hook('stop', base(r.dir, extra));
  return r;
}

test('gap 3: a second failure in the same session blocks again', () => {
  const r = repo();
  r.verify();
  assert.equal(r.stop()?.decision, 'block', 'first failure');
  assert.equal(r.stop({ stop_hook_active: true }), null, 're-entry guard');
  r.verify();
  const second = r.stop();
  assert.equal(second?.decision, 'block', 'second failure');
  assert.match(second.reason, /C1 \(round 2 of 3\)/);
});

test('rounds: each failing record blocks once', () => {
  const r = repo();
  r.verify();
  assert.equal(r.stop()?.decision, 'block');
  assert.equal(r.stop(), null, 'same record, already reported');
});

test('rounds: the third failure says stop and report, blocks once, then allows the stop', () => {
  const r = repo();
  for (let i = 0; i < 3; i++) r.verify();
  const out = r.stop();
  assert.equal(out?.decision, 'block');
  assert.match(out.reason, /C1 has failed 3 verify rounds in a row/);
  assert.match(out.reason, /don't try again/);
  assert.match(out.reason, /exit 1 \(expected 0\)/, 'the current error');
  assert.equal(r.stop(), null);
});

test('rounds: a pass resets the count, and counts are per check', () => {
  const r = repo({ c2: 'node -e "process.exit(2)"' });
  r.verify(); r.verify();
  r.pass(true); r.verify();
  r.pass(false); r.verify();
  const out = r.stop();
  assert.match(out.reason, /C1 \(round 1 of 3\)/);
  assert.match(out.reason, /C2 has failed 4 verify rounds in a row/);
});

test('rounds: records from another plan do not count', () => {
  const r = repo();
  r.verify(); r.verify();
  const [other] = newPlan(r.dir, 'other', { tier: 'full' }); // its skeleton C1 fails too
  verifyPlan(r.dir, other, { slice: 'S1' });
  r.verify();
  assert.match(r.stop().reason, /C1 has failed 3 verify rounds/);
});

test('rounds: a second plan with a slice in progress keeps its own count and record', () => {
  const r = repo();
  r.verify(); r.verify();
  const [other] = newPlan(r.dir, 'other', { tier: 'full' });
  writeFileSync(other, readFileSync(other, 'utf8').replace('Status: draft', 'Status: building').replace('### S1: <title> [todo]', '### S1: Other [doing]'));
  writeFileSync(join(r.dir, 'docs/plans/other/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "process.exit(5)"', timeout_s: 10, fast: true }] }));
  r.verify();
  verifyPlan(r.dir, other, { slice: 'S1' }); // the last record now belongs to the other plan
  const out = r.stop();
  assert.match(out.reason, /other\/PLAN\.md\): the last `jig verify` had failing checks \(C1\)\. Rounds so far: C1 \(round 1 of 3\)/, 'the other plan counts its own rounds');
  assert.match(out.reason, /demo\/PLAN\.md\): C1 has failed 3 verify rounds in a row/, "a later record from another plan doesn't hide this one");
});
