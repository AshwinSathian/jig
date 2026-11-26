// Asks that interrupted auto-mode sessions for nothing. In auto mode a hook
// "ask" always becomes a prompt, so a false ask costs the owner a click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hook, planRepo, base } from './helpers.mjs';
import { installedPackages } from '../cli/lib/hooks.mjs';

const names = (cmd) => installedPackages(cmd).map((p) => p.name);

test('redirections, flag values, variables and quoted text are not package names', () => {
  assert.deepEqual(names('npm install 2>&1 | tail -3'), []);
  assert.deepEqual(names('npm install >/dev/null'), []);
  assert.deepEqual(names('npm install > out.log'), []);
  assert.deepEqual(names('npm i -w apps/web astro'), ['astro']);
  assert.deepEqual(names('npm i --workspace=apps/web astro'), ['astro']);
  assert.deepEqual(names('pnpm add --filter web zod'), ['zod']);
  assert.deepEqual(names('npm i $PKG'), []);
});

test('real installs still name their packages', () => {
  assert.deepEqual(names('npm i left-pad'), ['left-pad']);
  assert.deepEqual(names('npm i "left-pad" 2>&1'), ['left-pad']);
  assert.deepEqual(names('cd web && npm install -D vitest@3 && npm test'), ['vitest@3']);
  assert.deepEqual(names('pip install requests>=2'), ['requests>=2']);
});

test('checks.json invalid in a field other than protects: only protected files ask', () => {
  const { dir } = planRepo();
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'bogus', cmd: 'node -e ""', timeout_s: 10, protects: ['test/a.accept.test.js'] }] }));
  assert.equal(hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'src/a.js') } })), null, 'an unprotected file');
  const out = hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'test/a.accept.test.js') } }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask', 'a protected file');
});

test('with checks.json invalid elsewhere, the plan-status freeze still asks, and a checks.json edit asks', () => {
  const { dir, planPath } = planRepo();
  const cj = join(dir, 'docs/plans/demo/checks.json');
  writeFileSync(cj, JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'bogus', cmd: 'node -e ""', timeout_s: 10, protects: ['test/a.accept.test.js'] }] }));
  const out = hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: planPath, old_string: 'Status: building', new_string: 'Status: draft' } }));
  assert.equal(out?.hookSpecificOutput?.permissionDecision, 'ask', 'status change');
  const fix = hook('pre-edit', base(dir, { tool_name: 'Write', tool_input: { file_path: cj, content: JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 10, fast: true, protects: ['test/a.accept.test.js'] }] }) } }));
  // While checks.json is invalid, an edit to it can't be compared with a
  // trustworthy baseline, so it asks (fail closed), as it did before 2.4.1.
  assert.equal(fix?.hookSpecificOutput?.permissionDecision, 'ask', 'checks.json edit');
  assert.match(fix.hookSpecificOutput.permissionDecisionReason, /invalid/);
});

test('installs hidden in a shell -c string, behind a flag the tool lacks, or on a continuation line still ask', () => {
  assert.deepEqual(names('bash -c "npm i evil-pkg"'), ['evil-pkg']);
  assert.deepEqual(names("sh -c 'pip install evil-pkg'"), ['evil-pkg']);
  assert.deepEqual(names('npm i -F evil-pkg'), ['evil-pkg'], 'npm has no -F');
  assert.deepEqual(names('npm i -C evil-pkg'), ['evil-pkg'], 'npm has no -C');
  assert.deepEqual(names('pip install -w evil-pkg'), ['evil-pkg'], 'pip -w is not a workspace');
  assert.deepEqual(names('npm i \\\n  evil-pkg'), ['evil-pkg']);
});
