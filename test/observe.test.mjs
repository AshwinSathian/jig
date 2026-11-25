// Observe mode: a gate logs what it would have asked or blocked, and prints nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hook, planRepo, base } from './helpers.mjs';
import { tempRepo } from './verify.test.mjs';
import { stateDir } from '../cli/lib/git.mjs';
import { verifyPlan } from '../cli/lib/verify.mjs';

const log = (dir) => {
  const p = join(stateDir(dir), 'observe.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};
const ALL = { JIG_GATES: 'observe' };
const protectedEdit = (dir) => base(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, 'test/a.accept.test.js'), old_string: '// spec', new_string: '// x' } });

test('observe: every gate logs instead of asking or blocking', () => {
  const { dir, planPath } = planRepo();
  assert.equal(hook('pre-edit', protectedEdit(dir), ALL), null, 'protects');
  assert.equal(hook('pre-edit', base(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, 'docs/plans/demo/checks.json'), content: '{"version":1,"checks":[]}' } }), ALL), null, 'freeze');
  assert.equal(hook('pre-bash', base(dir, { tool_input: { command: 'npm i left-padd' } }), ALL), null, 'install');
  hook('session-start', base(dir), ALL);
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  assert.equal(hook('stop', base(dir), ALL), null, 'tree');
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "process.exit(1)"', timeout_s: 10, fast: true }] }));
  verifyPlan(dir, planPath, { slice: 'S1' });
  assert.equal(hook('stop', base(dir), ALL), null, 'rounds');
  const gates = log(dir).map((e) => e.gate);
  assert.deepEqual(gates, ['protects', 'freeze', 'install', 'tree', 'rounds']);
  for (const e of log(dir)) {
    assert.ok(e.t && e.hook && e.session === 's1' && e.reason.startsWith('jig'), JSON.stringify(e));
    assert.ok(['ask', 'block'].includes(e.decision));
  }
});

test('observe: naming gates observes only those, and the rest still ask', () => {
  const { dir } = planRepo();
  const named = { JIG_GATES: 'observe:freeze,tree,rounds' };
  assert.equal(hook('pre-edit', protectedEdit(dir), named).hookSpecificOutput.permissionDecision, 'ask', 'protects still enforced');
  assert.equal(hook('pre-edit', base(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, 'docs/plans/demo/checks.json'), content: '{"version":1,"checks":[]}' } }), named), null, 'freeze observed');
  assert.deepEqual(log(dir).map((e) => e.gate), ['freeze']);
});

test('observe: context-only output is unchanged', () => {
  const { dir } = planRepo();
  const warn = hook('pre-edit', base(dir, { tool_input: { file_path: join(dir, 'src/b.js') } }), ALL);
  assert.match(warn.hookSpecificOutput.additionalContext, /outside S1's Touch list/);
  assert.match(hook('session-start', base(dir), ALL).hookSpecificOutput.additionalContext, /jig:plan/);
  assert.deepEqual(log(dir), []);
});

test('rules gate: rule-file edits are logged, not asked, even with no plan and no JIG_GATES', () => {
  const { dir } = tempRepo();
  for (const f of ['CLAUDE.md', 'REVIEW.md', '.claude/settings.json', '.github/workflows/ci.yml']) {
    assert.equal(hook('pre-edit', base(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, f), content: 'x' } })), null, f);
  }
  assert.equal(hook('pre-edit', base(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, 'src/x.js'), content: 'x' } })), null);
  assert.deepEqual(log(dir).map((e) => `${e.gate} ${e.file}`), ['rules CLAUDE.md', 'rules REVIEW.md', 'rules .claude/settings.json', 'rules .github/workflows/ci.yml']);
});

test('rules gate: nested rule files count, and a scope warning survives the log entry', () => {
  const { dir } = planRepo();
  writeFileSync(join(dir, 'CLAUDE.md'), 'a\n');
  const warn = hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, 'CLAUDE.md'), old_string: 'a', new_string: 'b' } }));
  assert.match(warn.hookSpecificOutput.additionalContext, /outside S1's Touch list/);
  for (const f of ['packages/web/CLAUDE.md', 'apps/api/.claude/settings.json', 'sub/REVIEW.md']) {
    hook('pre-edit', base(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, f), content: 'x' } }));
  }
  assert.deepEqual(log(dir).map((e) => e.file), ['CLAUDE.md', 'packages/web/CLAUDE.md', 'apps/api/.claude/settings.json', 'sub/REVIEW.md']);
});

test('switches gate: an edit that would turn jig gates off asks, even in observe mode', () => {
  const { dir } = tempRepo();
  for (const content of ['{"env":{"JIG_GATES":"observe"}}', '{"env":{"JIG_HOOKS_OFF":"all"}}']) {
    const out = hook('pre-edit', base(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, '.claude/settings.json'), content } }), { JIG_GATES: 'observe' });
    assert.equal(out?.hookSpecificOutput?.permissionDecision, 'ask', content);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /JIG_(GATES|HOOKS_OFF)/);
  }
  const edit = hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, 'CLAUDE.md'), old_string: 'x', new_string: 'export JIG_HOOKS_OFF=stop' } }));
  assert.equal(edit?.hookSpecificOutput?.permissionDecision, 'ask');
});

test('switches gate: judged on the file after the edit, decoded, and in any case', () => {
  const { dir, g } = tempRepo();
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude/settings.json'), '{"env":{"JIG_X":"1"}}\n');
  g('add', '-A'); g('commit', '-qm', 'settings');
  const asks = (input) => hook('pre-edit', base(dir, input))?.hookSpecificOutput?.permissionDecision === 'ask';
  assert.ok(asks({ tool_name: 'Edit', tool_input: { file_path: join(dir, '.claude/settings.json'), old_string: 'X"', new_string: 'GATES"' } }), 'joined with existing text');
  assert.ok(asks({ tool_name: 'Write', tool_input: { file_path: join(dir, '.claude/settings.json'), content: '{"env":{"JIG\\u005fHOOKS_OFF":"all"}}' } }), 'JSON escape');
  assert.ok(asks({ tool_name: 'Write', tool_input: { file_path: join(dir, '.CLAUDE/settings.json'), content: '{"env":{"JIG_GATES":"observe"}}' } }), 'other case');
  assert.ok(!asks({ tool_name: 'Edit', tool_input: { file_path: join(dir, '.claude/settings.json'), old_string: '"1"', new_string: '"2"' } }), 'unrelated edit');
});
