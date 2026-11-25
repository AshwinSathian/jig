import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, important, verdict, roundsToPass, summarize } from '../evals/reviewer/grade.mjs';
import invoices from '../evals/reviewer/cases/invoices.mjs';
import control from '../evals/reviewer/cases/clean-flag.mjs';
import notes from '../evals/reviewer/cases/notes.mjs';

const review = (lines, v = 'fix first') => `Verdict: ${v}\nFindings:\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\nNot checked: none`;

test('cases: one tuning, one held-out test and one control, and only the control is clean', () => {
  assert.deepEqual([notes.set, invoices.set, control.set], ['tuning', 'test', 'control']);
  assert.equal(control.defects.length, 0);
  assert.ok(invoices.defects.length >= 5 && !invoices.fixed, 'the held-out case has no fixed plan to tune');
  assert.ok(notes.fixed, 'rounds-to-pass runs on the tuning case');
});

test('recall counts each seeded defect a review names', () => {
  const r = grade(review([
    '[Important] `toCsvRow` duplicates `toCsv` in src/lib/csv.js. Evidence: src/lib/csv.js:1. Fix: reuse it.',
    '[Important] Loading every invoice in memory; use db.invoicePage. Evidence: src/db.js. Fix: stream pages.',
  ]), invoices);
  assert.equal(r.recall, 2 / 5);
  assert.equal(r.falsePositives, null, 'only controls count false positives');
  assert.equal(r.verdict, 'fix first');
});

test('a clean control counts Important findings as false positives, not Nits or Pre-existing', () => {
  const text = review(['[Important] The flag is not documented.', '[Nit] Name the test file json-flag.', '[Pre-existing] totals() ignores refunds.'], 'ready');
  assert.equal(important(text).length, 1);
  assert.equal(grade(text, control).falsePositives, 1);
  assert.equal(grade('Verdict: ready\nFindings: none', control).falsePositives, 0);
});

test('verdict and rounds-to-pass', () => {
  assert.equal(verdict('**Verdict: rethink**'), 'rethink');
  assert.equal(roundsToPass(['fix first', 'fix first', 'ready']), 3);
  assert.equal(roundsToPass(['fix first', 'rethink']), null);
});

test('summary keeps the test set apart from tuning, per arm', () => {
  const s = summarize([
    { arm: 'fresh', set: 'test', grade: { recall: 0.8 }, rounds: ['fix first', 'ready'], costUsd: 0.2 },
    { arm: 'fresh', set: 'tuning', grade: { recall: 1 }, costUsd: 0.1 },
    { arm: 'fresh', set: 'control', grade: { recall: null, falsePositives: 1 }, costUsd: 0.1 },
    { arm: 'self', set: 'test', grade: { recall: 0.4 }, costUsd: 0.1 },
  ]);
  assert.equal(s.fresh.testRecall, 0.8);
  assert.equal(s.fresh.tuningRecall, 1);
  assert.equal(s.fresh.controlFalsePositives, 1);
  assert.equal(s.fresh.roundsToPass, 2);
  assert.equal(s.self.testRecall, 0.4);
  assert.ok(Math.abs(s.fresh.costUsd - 0.4) < 1e-9);
});

// From the adversarial review before the paid run.
test('findings are counted only inside the Findings block, in any common list form', () => {
  const fmt = (lines) => `Verdict: fix first\nFindings:\n${lines}\nNot checked:\n1. the migration\n2. CI`;
  for (const l of ['1. [Important] x', '### 1. [Important] x', '**1.** [Important] x', '1) [Important] x', '- [Important] x', '* [Important] x']) {
    assert.equal(grade(fmt(l), control).falsePositives, 1, l);
  }
  assert.equal(grade('Verdict: ready\nFindings: none\nNot checked:\n1. a\n2. b', control).falsePositives, 0, 'Not checked list is not findings');
  assert.equal(grade('Verdict: ready\nFindings:\n1. [Nit] a\nEarlier findings:\n1. fixed', control).falsePositives, 0);
});

test('verdict tolerates backticks and bold', () => {
  assert.equal(verdict('Verdict: `ready`'), 'ready');
  assert.equal(verdict('**Verdict:** fix first'), 'fix first');
});

test('a failed run is invalid, not a perfect control or a zero-recall miss', () => {
  assert.equal(grade('', control).valid, false);
  assert.equal(grade('Here is my review.', control).valid, false, 'no verdict and no findings section');
  assert.equal(grade('Verdict: ready\nFindings: none', control).valid, true);
  const s = summarize([
    { arm: 'fresh', set: 'control', grade: { valid: false, recall: null, falsePositives: 0, found: [] } },
    { arm: 'fresh', set: 'control', grade: { valid: true, recall: null, falsePositives: 2, found: [] } },
  ]);
  assert.equal(s.fresh.controlFalsePositives, 2, 'invalid runs are excluded');
  assert.equal(s.fresh.invalid, 1);
});

test('summary has a per-defect hit table and control verdicts', () => {
  const s = summarize([
    { arm: 'self', set: 'test', grade: { valid: true, recall: 0.5, found: [{ label: 'a', hit: true }, { label: 'b', hit: false }] } },
    { arm: 'self', set: 'test', grade: { valid: true, recall: 1, found: [{ label: 'a', hit: true }, { label: 'b', hit: true }] } },
    { arm: 'self', set: 'control', grade: { valid: true, recall: null, falsePositives: 0, verdict: 'ready', found: [] } },
  ]);
  assert.deepEqual(s.self.defects, { 'test a': '2/2', 'test b': '1/2' });
  assert.deepEqual(s.self.controlVerdicts, ['ready']);
});
