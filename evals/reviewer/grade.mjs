// Grading for the reviewer eval. Pure functions, so they are unit-tested
// without spending anything (test/reviewer-grade.test.mjs).

// Numbered finding lines ("1. ...") in a review.
export function findings(text) {
  return (text ?? '').split('\n').filter((l) => /^\s*\d+\.\s+\S/.test(l));
}

// Findings that count against a clean control: everything not labelled Nit
// or Pre-existing (a review without severities counts every finding).
export function important(text) {
  return findings(text).filter((l) => !/\[(nit|pre-existing)\]/i.test(l));
}

export function verdict(text) {
  return (text ?? '').match(/Verdict:\s*\**\s*(ready|fix first|rethink)/i)?.[1]?.toLowerCase() ?? null;
}

// One review of one case.
export function grade(text, c) {
  const found = c.defects.map(([label, re]) => ({ label, hit: re.test(text ?? '') }));
  return {
    found,
    recall: c.defects.length ? found.filter((f) => f.hit).length / c.defects.length : null,
    falsePositives: c.set === 'control' ? important(text).length : null,
    verdict: verdict(text),
  };
}

// Rounds until the reviewer returns ready (1-based), or null if it never did.
export function roundsToPass(verdicts) {
  const i = verdicts.findIndex((v) => v === 'ready');
  return i === -1 ? null : i + 1;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Per arm: recall on the held-out test set (tuning cases reported apart),
// false positives per control run, and rounds-to-pass.
export function summarize(results) {
  const arms = [...new Set(results.map((r) => r.arm))];
  return Object.fromEntries(arms.map((arm) => {
    const rs = results.filter((r) => r.arm === arm);
    const recall = (set) => mean(rs.filter((r) => r.set === set && r.grade.recall !== null).map((r) => r.grade.recall));
    const rounds = rs.filter((r) => r.rounds).map((r) => roundsToPass(r.rounds));
    return [arm, {
      testRecall: recall('test'),
      tuningRecall: recall('tuning'),
      controlFalsePositives: mean(rs.filter((r) => r.set === 'control').map((r) => r.grade.falsePositives)),
      roundsToPass: mean(rounds.filter((n) => n !== null)),
      neverPassed: rounds.filter((n) => n === null).length,
      costUsd: rs.reduce((a, r) => a + (r.costUsd ?? 0), 0),
      runs: rs.length,
    }];
  }));
}
