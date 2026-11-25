// Gap 2: evidence is tied to the working tree, so changes made through Bash
// (sed, codegen, git apply, mv) can't finish without verifying.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync, mkdtempSync, realpathSync, rmSync, mkdirSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hook, planRepo, base } from './helpers.mjs';
import { verifyPlan, lastEvidence } from '../cli/lib/verify.mjs';
import { newPlan } from '../cli/lib/scaffold.mjs';
import { stateDir } from '../cli/lib/git.mjs';

const blocks = (out) => out?.decision === 'block';

test('gap 2: a session that changes code only through Bash is blocked at Stop', () => {
  const { dir } = planRepo();
  hook('session-start', base(dir));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n'); // no Edit hook ran
  assert.ok(blocks(hook('stop', base(dir))));
});

test('tree: a session that only reads an already-dirty repo is not blocked', () => {
  const { dir } = planRepo();
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  hook('session-start', base(dir));
  assert.equal(hook('stop', base(dir)), null);
});

test('tree: verify, then a Log append and a commit, leaves the evidence current', () => {
  const { dir, g, planPath } = planRepo();
  hook('session-start', base(dir));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  verifyPlan(dir, planPath, { slice: 'S1', record: true });
  assert.ok(lastEvidence(dir).tree, 'evidence carries a tree id');
  assert.ok(lastEvidence(dir).head, 'evidence carries HEAD');
  appendFileSync(planPath, '- 2026-11-25: note.\n');
  assert.equal(hook('stop', base(dir)), null, 'plans dir is excluded');
  g('add', '-A'); g('commit', '-qm', 'slice');
  assert.equal(hook('stop', base(dir)), null, 'a commit moves HEAD but not the tree');
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 3;\n');
  assert.ok(blocks(hook('stop', base(dir))), 'a later change is stale again');
});

test('tree: untracked files count, ignored files do not, and the real index is untouched', () => {
  const { dir, g } = planRepo();
  writeFileSync(join(dir, '.gitignore'), 'out/\n'); g('add', '-A'); g('commit', '-qm', 'ignore');
  hook('session-start', base(dir));
  mkdirSync(join(dir, 'out')); writeFileSync(join(dir, 'out/build.js'), 'x');
  assert.equal(hook('stop', base(dir)), null, 'ignored');
  writeFileSync(join(dir, 'src/new.js'), 'x');
  assert.ok(blocks(hook('stop', base(dir))), 'untracked');
  const st = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  assert.match(st, /^\?\? src\/new\.js$/m, 'still untracked in the real index');
  assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }), '');
});

test('tree: computed after the checks run, so a check that writes output stays current', () => {
  const { dir, planPath } = planRepo();
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [
    { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "require(\'fs\').writeFileSync(\'report.txt\', String(Date.now()))"', timeout_s: 10, fast: true },
  ] }));
  hook('session-start', base(dir));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  verifyPlan(dir, planPath, { slice: 'S1' });
  assert.equal(hook('stop', base(dir)), null);
});

test('tree: SessionStart on resume or compact keeps the first tree', () => {
  const { dir } = planRepo();
  hook('session-start', base(dir, { source: 'startup' }));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  hook('session-start', base(dir, { source: 'compact' }));
  assert.ok(blocks(hook('stop', base(dir))));
});

test('tree: evidence from before 2.1 has no tree, counts as stale, and says so', () => {
  const { dir, planPath } = planRepo();
  hook('session-start', base(dir));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  appendFileSync(join(stateDir(dir), 'evidence.jsonl'), JSON.stringify({ t: Date.now(), plan: 'docs/plans/demo/PLAN.md', slice: 'S1', results: [{ id: 'C1', pass: true }] }) + '\n');
  const out = hook('stop', base(dir));
  assert.ok(blocks(out));
  assert.match(out.reason, /no tree id/);
  verifyPlan(dir, planPath, { slice: 'S1' });
  assert.equal(hook('stop', base(dir)), null);
});

test('tree: outside git the Edit-hook timestamp still applies', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jig-nogit-')));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  const [planPath] = newPlan(dir, 'demo', { tier: 'full', title: 'Demo' });
  writeFileSync(planPath, readFileSync(planPath, 'utf8').replace('Status: draft', 'Status: building').replace('### S1: <title> [todo]', '### S1: Add a [doing]').replace(/Touch: .*/, 'Touch: `a.js (new)`'));
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 10, fast: true }] }));
  hook('session-start', base(dir));
  assert.equal(hook('stop', base(dir)), null, 'no edits');
  hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'a.js') } }));
  assert.ok(blocks(hook('stop', base(dir))));
  verifyPlan(dir, planPath, { slice: 'S1' });
  assert.equal(hook('stop', base(dir)), null);
});

test('tree: a Bash edit to checks.json after a passing verify is stale', () => {
  const { dir, planPath } = planRepo();
  hook('session-start', base(dir));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  verifyPlan(dir, planPath, { slice: 'S1' });
  assert.equal(hook('stop', base(dir)), null);
  const p = join(dir, 'docs/plans/demo/checks.json');
  writeFileSync(p, readFileSync(p, 'utf8').replace('node -e \\"\\"', 'true'));
  assert.ok(blocks(hook('stop', base(dir))));
});

test('tree: a clean filter in .git/config is never run by the hooks', () => {
  const { dir, g } = planRepo();
  writeFileSync(join(dir, '.gitattributes'), '*.js filter=evil\n'); g('add', '.gitattributes'); g('commit', '-qm', 'attrs');
  g('config', 'filter.evil.clean', `touch ${join(dir, '.git', 'pwned')}; cat`);
  hook('session-start', base(dir));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  hook('stop', base(dir));
  assert.equal(existsSync(join(dir, '.git', 'pwned')), false);
});

test('tree: a session that started before the plan was active records its tree at the first tool call', () => {
  const { dir, planPath } = planRepo();
  const active = readFileSync(planPath, 'utf8');
  writeFileSync(planPath, active.replace('Status: building', 'Status: draft'));
  hook('session-start', base(dir));
  writeFileSync(planPath, active);
  hook('pre-bash', base(dir, { tool_input: { command: 'sed -i "" s/1/2/ src/a.js' } }));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n'); // what the sed did
  assert.ok(blocks(hook('stop', base(dir))));
});

test('tree: an unreadable untracked file neither crashes the hooks nor opens a protected test', () => {
  const { dir } = planRepo();
  writeFileSync(join(dir, 'src/secret.txt'), 'x');
  chmodSync(join(dir, 'src/secret.txt'), 0o000);
  try {
    const out = hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'test/a.accept.test.js') } }));
    assert.equal(out?.hookSpecificOutput?.permissionDecision, 'ask');
    hook('session-start', base(dir));
    writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
    assert.ok(blocks(hook('stop', base(dir))));
  } finally { chmodSync(join(dir, 'src/secret.txt'), 0o644); }
});
