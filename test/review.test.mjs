// `jig review`: base resolution, the brief, and what it reads from the base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync, chmodSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempRepo } from './verify.test.mjs';
import { planRepo, CLI } from './helpers.mjs';
import { reviewBrief, diffFiles } from '../cli/lib/review.mjs';
import { verifyPlan } from '../cli/lib/verify.mjs';

const made = [];
process.on('exit', () => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const sha = (dir, ref = 'HEAD') => execFileSync('git', ['rev-parse', ref], { cwd: dir, encoding: 'utf8' }).trim();
const commit = (g, msg) => { g('add', '-A'); g('commit', '-qm', msg); };

test('--base wins over an active plan, and an unknown ref is an error', () => {
  const { dir, g } = planRepo();
  const first = sha(dir);
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n'); commit(g, 'two');
  const b = reviewBrief(dir, { base: first });
  assert.equal(b.base, first);
  assert.equal(b.how, 'flag');
  assert.match(reviewBrief(dir, { base: 'no-such-ref' }).error, /no-such-ref/);
});

test('active plan: the base is the newest commit whose Verified trailer names another slice', () => {
  const { dir, g, planPath } = planRepo();
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n'); commit(g, 'slice zero\n\nVerified: S0 C0 pass (tree 1234567)');
  const s0 = sha(dir);
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 3;\n'); commit(g, 'wip on S1\n\nVerified: S1 C1 pass (tree 7654321)');
  writeFileSync(join(dir, 'src/b.js'), 'export const b = 1;\n'); commit(g, 'more S1\n\nVerified: none (wip)');
  const b = reviewBrief(dir, {});
  assert.equal(b.how, 'slice');
  assert.equal(b.base, s0);
  assert.equal(b.plan, 'docs/plans/demo/PLAN.md');
  assert.ok(readFileSync(planPath, 'utf8'));
});

test('active plan with no earlier slice commit: the base is the plan Baseline', () => {
  const { dir, g, planPath } = planRepo();
  const baseline = readFileSync(planPath, 'utf8').match(/Baseline: ([0-9a-f]+)/)[1];
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n'); commit(g, 'S1 work');
  const b = reviewBrief(dir, {});
  assert.equal(b.how, 'slice');
  assert.ok(b.base.startsWith(baseline), `${b.base} vs ${baseline}`);
});

test('no plan, on a feature branch: the merge-base with the default branch', () => {
  const { dir, g } = tempRepo();
  g('branch', '-M', 'main');
  const fork = sha(dir);
  g('switch', '-qc', 'feature');
  mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src/x.js'), 'x\n'); commit(g, 'feature');
  g('switch', '-q', 'main'); writeFileSync(join(dir, 'other.txt'), 'o\n'); commit(g, 'main moves'); g('switch', '-q', 'feature');
  const b = reviewBrief(dir, {});
  assert.equal(b.how, 'merge-base');
  assert.equal(b.base, fork);
  assert.deepEqual(b.files.map((x) => x.path), ['src/x.js']);
});

test('no plan, on the default branch with uncommitted work: HEAD, and untracked files count', () => {
  const { dir, g } = tempRepo();
  g('branch', '-M', 'main');
  writeFileSync(join(dir, 'README.md'), 'changed\n');
  writeFileSync(join(dir, 'new.md'), 'hello\nworld\n');
  const b = reviewBrief(dir, {});
  assert.equal(b.how, 'head');
  assert.equal(b.base, sha(dir));
  assert.deepEqual(b.files.map((x) => x.path).sort(), ['README.md', 'new.md']);
  assert.equal(b.files.find((x) => x.path === 'new.md').adds, 2);
  assert.equal(b.stats.files, 2);
});

test('--pr asks gh for the base and head, and names the author', () => {
  const { dir, g } = tempRepo();
  g('branch', '-M', 'main');
  const baseSha = sha(dir);
  g('switch', '-qc', 'pr'); writeFileSync(join(dir, 'p.js'), 'p\n'); commit(g, 'pr');
  const headSha = sha(dir);
  g('switch', '-q', 'main');
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'jig-gh-'))); made.push(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho '{"baseRefOid":"${baseSha}","headRefOid":"${headSha}","author":{"login":"someone"},"number":7}'\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  const old = process.env.PATH; process.env.PATH = `${bin}:${old}`;
  try {
    const b = reviewBrief(dir, { pr: '7' });
    assert.equal(b.how, 'pr');
    assert.equal(b.base, baseSha);
    assert.equal(b.head, headSha);
    assert.equal(b.pr.author, 'someone');
    assert.deepEqual(b.files.map((x) => x.path), ['p.js']);
    assert.equal(b.tree, null, 'the PR head is not checked out, so the working tree is not its tree');
    assert.equal(b.evidence?.current ?? false, false);
  } finally { process.env.PATH = old; }
});

test('--pr whose base commit is not local is an error, not an empty diff', () => {
  const { dir } = tempRepo();
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'jig-gh-'))); made.push(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho '{"baseRefOid":"${'b'.repeat(40)}","baseRefName":"main","headRefOid":"${sha(dir)}","author":{"login":"x"},"number":4}'\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  const old = process.env.PATH; process.env.PATH = `${bin}:${old}`;
  try { assert.match(reviewBrief(dir, { pr: '4' }).error, /base .* isn't in this clone/); } finally { process.env.PATH = old; }
});

test('--pr with unreadable gh output is an error', () => {
  const { dir } = tempRepo();
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'jig-gh-'))); made.push(bin);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho not json\n');
  chmodSync(join(bin, 'gh'), 0o755);
  const old = process.env.PATH; process.env.PATH = `${bin}:${old}`;
  try { assert.match(reviewBrief(dir, { pr: '5' }).error, /gh/); } finally { process.env.PATH = old; }
});

test('--pr whose head commit is not local says how to fetch it', () => {
  const { dir } = tempRepo();
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'jig-gh-'))); made.push(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho '{"baseRefOid":"${sha(dir)}","headRefOid":"${'a'.repeat(40)}","author":{"login":"x"},"number":3}'\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  const old = process.env.PATH; process.env.PATH = `${bin}:${old}`;
  try { assert.match(reviewBrief(dir, { pr: '3' }).error, /gh pr checkout 3/); } finally { process.env.PATH = old; }
});

test('a deleted file keeps its own removed lines, and a neighbour gets none of them', () => {
  const { dir, g } = tempRepo();
  writeFileSync(join(dir, 'package.json'), '{\n  "name":"x"\n}\n');
  writeFileSync(join(dir, 'zold.js'), 'line1\nline2\n');
  commit(g, 'two files');
  const first = sha(dir);
  writeFileSync(join(dir, 'package.json'), '{\n  "name":"y"\n}\n');
  rmSync(join(dir, 'zold.js'));
  const files = diffFiles(dir, first);
  const pkg = files.find((x) => x.path === 'package.json');
  const old = files.find((x) => x.path === 'zold.js');
  assert.deepEqual(pkg.added, ['  "name":"y"']);
  assert.deepEqual(pkg.removed, ['  "name":"x"']);
  assert.deepEqual(old.removed, ['line1', 'line2']);
  assert.deepEqual(old.added, []);
});

test('a path with spaces or non-ASCII characters keeps its name and lines', () => {
  const { dir, g } = tempRepo();
  const first = sha(dir);
  writeFileSync(join(dir, 'a b.js'), 'one\n');
  writeFileSync(join(dir, 'café.js'), 'two\n');
  commit(g, 'odd names');
  const files = diffFiles(dir, first);
  assert.deepEqual(files.map((x) => x.path).sort(), ['a b.js', 'café.js']);
  assert.deepEqual(files.find((x) => x.path === 'café.js').added, ['two']);
  assert.deepEqual(files.find((x) => x.path === 'a b.js').added, ['one']);
});

test('diff lines are read whatever the user sets for diff prefixes', () => {
  const { dir, g } = tempRepo();
  const first = sha(dir);
  writeFileSync(join(dir, 'c.js'), 'three\n');
  commit(g, 'c');
  for (const [k, v] of [['diff.noprefix', 'true'], ['diff.mnemonicPrefix', 'true']]) {
    g('config', k, v);
    assert.deepEqual(diffFiles(dir, first).find((x) => x.path === 'c.js').added, ['three'], k);
    g('config', '--unset', k);
  }
});

test('REVIEW.md glob triggers match paths', () => {
  const { dir, g } = tempRepo();
  g('branch', '-M', 'main');
  writeFileSync(join(dir, 'REVIEW.md'), '- When: `src/**/*.js` · Check: a · Source: one\n- When: `src/*.css` · Check: b · Source: two\n');
  commit(g, 'rm');
  g('switch', '-qc', 'f');
  mkdirSync(join(dir, 'src/deep'), { recursive: true });
  writeFileSync(join(dir, 'src/deep/c.js'), 'x\n');
  commit(g, 'c');
  const b = reviewBrief(dir, {});
  assert.deepEqual(b.reviewMd.matched.map((e) => e.source), ['one']);
});

test('--base still carries the intent of the single plan with a doing slice', () => {
  const { dir, g } = planRepo();
  const first = sha(dir);
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 5;\n'); commit(g, 'x');
  const b = reviewBrief(dir, { base: first });
  assert.equal(b.how, 'flag');
  assert.ok(b.intent?.slice, JSON.stringify(b.intent));
});

test('an untracked symlink or FIFO is listed but never read', () => {
  const { dir } = tempRepo();
  spawnSync('ln', ['-s', '/etc/hosts', join(dir, 'link')]);
  spawnSync('mkfifo', [join(dir, 'pipe')]);
  const files = diffFiles(dir, sha(dir));
  assert.deepEqual(files.find((x) => x.path === 'link')?.added, []);
  assert.deepEqual(files.find((x) => x.path === 'pipe')?.added ?? [], []);
});

test('a slice Baseline that is not a commit, or no default branch, is named in fallback', () => {
  const { dir, g, planPath } = planRepo();
  g('branch', '-M', 'work'); // no main or master: git's default branch name varies by machine
  writeFileSync(planPath, readFileSync(planPath, 'utf8').replace(/Baseline: [0-9a-f]+/, 'Baseline: deadbee'));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 5;\n');
  const b = reviewBrief(dir, {});
  assert.equal(b.how, 'head');
  assert.ok(b.fallback.some((s) => /deadbee/.test(s)), JSON.stringify(b.fallback));
  assert.ok(b.fallback.some((s) => /default branch/.test(s)), JSON.stringify(b.fallback));
});

test('a remote-only default branch (a CI checkout) still gives the merge-base', () => {
  const { dir, g } = tempRepo();
  const fork = sha(dir);
  g('update-ref', 'refs/remotes/origin/main', fork);
  g('switch', '-qc', 'feature');
  writeFileSync(join(dir, 'x.js'), 'x\n'); commit(g, 'feature');
  const cur = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
  for (const b of ['main', 'master']) if (b !== cur) spawnSync('git', ['branch', '-D', b], { cwd: dir });
  const b = reviewBrief(dir, {});
  assert.equal(b.how, 'merge-base');
  assert.equal(b.base, fork);
});

test('nothing to review: a clean tree on the default branch is an error that names the fallbacks', () => {
  const { dir, g } = tempRepo();
  g('branch', '-M', 'main');
  assert.match(reviewBrief(dir, {}).error, /nothing to review/);
});

test('the brief carries the owner-approved intent and the slice lines, never the Log or Now line', () => {
  const { dir, g, planPath } = planRepo();
  let text = readFileSync(planPath, 'utf8');
  text = text.replace('Now: drafting.', 'Now: S1 doing; builder says all is fine.')
    .replace(/## Decisions\n[\s\S]*?\n## Out of scope/, '## Decisions\n- [one-way] Keep ids stable. Reason: callers store them. Decided: owner 2026-11-25\n- Use a Map. Reason: faster.\n\n## Out of scope')
    .replace(/## Log\n/, '## Log\n- 2026-11-25: builder narrative that must stay out of phase 1.\n');
  writeFileSync(planPath, text); g('add', '-A'); g('commit', '-qm', 'plan text');
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 4;\n');
  const { intent } = reviewBrief(dir, {});
  const all = JSON.stringify(intent);
  assert.match(all, /Keep ids stable/);
  assert.ok(!/Use a Map/.test(all), 'only owner-decided Decisions');
  assert.ok(!/builder narrative/.test(all) && !/builder says/.test(all), 'no Log or Now line');
  assert.ok(intent.outcome.length && Array.isArray(intent.outOfScope));
  assert.match(intent.slice.touch, /src\/a\.js/);
});

test('the brief has the tree fingerprint, stats, triggers and checks.json presence', () => {
  const { dir, g } = planRepo();
  const first = sha(dir);
  mkdirSync(join(dir, 'src/auth'));
  writeFileSync(join(dir, 'src/auth/login.js'), 'export const login = 1;\n'); commit(g, 'auth');
  const b = reviewBrief(dir, { base: first });
  assert.match(b.tree, /^[0-9a-f]{40}$/);
  assert.equal(b.stats.files, 1);
  assert.equal(b.stats.adds, 1);
  assert.ok(b.triggers.some((t) => t.id === 'security'));
  assert.equal(b.checks, true);
});

test('evidence is current until the tree changes', () => {
  const { dir, planPath } = planRepo();
  verifyPlan(dir, planPath, { slice: 'S1' });
  let b = reviewBrief(dir, {});
  assert.equal(b.evidence.current, true);
  assert.equal(b.evidence.pass, true);
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 9;\n');
  b = reviewBrief(dir, {});
  assert.equal(b.evidence.current, false);
  assert.equal(b.review, null);
});

test('REVIEW.md comes from the base: a matching entry is listed, and a working-tree edit is ignored', () => {
  const { dir, g } = tempRepo();
  g('branch', '-M', 'main');
  writeFileSync(join(dir, 'REVIEW.md'), [
    '# Review',
    '- When: a new route under `src/api/` · Check: it calls requireAuth · Source: PR 12',
    '- When: a change to `src/billing/` · Check: amounts are integers · Source: incident 3',
    '- When: anything that feels risky · Check: ask the owner · Source: PR 9',
  ].join('\n') + '\n');
  commit(g, 'review md');
  g('switch', '-qc', 'feature');
  mkdirSync(join(dir, 'src/api'), { recursive: true });
  writeFileSync(join(dir, 'src/api/users.js'), 'export const r = 1;\n');
  writeFileSync(join(dir, 'REVIEW.md'), '- When: `src/` · Check: nothing to see · Source: me\n');
  commit(g, 'route');
  const b = reviewBrief(dir, {});
  assert.deepEqual(b.reviewMd.matched.map((e) => e.source), ['PR 12']);
  assert.deepEqual(b.reviewMd.judge.map((e) => e.source), ['PR 9']);
  assert.ok(!JSON.stringify(b.reviewMd).includes('nothing to see'));
});

test('jig review --json prints the brief, and the text form leads with base and tree', () => {
  const { dir } = planRepo();
  const j = spawnSync('node', [CLI, 'review', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(j.status, 0, j.stderr);
  const b = JSON.parse(j.stdout);
  assert.ok(b.base && b.tree && Array.isArray(b.triggers));
  const t = spawnSync('node', [CLI, 'review'], { cwd: dir, encoding: 'utf8' });
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout.split('\n')[0], /^Base [0-9a-f]{7}/);
  assert.match(t.stdout, /tree [0-9a-f]{7}/);
});

test('--blind leaves out the earlier review and the evidence; the full brief has the round and earlier findings', async () => {
  const { recordReview } = await import('../cli/lib/review.mjs');
  const { dir, planPath } = planRepo();
  verifyPlan(dir, planPath, { slice: 'S1' });
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 3;\n');
  let b = reviewBrief(dir, {});
  assert.equal(b.round, 1);
  recordReview(dir, { base: b.base, head: b.head, tree: b.tree, verdict: 'fix first', findings: [{ severity: 'Important', confidence: 'Confirmed', file: 'src/a.js', line: 1, class: 'off-by-one', title: 'a is 3, spec says 2' }] });
  b = reviewBrief(dir, {});
  assert.equal(b.round, 2);
  assert.equal(b.review.head, b.head);
  assert.equal(b.review.findings[0].title, 'a is 3, spec says 2');
  const blind = reviewBrief(dir, { blind: true });
  assert.ok(!('review' in blind) && !('evidence' in blind), Object.keys(blind).join(','));
  assert.equal(blind.round, 2);
  const cli = spawnSync('node', [CLI, 'review', '--json', '--blind'], { cwd: dir, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.ok(!('review' in JSON.parse(cli.stdout)));
});

test('the gate lists D1 commands as a list', () => {
  const { dir, g } = tempRepo();
  g('branch', '-M', 'main');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', check: 'tsc' } }));
  const b = reviewBrief(dir, {});
  assert.equal(b.gate.D1.level, 'ok');
  assert.deepEqual(b.gate.D1.commands, ['npm run check', 'npm test']);
});

test('jig review exits 2 with a message for a bad --base', () => {
  const { dir } = planRepo();
  const r = spawnSync('node', [CLI, 'review', '--base', 'nope'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /nope/);
});

test('jig review exits 2 for --base or --pr with no value, and for a --pr that is not a number', () => {
  const { dir } = planRepo();
  for (const args of [['--base'], ['--pr'], ['--pr', '--json'], ['--pr', '-x']]) {
    const r = spawnSync('node', [CLI, 'review', ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}`);
  }
});
