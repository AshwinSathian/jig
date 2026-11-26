// A `Blocked: <reason>` Log line is an accepted end state: the Stop hook and
// the rounds logic let the session end, and the owner is told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { newPlan } from '../cli/lib/scaffold.mjs';
import { join } from 'node:path';
import { hook, planRepo, base } from './helpers.mjs';
import { verifyPlan } from '../cli/lib/verify.mjs';
const readFile = (p) => readFileSync(p, 'utf8');

function repo() {
  const r = planRepo();
  writeFileSync(join(r.dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [
    { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "process.exit(require(\'fs\').existsSync(\'.git/ok\') ? 0 : 1)"', timeout_s: 10, fast: true },
  ] }));
  r.g('add', '-A'); r.g('commit', '-qm', 'checks');
  hook('session-start', base(r.dir));
  writeFileSync(join(r.dir, 'src/a.js'), 'export const a = 2;\n');
  r.verify = () => verifyPlan(r.dir, r.planPath, { slice: 'S1', record: true });
  r.block = (why = 'C1 needs a Postgres this sandbox does not have') => appendFileSync(r.planPath, `- 2026-11-26: Blocked: ${why}\n`);
  r.stop = (extra) => hook('stop', base(r.dir, extra));
  return r;
}

test('without Blocked, an unverified change blocks the stop (the baseline)', () => {
  const r = repo();
  assert.equal(r.stop()?.decision, 'block');
});

test('a Blocked line as the last Log entry lets the stop through and tells the owner', () => {
  const r = repo();
  r.block();
  const out = r.stop();
  assert.equal(out?.decision, undefined, JSON.stringify(out));
  assert.match(out?.systemMessage ?? '', /blocked.*Postgres/i);
});

test('the owner is told once per session, not on every stop', () => {
  const r = repo();
  r.block();
  assert.ok(r.stop()?.systemMessage);
  assert.equal(r.stop(), null);
  assert.ok(hook('stop', base(r.dir, { session_id: 's2' }))?.systemMessage, 'a new session is told again');
});

test('Blocked also ends the rounds: the third failing verify does not block', () => {
  const r = repo();
  for (let i = 0; i < 3; i++) { r.verify(); r.stop(); }
  r.verify();
  assert.equal(r.stop()?.decision, 'block', 'failing rounds block without Blocked');
  r.verify();
  r.block('the spec and C1 disagree; owner to decide');
  const out = r.stop();
  assert.equal(out?.decision, undefined);
  assert.match(out.systemMessage, /spec and C1 disagree/);
});

test('a verify after the Blocked line puts the normal rules back', () => {
  const r = repo();
  r.block();
  r.verify();
  assert.equal(r.stop()?.decision, 'block', 'C1 still fails and Blocked is no longer the last entry');
});

test('a Blocked line inside an earlier entry or with no reason does not count', () => {
  const r = repo();
  appendFileSync(r.planPath, '- 2026-11-26: Noted that Blocked: is how to stop.\n');
  assert.equal(r.stop()?.decision, 'block');
  appendFileSync(r.planPath, '- 2026-11-26: Blocked:\n');
  assert.equal(r.stop()?.decision, 'block');
});

test("the owner still hears about a Blocked plan when another plan's stop block is observed", () => {
  const r = repo();
  r.block();
  const [p2] = newPlan(r.dir, 'other', { tier: 'full', title: 'Other' });
  writeFileSync(p2, readFile(p2).replace('Status: draft', 'Status: building').replace('### S1: <title> [todo]', '### S1: Other [doing]').replace(/Touch: .*/, 'Touch: `src/`'));
  writeFileSync(join(r.dir, 'docs/plans/other/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'O1', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 10, fast: true }] }));
  const out = hook('stop', base(r.dir), { JIG_GATES: 'observe' });
  assert.match(out?.systemMessage ?? '', /Postgres/);
  assert.equal(out?.decision, undefined, 'the observed block is logged, not printed');
});
