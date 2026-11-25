import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo } from './verify.test.mjs';
import { newPlan } from '../cli/lib/scaffold.mjs';
import { verifyPlan } from '../cli/lib/verify.mjs';
import { installedPackages, pathMatches } from '../cli/lib/hooks.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'jig.mjs');

function hook(name, input, env = {}) {
  const r = spawnSync('node', [CLI, 'hook', name], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, JIG_NUDGE: 'on', JIG_HOOKS_OFF: '', ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

// A repo with an approved full plan: S1 doing, touching src/a.js, C1 protecting test/a.accept.test.js.
function planRepo() {
  const { dir, g } = tempRepo();
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'test'));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'test/a.accept.test.js'), '// spec\n');
  const [planPath] = newPlan(dir, 'demo', { tier: 'full', title: 'Demo' });
  let t = readFileSync(planPath, 'utf8');
  t = t.replace('Status: draft', 'Status: building').replace('### S1: <title> [todo]', '### S1: Add a [doing]').replace(/Touch: .*/, 'Touch: `src/a.js`, `test/`');
  writeFileSync(planPath, t);
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [
    { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 10, fast: true, protects: ['test/a.accept.test.js'] },
  ] }));
  g('add', '-A'); g('commit', '-qm', 'plan');
  return { dir, planPath };
}

const base = (dir, extra = {}) => ({ session_id: 's1', cwd: dir, ...extra });

test('session-start: nudge always, plan status when a plan is active', () => {
  const { dir } = tempRepo();
  const quiet = hook('session-start', base(dir));
  assert.match(quiet.hookSpecificOutput.additionalContext, /jig:plan/);
  assert.doesNotMatch(quiet.hookSpecificOutput.additionalContext, /Active jig plans/);
  const { dir: d2 } = planRepo();
  const loud = hook('session-start', base(d2));
  assert.match(loud.hookSpecificOutput.additionalContext, /Active jig plans[\s\S]*Doing: S1 Add a/);
  assert.equal(hook('session-start', base(dir), { JIG_NUDGE: 'off' }), null);
});

test('pre-edit: protected acceptance test asks; never allows', () => {
  const { dir } = planRepo();
  const out = hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, 'test/a.accept.test.js') } }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /protected by check C1/);
});

test('pre-edit: in-scope edit is silent; out-of-scope warns once per file, with no decision', () => {
  const { dir } = planRepo();
  assert.equal(hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'src/a.js') } })), null);
  assert.equal(hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'test/other.test.js') } })), null, 'test/ prefix is in Touch');
  const warn = hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'src/b.js') } }));
  assert.match(warn.hookSpecificOutput.additionalContext, /outside S1's Touch list/);
  assert.equal(warn.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'src/b.js') } })), null, 'second warning suppressed');
});

test('pre-edit: invalid checks.json fails closed (asks)', () => {
  const { dir } = planRepo();
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), '{"version":1,"checks":[{"id":"C1","protects":"test/"}]}');
  const out = hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'src/a.js') } }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /invalid/);
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), '{not json');
  assert.equal(hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'src/a.js') } })).hookSpecificOutput.permissionDecision, 'ask');
});

test('pre-edit: no active plan means no output', () => {
  const { dir } = tempRepo();
  assert.equal(hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'x.js') } })), null);
});

test('pre-bash: installs that name a package ask; lockfile installs pass', () => {
  const { dir } = tempRepo();
  const ask = hook('pre-bash', base(dir, { tool_input: { command: 'cd web && npm install --save left-padd' } }));
  assert.equal(ask.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(ask.hookSpecificOutput.permissionDecisionReason, /left-padd \(npm\)/);
  for (const cmd of ['npm ci', 'npm install', 'pip install -r requirements.txt', 'pip install -e .', 'npm test', 'git commit -m "npm install foo"'.replace('npm install foo', 'deps')]) {
    assert.equal(hook('pre-bash', base(dir, { tool_input: { command: cmd } })), null, cmd);
  }
});

test('installedPackages parses the common ecosystems', () => {
  const names = (c) => installedPackages(c).map((p) => p.name);
  assert.deepEqual(names('pnpm add -D vitest @types/node'), ['vitest', '@types/node']);
  assert.deepEqual(names('pip install requests==2.32.0'), ['requests==2.32.0']);
  assert.deepEqual(names('uv add httpx && cargo add serde'), ['httpx', 'serde']);
  assert.deepEqual(names('go get github.com/x/y@v1'), ['github.com/x/y@v1']);
  assert.deepEqual(names('python -m pip install -r req.txt'), []);
});

test('stop: blocks when files changed after the last verify, then passes once verified', () => {
  const { dir, planPath } = planRepo();
  hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'src/a.js') } }));
  const block = hook('stop', base(dir));
  assert.equal(block.decision, 'block');
  assert.match(block.reason, /jig verify/);
  assert.equal(hook('stop', base(dir, { stop_hook_active: true })), null, 're-entry guard');
  verifyPlan(dir, planPath, { slice: 'S1', fast: true });
  assert.equal(hook('stop', base(dir)), null);
});

test('stop: failing checks block once, and stay quiet without edits', () => {
  const { dir, planPath } = planRepo();
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "process.exit(1)"', timeout_s: 10, fast: true }] }));
  assert.equal(hook('stop', base(dir)), null, 'no edits this session');
  hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'src/a.js') } }));
  verifyPlan(dir, planPath, { slice: 'S1', fast: true });
  const block = hook('stop', base(dir));
  assert.match(block.reason, /failing checks \(C1\)/);
  assert.equal(hook('stop', base(dir)), null, 'reported once');
});

test('hooks can be switched off and never fail the user', () => {
  const { dir } = tempRepo();
  assert.equal(hook('pre-bash', base(dir, { tool_input: { command: 'npm i lodash' } }), { JIG_HOOKS_OFF: 'pre-bash' }), null);
  const r = spawnSync('node', [CLI, 'hook', 'pre-edit'], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
});

test('pathMatches handles exact, directory and glob patterns', () => {
  assert.ok(pathMatches('src/a.js', 'src/a.js'));
  assert.ok(pathMatches('test/x/y.js', 'test/'));
  assert.ok(pathMatches('test/a.accept.test.ts', 'test/*.accept.test.ts'));
  assert.ok(pathMatches('a/b/c.ts', 'a/**/*.ts'));
  assert.ok(!pathMatches('src/ab.js', 'src/a.js'));
});
