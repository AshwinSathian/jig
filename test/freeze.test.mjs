// Gap 1: a slice must not loosen its own checks without a person seeing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { hook, planRepo, base, CLI } from './helpers.mjs';
import { verifyPlan } from '../cli/lib/verify.mjs';

const CHECKS = 'docs/plans/demo/checks.json';
const C1 = { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 10, fast: true, protects: ['test/a.accept.test.js'] };
const json = (checks) => JSON.stringify({ version: 1, checks }, null, 2) + '\n';

function repo() {
  const r = planRepo();
  writeFileSync(join(r.dir, CHECKS), json([C1]));
  r.g('add', '-A'); r.g('commit', '-qm', 'pretty checks');
  return r;
}
const write = (dir, checks) => hook('pre-edit', base(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, CHECKS), content: typeof checks === 'string' ? checks : json(checks) } }));
const asks = (out) => out?.hookSpecificOutput?.permissionDecision === 'ask';

test('gap 1: an Edit that loosens an existing check asks', () => {
  const { dir } = repo();
  const out = hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, CHECKS), old_string: '"cmd": "node -e \\"\\""', new_string: '"cmd": "true"' } }));
  assert.ok(asks(out), `expected ask, got ${JSON.stringify(out)}`);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /C1/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /cmd/);
});

test('freeze: each frozen field, a removed id and a removed protects entry ask', () => {
  const { dir } = repo();
  const cases = {
    cmd: { ...C1, cmd: 'true' },
    expect: { ...C1, expect: { exit: 1 } },
    kind: { ...C1, kind: 'regression' },
    timeout_s: { ...C1, timeout_s: 600 },
    fast: { ...C1, fast: false },
    slice: { ...C1, slice: 'S2' },
    protects: { ...C1, protects: [] },
  };
  for (const [field, changed] of Object.entries(cases)) {
    const out = write(dir, [changed]);
    assert.ok(asks(out), `${field}: expected ask`);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, new RegExp(field), field);
  }
  assert.ok(asks(write(dir, [])), 'removed id');
});

test('freeze: new checks and new protects entries are silent; never allow', () => {
  const { dir } = repo();
  const C2 = { id: 'C2', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 10, fast: true };
  assert.equal(write(dir, [C1, C2]), null);
  assert.equal(write(dir, [{ ...C1, protects: [...C1.protects, 'test/b.test.js'] }]), null);
  assert.equal(write(dir, json([C1])), null, 'unchanged');
});

test('freeze: MultiEdit and replace_all are applied before comparing', () => {
  const { dir } = repo();
  const multi = hook('pre-edit', base(dir, { tool_name: 'MultiEdit', tool_input: { file_path: join(dir, CHECKS), edits: [
    { old_string: '"fast": true', new_string: '"fast": true' },
    { old_string: '"timeout_s": 10', new_string: '"timeout_s": 600' },
  ] } }));
  assert.ok(asks(multi), 'MultiEdit loosening timeout');
  // Two checks in S1: only replacing every occurrence moves C2 as well.
  const C2 = { ...C1, id: 'C2', protects: [] };
  writeFileSync(join(dir, CHECKS), json([C1, C2]));
  const all = hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, CHECKS), old_string: '"S1"', new_string: '"S2"', replace_all: true } }));
  assert.ok(asks(all), 'replace_all moving slice');
  assert.match(all.hookSpecificOutput.permissionDecisionReason, /C1 \(slice\); C2 \(slice\)/);
});

test('freeze: an edit that would leave invalid JSON asks (fail closed)', () => {
  const { dir } = repo();
  const out = write(dir, '{"version": 1, "checks": [');
  assert.ok(asks(out));
});

test('freeze: a draft plan is not frozen', () => {
  const { dir, planPath } = repo();
  writeFileSync(planPath, readFileSync(planPath, 'utf8').replace('Status: building', 'Status: draft'));
  assert.equal(write(dir, []), null);
});

test('verify names checks changed through Bash, against the last record and then HEAD', () => {
  const { dir, planPath } = repo();
  // No earlier record: compares with HEAD.
  writeFileSync(join(dir, CHECKS), json([{ ...C1, cmd: 'node -e "0"' }]));
  const first = verifyPlan(dir, planPath, { slice: 'S1', record: true });
  assert.deepEqual(first.changed.map((c) => c.id), ['C1']);
  assert.equal(first.changedSince, 'HEAD');
  assert.match(readFileSync(planPath, 'utf8'), /changed since HEAD: C1 \(cmd\)/);
  // Same file again: nothing changed since the last record.
  assert.deepEqual(verifyPlan(dir, planPath, { slice: 'S1' }).changed, []);
  // A plain verify after a Bash edit must not hide it from the next Log line.
  writeFileSync(join(dir, CHECKS), json([{ ...C1, cmd: 'node -e "1"' }]));
  assert.deepEqual(verifyPlan(dir, planPath, { slice: 'S1' }).changed.map((c) => c.id), ['C1']);
  assert.deepEqual(verifyPlan(dir, planPath, { ids: ['NOPE'] }).changed.map((c) => c.id), ['C1']);
  assert.match(verifyPlan(dir, planPath, { slice: 'S1', record: true }).changed[0].why, /cmd/);
  // A dropped protects entry is named; an added one is not.
  writeFileSync(join(dir, CHECKS), json([{ ...C1, cmd: 'node -e "1"', protects: ['test/new.test.js'] }]));
  const r = spawnSync('node', [CLI, 'verify', '--plan', planPath, '--slice', 'S1', '--record'], { cwd: dir, encoding: 'utf8' });
  assert.match(r.stdout, /changed since the last record: C1 \(protects -test\/a\.accept\.test\.js\)/);
  assert.match(readFileSync(planPath, 'utf8'), /changed since the last record: C1 \(protects -test\/a\.accept\.test\.js\)/);
});

test('verify says so when the committed checks.json does not parse', () => {
  const { dir, g, planPath } = repo();
  writeFileSync(join(dir, CHECKS), '{broken'); g('add', '-A'); g('commit', '-qm', 'broken');
  writeFileSync(join(dir, CHECKS), json([C1]));
  const r = spawnSync('node', [CLI, 'verify', '--plan', planPath, '--slice', 'S1'], { cwd: dir, encoding: 'utf8' });
  assert.match(r.stdout, /HEAD docs\/plans\/demo\/checks\.json is not valid JSON/);
});

test('freeze: a check id that names an Object property is still compared', () => {
  const { dir, g } = repo();
  writeFileSync(join(dir, CHECKS), json([C1, { ...C1, id: 'constructor', protects: ['test/x.test.js'] }])); g('add', '-A'); g('commit', '-qm', 'odd id');
  assert.ok(asks(write(dir, [C1])), 'removing check "constructor"');
});

test('freeze: an Edit to checks.json that cannot be simulated asks', () => {
  const { dir } = repo();
  const out = hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, CHECKS), old_string: '“cmd”', new_string: '"x"' } }));
  assert.ok(asks(out));
});

test('freeze: a path spelled in another case is the same file', { skip: !existsSync(join(import.meta.dirname, '..', 'PACKAGE.JSON')) && 'case-sensitive filesystem' }, () => {
  const { dir } = repo();
  const out = hook('pre-edit', base(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, 'Docs/Plans/demo/CHECKS.json'), content: json([]) } }));
  assert.ok(asks(out));
});

test('freeze: an edit that takes the plan out of approved or building asks', () => {
  const { dir, planPath } = repo();
  const out = hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: planPath, old_string: 'Status: building', new_string: 'Status: draft' } }));
  assert.ok(asks(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /draft/);
  assert.equal(hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: planPath, old_string: 'Status: building', new_string: 'Status: approved' } })), null);
});

test('freeze: an Edit to an active PLAN.md that cannot be simulated asks', () => {
  const { dir, planPath } = repo();
  const out = hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: planPath, old_string: 'Status: bulding', new_string: 'Status: draft' } }));
  assert.ok(asks(out));
});
