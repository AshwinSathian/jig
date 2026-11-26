// S10: learning from outcomes. `jig review --propose` turns recorded outcomes,
// reverts and fix-forwards into proposals for the owner. It never writes
// REVIEW.md, and the reviewer honours `Suppress:` entries read from the base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { planRepo, CLI } from './helpers.mjs';
import { recordReview, recordOutcome, reviewBrief, proposals } from '../cli/lib/review.mjs';

const sha = (dir, ref = 'HEAD') => execFileSync('git', ['rev-parse', ref], { cwd: dir, encoding: 'utf8' }).trim();
const F = (o = {}) => ({ severity: 'Nit', file: 'src/a.js', line: 1, class: 'naming', title: 'rename x', ...o });

// Records a review of the working tree as it is, with these findings.
function review(dir, findings, verdict = 'fix first', base = null) {
  const b = reviewBrief(dir, base ? { base } : {});
  const r = recordReview(dir, { base: b.base, head: b.head, tree: b.tree, verdict, findings });
  assert.ok(!r.error, r.error);
  return r.record;
}
const change = (dir, g, file, text, msg) => { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), text); g('add', '-A'); g('commit', '-qm', msg); };

test('a class marked wrong or didnt-matter on two findings is proposed for suppression, with its review ids', () => {
  const { dir } = planRepo();
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  const r1 = review(dir, [F({ title: 'rename x' }), F({ class: 'missing-auth', severity: 'Important', confidence: 'Likely', title: 'no auth check' })]);
  const r2 = review(dir, [F({ title: 'rename y' }), F({ class: 'missing-auth', severity: 'Important', confidence: 'Likely', title: 'no auth check on y' }), F({ class: 'perf', title: 'slow loop' })]);
  recordOutcome(dir, r1.findings[0].id, 'wrong');
  recordOutcome(dir, r2.findings[0].id, 'didnt-matter');
  recordOutcome(dir, r1.findings[1].id, 'wrong');
  recordOutcome(dir, r2.findings[1].id, 'wrong');
  recordOutcome(dir, r2.findings[2].id, 'wrong');
  const p = proposals(dir);
  assert.deepEqual(p.suppress.map((s) => s.entry), [`- Suppress: naming · Source: reviews ${r1.id}, ${r2.id}`]);
  assert.ok(p.held.some((h) => h.class === 'missing-auth' && /security/.test(h.why)), 'a security class is never proposed for suppression');
  assert.ok(!p.suppress.some((s) => s.class === 'perf'), 'one wrong outcome is not a pattern');
});

test('the latest outcome counts, and a class fixed more often than it was wrong is not proposed', () => {
  const { dir } = planRepo();
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  const r = review(dir, [F({ title: 'a' }), F({ title: 'b' }), F({ title: 'c' }), F({ title: 'd' }), F({ title: 'e' })]);
  const [a, b, c, d, e] = r.findings.map((f) => f.id);
  recordOutcome(dir, a, 'wrong'); recordOutcome(dir, a, 'fixed');
  recordOutcome(dir, b, 'wrong');
  assert.deepEqual(proposals(dir).suppress, [], 'a was re-marked fixed, so only one wrong is left');
  recordOutcome(dir, c, 'wrong'); recordOutcome(dir, d, 'fixed'); recordOutcome(dir, e, 'fixed');
  assert.deepEqual(proposals(dir).suppress, [], 'two wrong against three fixed');
});

test('misses the owner names become REVIEW.md candidates, ready once they have happened twice', () => {
  const { dir } = planRepo();
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  const r1 = review(dir, []);
  assert.match(recordOutcome(dir, r1.id, 'missed').error, /--file/, 'a miss needs the file and what was missed');
  assert.match(recordOutcome(dir, 'deadbeef', 'missed', { file: 'src/a.js', note: 'x' }).error, /no review deadbeef/);
  assert.ok(!recordOutcome(dir, r1.id, 'missed', { file: 'src/api/users.js', note: 'a new route without an auth check' }).error);
  let c = proposals(dir).entries.find((e) => e.kind === 'missed');
  assert.equal(c.count, 1);
  assert.equal(c.ready, false, 'once is not yet a pattern (guard skill: twice)');
  const r2 = review(dir, []);
  recordOutcome(dir, r2.id, 'missed', { file: 'src/api/orders.js', note: 'a new route without an auth check' });
  c = proposals(dir).entries.find((e) => e.kind === 'missed');
  assert.equal(c.count, 2);
  assert.equal(c.ready, true);
  assert.equal(c.entry, `- When: \`src/api/\` · Check: a new route without an auth check · Source: reviews ${r1.id}, ${r2.id} (missed)`);
});

test('a revert or a fix-forward of reviewed code is a candidate naming the review', () => {
  const { dir, g } = planRepo();
  const start = sha(dir);
  change(dir, g, 'src/b.js', 'export const b = 1;\n', 'add b');
  const bad = sha(dir);
  const r = review(dir, [], 'ready', start);
  g('revert', '--no-edit', bad);
  const rev = sha(dir);
  change(dir, g, 'src/c.js', 'export const c = 1;\n', 'add c');
  const r2 = review(dir, [], 'ready', rev);
  change(dir, g, 'src/c.js', 'export const c = 2;\n', 'fix: c was off by one');
  const fix = sha(dir);
  const { entries } = proposals(dir);
  const reverted = entries.find((e) => e.kind === 'revert');
  assert.ok(reverted, JSON.stringify(entries));
  assert.deepEqual(reverted.files, ['src/b.js']);
  assert.match(reverted.source, new RegExp(`revert ${rev.slice(0, 7)} of ${bad.slice(0, 7)}, reviewed ready in ${r.id}`));
  const fixed = entries.find((e) => e.kind === 'fix-forward');
  assert.ok(fixed, JSON.stringify(entries));
  assert.deepEqual(fixed.files, ['src/c.js']);
  assert.match(fixed.source, new RegExp(`${fix.slice(0, 7)} fixed .* reviewed ready in ${r2.id}`));
});

test('--propose never writes REVIEW.md, and prints the proposals', () => {
  const { dir } = planRepo();
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  const r1 = review(dir, [F({ title: 'a' })]); const r2 = review(dir, [F({ title: 'b' })]);
  recordOutcome(dir, r1.findings[0].id, 'wrong'); recordOutcome(dir, r2.findings[0].id, 'wrong');
  const run = (...a) => spawnSync('node', [CLI, 'review', ...a], { cwd: dir, encoding: 'utf8' });
  let out = run('--propose');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /- Suppress: naming · Source: reviews/);
  assert.match(out.stdout, /REVIEW\.md is yours: jig never writes it/);
  assert.ok(!existsSync(join(dir, 'REVIEW.md')));
  writeFileSync(join(dir, 'REVIEW.md'), '# Review\n');
  out = run('--propose', '--json');
  assert.equal(JSON.parse(out.stdout).suppress.length, 1);
  assert.equal(readFileSync(join(dir, 'REVIEW.md'), 'utf8'), '# Review\n');
  out = run('--outcome', r1.id, 'missed', '--file', 'src/a.js', '--note', 'off by one');
  assert.equal(out.status, 0, out.stderr);
});

test('Suppress entries come from REVIEW.md at the plan Baseline, only for style classes, and a REVIEW.md edit is a tamper signal', () => {
  const { dir, g, planPath } = planRepo();
  change(dir, g, 'REVIEW.md', '- Suppress: naming · Source: reviews a1b2c3d4, e5f6a7b8\n- Suppress: missing-auth · Source: x\n', 'suppress');
  const later = sha(dir);
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  assert.deepEqual(reviewBrief(dir, { base: later }).reviewMd.suppress, [], 'committed after the Baseline, so a slice commit could have written it');
  writeFileSync(planPath, readFileSync(planPath, 'utf8').replace(/Baseline: \w+/, `Baseline: ${later}`));
  g('add', '-A'); g('commit', '-qm', 'rebaseline');
  const start = sha(dir);
  writeFileSync(join(dir, 'REVIEW.md'), '- Suppress: naming · Source: x\n- Suppress: perf · Source: me\n');
  const b = reviewBrief(dir, { base: start });
  assert.deepEqual(b.reviewMd.suppress, [{ class: 'naming', source: 'reviews a1b2c3d4, e5f6a7b8' }], 'from the Baseline; a security class is dropped');
  assert.ok(b.tamper.some((t) => t.signal === 'rules-edited' && t.file === 'REVIEW.md'));
});

test('security and correctness classes are never proposed, a miss counts distinct reviews, and --propose with --outcome is refused', () => {
  const { dir } = planRepo();
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  const r1 = review(dir, [F({ class: 'string-built-query', title: 'q1' })]); const r2 = review(dir, [F({ class: 'string-built-query', title: 'q2' })]);
  recordOutcome(dir, r1.findings[0].id, 'wrong'); recordOutcome(dir, r2.findings[0].id, 'wrong');
  const p = proposals(dir);
  assert.deepEqual(p.suppress, []);
  assert.ok(p.held.some((h) => h.class === 'string-built-query'));
  recordOutcome(dir, r1.id, 'missed', { file: 'src/a.js', note: 'x' }); recordOutcome(dir, r1.id, 'missed', { file: 'src/a.js', note: 'x' });
  assert.equal(proposals(dir).entries.find((e) => e.kind === 'missed').ready, false, 'one review recorded twice is still once');
  const out = spawnSync('node', [CLI, 'review', '--propose', '--outcome', r1.id, 'missed', '--file', 'a', '--note', 'n'], { cwd: dir, encoding: 'utf8' });
  assert.equal(out.status, 2);
});

test('committing the reviewed tree as fix: is not a fix-forward, and a reverted merge does not crash', () => {
  const { dir, g } = planRepo();
  const start = sha(dir);
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 5;\n');
  review(dir, [], 'ready', start);
  g('add', '-A'); g('commit', '-qm', 'fix(a): set a to 5');
  assert.deepEqual(proposals(dir).entries.filter((e) => e.kind === 'fix-forward'), [], 'the reviewed work itself');
  g('checkout', '-qb', 'side'); change(dir, g, 'src/m.js', 'export const m = 1;\n', 'm');
  g('checkout', '-q', '-'); g('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  const merge = sha(dir);
  review(dir, [], 'ready', start);
  g('revert', '--no-edit', '-m', '1', merge);
  const e = proposals(dir).entries.find((x) => x.kind === 'revert');
  assert.ok(e, 'the revert of a reviewed merge');
  assert.deepEqual(e.files, ['src/m.js']);
});
