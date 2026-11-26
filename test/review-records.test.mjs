// Review records in .git/jig/reviews.jsonl: validated, tree-tied, with
// stable finding ids and outcomes recorded later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { URL } from 'node:url';
import { planRepo, hook, base, CLI } from './helpers.mjs';
import { recordReview, recordOutcome, findingId, reviewBrief, reviews } from '../cli/lib/review.mjs';
import { verifyPlan } from '../cli/lib/verify.mjs';

const gitDir = (dir) => execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir, encoding: 'utf8' }).trim();
// What the skill copies from the brief into its findings JSON.
const from = (dir, o = {}) => { const b = reviewBrief(dir, o); return { base: b.base, head: b.head, tree: b.tree }; };
const F = (o = {}) => ({ severity: 'Important', confidence: 'Confirmed', file: 'src/a.js', line: 1, class: 'swallowed-error', title: 'catch drops the parse error', ...o });

test('a record carries v, tree, head, base, verdict and findings with ids', () => {
  const { dir } = planRepo();
  const r = recordReview(dir, { ...from(dir), verdict: 'fix first', findings: [F(), F({ severity: 'Nit', confidence: undefined, class: 'naming', title: 'rename x' })], dropped: 1 });
  assert.ok(!r.error, r.error);
  const [rec] = reviews(dir);
  assert.equal(rec.v, 1);
  assert.match(rec.tree, /^[0-9a-f]{40}$/);
  assert.match(rec.head, /^[0-9a-f]{40}$/);
  assert.match(rec.base, /^[0-9a-f]{40}$/);
  assert.equal(rec.verdict, 'fix first');
  assert.equal(rec.dropped, 1);
  assert.equal(rec.findings.length, 2);
  for (const f of rec.findings) assert.match(f.id, /^[0-9a-f]{8}$/);
  assert.match(r.trailer, /^Reviewed: fix first, 2 findings \(tree [0-9a-f]{7}\)$/);
});

test('a finding id is the same across reviews, and ignores case, spacing and line', () => {
  assert.equal(findingId(F()), findingId(F({ title: '  Catch drops the PARSE error ', line: 40 })));
  assert.notEqual(findingId(F()), findingId(F({ file: 'src/b.js' })));
  assert.notEqual(findingId(F()), findingId(F({ class: 'injection' })));
  const { dir } = planRepo();
  recordReview(dir, { ...from(dir), verdict: 'fix first', findings: [F()] });
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 7;\n');
  recordReview(dir, { ...from(dir), verdict: 'fix first', findings: [F({ line: 3 })] });
  const [a, b] = reviews(dir);
  assert.equal(a.findings[0].id, b.findings[0].id);
  assert.notEqual(a.tree, b.tree);
});

test('invalid input is rejected with the reason, and nothing is written', () => {
  const { dir } = planRepo();
  const bad = [
    [{ verdict: 'looks good', findings: [] }, /verdict/],
    [{ verdict: 'ready', findings: [F({ severity: 'Blocker' })] }, /severity/],
    [{ verdict: 'ready', findings: [F({ confidence: 'Sure' })] }, /confidence/],
    [{ verdict: 'ready', findings: [F({ confidence: undefined })] }, /confidence/],
    [{ verdict: 'ready', findings: [F({ file: '' })] }, /file/],
    [{ verdict: 'ready', findings: [F({ class: undefined })] }, /class/],
    [{ verdict: 'ready', findings: [F({ line: 'ten' })] }, /line/],
    [{ verdict: 'ready' }, /findings/],
  ];
  for (const [input, re] of bad) assert.match(recordReview(dir, { ...from(dir), ...input }).error ?? '', re, JSON.stringify(input));
  assert.equal(reviews(dir).length, 0);
});

test('a record must name the base, head and tree from the brief, and is refused when the tree moved since', () => {
  const { dir } = planRepo();
  const brief = from(dir);
  for (const k of ['base', 'head', 'tree']) {
    const input = { ...brief, verdict: 'ready', findings: [] };
    delete input[k];
    assert.match(recordReview(dir, input).error ?? '', new RegExp(k), k);
  }
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 11;\n');
  assert.match(recordReview(dir, { ...brief, verdict: 'ready', findings: [] }).error ?? '', /tree .* changed/);
  assert.equal(reviews(dir).length, 0);
});

test('a PR review whose head is not checked out records tree null and the PR head', () => {
  const { dir, g } = planRepo();
  const main = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
  g('switch', '-qc', 'pr'); writeFileSync(join(dir, 'src/p.js'), 'p\n'); g('add', '-A'); g('commit', '-qm', 'pr');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  g('switch', '-q', main);
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const r = recordReview(dir, { base, head, tree: null, verdict: 'ready', findings: [] });
  assert.ok(!r.error, r.error);
  const rec = reviews(dir).pop();
  assert.equal(rec.tree, null);
  assert.equal(rec.head, head);
  assert.match(r.trailer, /tree none/);
});

test('two findings in one review with the same id are refused', () => {
  const { dir } = planRepo();
  assert.match(recordReview(dir, { ...from(dir), verdict: 'fix first', findings: [F({ line: 1 }), F({ line: 9 })] }).error ?? '', /same id/);
});

test('"Findings: none" is a valid review', () => {
  const { dir } = planRepo();
  const r = recordReview(dir, { ...from(dir), verdict: 'ready', findings: [] });
  assert.match(r.trailer, /Reviewed: ready, 0 findings/);
});

test('the brief shows the review as current only for its own tree', () => {
  const { dir, planPath } = planRepo();
  verifyPlan(dir, planPath, { slice: 'S1' });
  recordReview(dir, { ...from(dir), verdict: 'ready', findings: [] });
  assert.equal(reviewBrief(dir, {}).review.current, true);
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 8;\n');
  assert.equal(reviewBrief(dir, {}).review.current, false);
});

test('an outcome is recorded against a known finding id, and an unknown id or outcome is refused', () => {
  const { dir } = planRepo();
  recordReview(dir, { ...from(dir), verdict: 'fix first', findings: [F()] });
  const id = reviews(dir)[0].findings[0].id;
  assert.ok(!recordOutcome(dir, id, 'wrong').error);
  const last = reviews(dir).pop();
  assert.equal(last.kind, 'outcome');
  assert.equal(last.finding, id);
  assert.equal(last.outcome, 'wrong');
  assert.equal(last.v, 1);
  assert.match(recordOutcome(dir, 'ffffffff', 'fixed').error, /no finding/);
  assert.match(recordOutcome(dir, id, 'meh').error, /outcome/);
  // An outcome line is not a review: the brief still shows the review.
  assert.equal(reviewBrief(dir, {}).review.verdict, 'fix first');
});

test('jig review --record reads a file and prints the trailer; --outcome records one', () => {
  const { dir } = planRepo();
  const f = join(dir, '..', `findings-${Date.now()}.json`);
  writeFileSync(f, JSON.stringify({ ...from(dir), verdict: 'fix first', findings: [F()] }));
  const r = spawnSync('node', [CLI, 'review', '--record', f], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Reviewed: fix first, 1 findings \(tree [0-9a-f]{7}\)/);
  const id = reviews(dir)[0].findings[0].id;
  const o = spawnSync('node', [CLI, 'review', '--outcome', id, 'intentional'], { cwd: dir, encoding: 'utf8' });
  assert.equal(o.status, 0, o.stderr);
  const bad = spawnSync('node', [CLI, 'review', '--record', join(dir, 'nope.json')], { cwd: dir, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  const noBase = spawnSync('node', [CLI, 'review', '--record', f, '--base'], { cwd: dir, encoding: 'utf8' });
  assert.equal(noBase.status, 2, noBase.stdout);
});

test('SessionStart keeps the transcript path in the session state', () => {
  const { dir } = planRepo();
  hook('session-start', base(dir, { transcript_path: '/tmp/t/abc.jsonl', hook_event_name: 'SessionStart' }));
  const st = JSON.parse(readFileSync(join(gitDir(dir), 'jig', 'sessions', 's1.json'), 'utf8'));
  assert.equal(st.transcript, '/tmp/t/abc.jsonl');
});

test('evidence and observe records carry a version field', () => {
  const { dir, planPath } = planRepo();
  verifyPlan(dir, planPath, { slice: 'S1' });
  const ev = readFileSync(join(gitDir(dir), 'jig', 'evidence.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(ev.pop().v, 1);
  hook('pre-edit', base(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, 'test/a.accept.test.js'), old_string: '// spec', new_string: '// x' } }), { JIG_GATES: 'observe' });
  const p = join(gitDir(dir), 'jig', 'observe.jsonl');
  assert.ok(existsSync(p));
  assert.equal(JSON.parse(readFileSync(p, 'utf8').trim().split('\n').pop()).v, 1);
});

test('the schema doc names every field jig writes to each file', () => {
  const doc = readFileSync(new URL('../docs/evidence-schema.md', import.meta.url), 'utf8');
  const { dir, planPath } = planRepo();
  verifyPlan(dir, planPath, { slice: 'S1' });
  recordReview(dir, { ...from(dir), verdict: 'fix first', findings: [F()], dropped: 0 });
  const ev = JSON.parse(readFileSync(join(gitDir(dir), 'jig', 'evidence.jsonl'), 'utf8').trim().split('\n').pop());
  const rv = reviews(dir).pop();
  for (const k of [...Object.keys(ev), ...Object.keys(rv), ...Object.keys(rv.findings[0])]) assert.ok(doc.includes(`\`${k}\``), `docs/evidence-schema.md does not mention \`${k}\``);
});
