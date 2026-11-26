// The `commit` gate: a `git commit` whose tree has no current evidence or
// review record, and whose message has no `Verified: none (<reason>)`.
// It ships observed: it logs to observe.jsonl and prints nothing, unless
// JIG_GATES=enforce:commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { hook, planRepo, base } from './helpers.mjs';
import { tempRepo } from './verify.test.mjs';
import { verifyPlan } from '../cli/lib/verify.mjs';
import { reviewBrief, recordReview } from '../cli/lib/review.mjs';
import { newPlan } from '../cli/lib/scaffold.mjs';

const gitDir = (dir) => execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir, encoding: 'utf8' }).trim();
const logged = (dir) => {
  const p = join(gitDir(dir), 'jig', 'observe.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse).filter((e) => e.gate === 'commit') : [];
};
let n = 0;
const bash = (dir, command, env = {}, extra = {}) => hook('pre-bash', base(dir, { session_id: extra.session ?? `c${n++}`, tool_name: 'Bash', tool_input: { command } }), env);
const ENFORCE = { JIG_GATES: 'enforce:commit' };

function edited() {
  const r = planRepo();
  writeFileSync(join(r.dir, 'src/a.js'), 'export const a = 2;\n');
  return r;
}

test('observed by default: an unverified commit is logged, and nothing is printed', () => {
  const { dir } = edited();
  assert.equal(bash(dir, 'git commit -qam "change a"'), null);
  const [e] = logged(dir);
  assert.equal(e.decision, 'ask');
  assert.equal(e.v, 1);
  assert.match(e.reason, /no current passing evidence or review/);
});

test('enforce:commit asks instead, and never allows', () => {
  const { dir } = edited();
  const out = bash(dir, 'git commit -qam "change a"', ENFORCE);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.equal(logged(dir).length, 0);
});

test('current evidence or a current review record lets the commit through', () => {
  const r = edited();
  verifyPlan(r.dir, r.planPath, { slice: 'S1' });
  assert.equal(bash(r.dir, 'git commit -qam x', ENFORCE), null, 'evidence');
  const s = edited();
  const b = reviewBrief(s.dir, {});
  recordReview(s.dir, { base: b.base, head: b.head, tree: b.tree, verdict: 'ready', findings: [] });
  assert.equal(bash(s.dir, 'git commit -qam x', ENFORCE), null, 'review');
});

test('only a ready review is cover: fix first or rethink at this tree is not', () => {
  for (const verdict of ['fix first', 'rethink']) {
    const s = edited();
    const b = reviewBrief(s.dir, {});
    recordReview(s.dir, { base: b.base, head: b.head, tree: b.tree, verdict, findings: [{ severity: 'Important', confidence: 'Confirmed', file: 'src/a.js', line: 1, class: 'x', title: 'y' }] });
    assert.ok(bash(s.dir, 'git commit -qam x', ENFORCE), verdict);
  }
});

test('observed, every fire is logged: the two-per-session cap applies only when it enforces', () => {
  const { dir } = edited();
  for (let i = 0; i < 4; i++) bash(dir, 'git commit -qam x', {}, { session: 'obs' });
  assert.equal(logged(dir).length, 4);
});

test('evidence for an earlier tree does not count', () => {
  const r = edited();
  verifyPlan(r.dir, r.planPath, { slice: 'S1' });
  writeFileSync(join(r.dir, 'src/a.js'), 'export const a = 3;\n');
  assert.ok(bash(r.dir, 'git commit -qam x', ENFORCE));
});

test('Verified: none (<reason>) in the message passes, in -m, a heredoc or a -F file', () => {
  const { dir } = edited();
  assert.equal(bash(dir, 'git commit -qam "docs only\n\nVerified: none (docs only)"', ENFORCE), null, '-m');
  assert.equal(bash(dir, "git commit -qa -F- <<'EOF'\nwip\n\nVerified: none (wip)\nEOF", ENFORCE), null, 'heredoc');
  const msg = join(dir, '..', `msg-${Date.now()}.txt`);
  writeFileSync(msg, 'wip\n\nVerified: none (spike)\n');
  assert.equal(bash(dir, `git commit -qa -F ${msg}`, ENFORCE), null, '-F file');
  writeFileSync(msg, 'wip\n');
  assert.ok(bash(dir, `git commit -qa --file=${msg}`, ENFORCE), '--file without the line');
  assert.ok(bash(dir, 'git commit -qam "Verified: none"', ENFORCE), 'no reason');
});

test('a commit with no message flag (an editor) is only logged as message unknown, never asked, and uses no fire', () => {
  const { dir } = edited();
  for (const c of ['git commit -a', 'git commit --amend --no-edit', 'git commit -a']) assert.equal(bash(dir, c, ENFORCE, { session: 'ed' }), null, c);
  assert.equal(logged(dir).length, 3);
  assert.match(logged(dir)[0].reason, /message unknown/);
  assert.ok(bash(dir, 'git commit -qam x', ENFORCE, { session: 'ed' }), 'the two fires are still there');
});

test('failing evidence for this tree is not cover', () => {
  const r = edited();
  writeFileSync(join(r.dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "process.exit(1)"', timeout_s: 10, fast: true }] }));
  verifyPlan(r.dir, r.planPath, { slice: 'S1' });
  assert.ok(bash(r.dir, 'git commit -qam x', ENFORCE));
});

test('Verified: none outside the commit itself does not count', () => {
  const { dir } = edited();
  assert.ok(bash(dir, 'echo "Verified: none (x)" >/dev/null; git commit -qam wip', ENFORCE));
  assert.ok(bash(dir, 'git commit -qam wip && echo "Verified: none (x)"', ENFORCE));
});

test('commits behind prefixes, paths, options and subshells are found', () => {
  const { dir } = edited();
  for (const c of ['git --git-dir .git commit -qm x', 'git -c "user.name=a b" commit -qm x', 'sudo git commit -qm x', 'env A=1 git commit -qm x', 'command git commit -qm x', 'time git commit -qm x', '/usr/bin/git commit -qm x', '\\git commit -qm x', '(git commit -qm x)', 'bash -c "git commit -qm x"', 'git -C . commit -qm x']) {
    assert.ok(bash(dir, c, ENFORCE), c);
  }
});

test('a quoted separator, a dry run or a heredoc line is not a commit', () => {
  const { dir } = edited();
  for (const c of ['echo "a; git commit -m x"', 'git commit --dry-run -qam x', "cat <<'EOF' > notes.txt\ngit commit -m x\nEOF"]) assert.equal(bash(dir, c, ENFORCE), null, c);
});

test('a quoted -F path with a space is read', () => {
  const { dir } = edited();
  const msg = join(dir, '..', `my msg ${Date.now()}.txt`);
  writeFileSync(msg, 'x\n\nVerified: none (spike)\n');
  assert.equal(bash(dir, `git commit -qa -F "${msg}"`, ENFORCE), null);
});

test('after two would-be blocks in one session, the next commit passes', () => {
  const { dir } = edited();
  for (let i = 0; i < 2; i++) assert.ok(bash(dir, 'git commit -qam x', ENFORCE, { session: 'same' }));
  assert.equal(bash(dir, 'git commit -qam x', ENFORCE, { session: 'same' }), null);
  assert.ok(bash(dir, 'git commit -qam x', ENFORCE, { session: 'other' }), 'per session');
});

test('only a real git commit fires', () => {
  const { dir } = edited();
  for (const c of ['git commit-tree HEAD^{tree}', 'git log --grep commit', 'echo "git commit -m x"', 'git status && git diff', 'npm run commit']) {
    assert.equal(bash(dir, c, ENFORCE), null, c);
  }
  assert.ok(bash(dir, 'git add -A && git commit -qm x', ENFORCE));
  assert.ok(bash(dir, 'GIT_AUTHOR_NAME=x git -c user.name=y commit -qm x', ENFORCE));
});

test('a repo where jig has no active plan and no reviews is left alone', () => {
  const { dir } = tempRepo();
  writeFileSync(join(dir, 'README.md'), 'changed\n');
  assert.equal(bash(dir, 'git commit -qam x', ENFORCE), null);
  assert.equal(logged(dir).length, 0);
});

test('one Blocked plan does not exempt commits while another plan is being built', () => {
  const r = edited();
  appendFileSync(r.planPath, '- 2026-11-26: Blocked: C1 needs a service this sandbox lacks\n');
  const [p2] = newPlan(r.dir, 'other', { tier: 'full', title: 'Other' });
  writeFileSync(p2, readFileSync(p2, 'utf8').replace('Status: draft', 'Status: building').replace('### S1: <title> [todo]', '### S1: Other [doing]').replace(/Touch: .*/, 'Touch: `src/`'));
  writeFileSync(join(r.dir, 'docs/plans/other/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'O1', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 10, fast: true }] }));
  assert.ok(bash(r.dir, 'git commit -qam x', ENFORCE));
});

test('a Blocked plan with a doing slice lets the commit through; one with no doing slice does not', () => {
  const r = edited();
  appendFileSync(r.planPath, '- 2026-11-26: Blocked: C1 needs a service this sandbox lacks\n');
  assert.equal(bash(r.dir, 'git commit -qam x', ENFORCE), null);
  writeFileSync(r.planPath, readFileSync(r.planPath, 'utf8').replace('[doing]', '[todo]'));
  assert.ok(bash(r.dir, 'git commit -qam x', ENFORCE));
});

test('JIG_GATES=observe and observe:commit log it too; observe:install leaves it observed by default', () => {
  for (const v of ['observe', 'observe:commit', 'observe:install']) {
    const { dir } = edited();
    assert.equal(bash(dir, 'git commit -qam x', { JIG_GATES: v }), null, v);
    assert.equal(logged(dir).length, 1, v);
  }
});

test('an install in the same command still asks', () => {
  const { dir } = edited();
  const out = bash(dir, 'npm i left-pad && git commit -qam x');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /left-pad/);
});

test('a rule-file edit that sets JIG_GATES=enforce:commit asks, as any gate switch does', () => {
  const { dir } = planRepo();
  const out = hook('pre-edit', base(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, 'CLAUDE.md'), content: 'Set JIG_GATES=enforce:commit\n' } }), { JIG_GATES: 'observe' });
  assert.equal(out?.hookSpecificOutput?.permissionDecision, 'ask');
});
