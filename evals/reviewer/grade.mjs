// Grading for the reviewer eval. Pure functions, so they are unit-tested
// without spending anything (test/reviewer-grade.test.mjs).

const ITEM = /^(#+\s*)?(\*\*)?(\d+[.)]|[-*])(\*\*)?\s+\S/;
const SECTION_END = /^\s*(\*\*)?(not checked|earlier findings|files|summary|checked\b|what holds|strengths)/i;

// List items inside the "Findings" block (any common list form). When a
// review has no Findings heading, every list item before a closing section
// counts, so an unformatted review is still scored.
export function findings(text) {
  const lines = (text ?? '').split('\n');
  const start = lines.findIndex((l) => /^\s*(#+\s*)?(\*\*)?findings\b/i.test(l));
  // A ready review with no Findings section lists what holds, not defects.
  if (start === -1 && verdict(text) === 'ready') return [];
  if (start !== -1 && /findings\W*:?\W*(none|no findings)\b/i.test(lines[start])) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    // A closing section, or a prose lead-in to another list ("I checked:").
    if (SECTION_END.test(l) || (/^[^\s#*\-\d].*:\s*$/.test(l) && !ITEM.test(l))) break;
    if (ITEM.test(l)) out.push(l);
  }
  return out;
}

// Findings that count against a clean control: everything not labelled Nit
// or Pre-existing.
// A review that tags its findings is judged by its tags: only [Important]
// counts. An untagged review counts every finding.
export function important(text) {
  const items = findings(text);
  const tagged = items.some((l) => /\[(important|nit|pre-existing)\]/i.test(l));
  return items.filter((l) => (tagged ? /\[important\]/i.test(l) : true));
}

export function verdict(text) {
  return (text ?? '').match(/Verdict:?\s*(\*\*|`)*\s*(ready|fix first|rethink)/i)?.[2]?.toLowerCase() ?? null;
}

// One review of one case. A review with neither a verdict nor a Findings
// section (an empty or crashed run) is invalid: it would otherwise score as a
// perfect control and a zero-recall miss.
export function grade(text, c) {
  const valid = Boolean(verdict(text) || /^\s*(#+\s*)?(\*\*)?findings\b/im.test(text ?? ''));
  const found = c.defects.map(([label, re]) => ({ label, hit: re.test(text ?? '') }));
  return {
    valid,
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

// Per arm: recall on the held-out test set (tuning reported apart), false
// positives per clean-control run, rounds-to-pass, a per-defect hit table and
// the control verdicts. Invalid runs are counted, not scored.
export function summarize(results) {
  const arms = [...new Set(results.map((r) => r.arm))];
  return Object.fromEntries(arms.map((arm) => {
    const all = results.filter((r) => r.arm === arm);
    const rs = all.filter((r) => r.grade.valid !== false);
    const recall = (set) => mean(rs.filter((r) => r.set === set && r.grade.recall !== null).map((r) => r.grade.recall));
    const rounds = rs.filter((r) => r.rounds).map((r) => roundsToPass(r.rounds));
    const defects = {};
    for (const r of rs) for (const f of r.grade.found ?? []) {
      const k = `${r.set} ${f.label}`;
      const [h, n] = (defects[k] ?? '0/0').split('/').map(Number);
      defects[k] = `${h + (f.hit ? 1 : 0)}/${n + 1}`;
    }
    return [arm, {
      testRecall: recall('test'),
      tuningRecall: recall('tuning'),
      controlFalsePositives: mean(rs.filter((r) => r.set === 'control').map((r) => r.grade.falsePositives)),
      controlVerdicts: rs.filter((r) => r.set === 'control').map((r) => r.grade.verdict),
      roundsToPass: mean(rounds.filter((n) => n !== null)),
      neverPassed: rounds.filter((n) => n === null).length,
      defects,
      invalid: all.length - rs.length,
      costUsd: all.reduce((a, r) => a + (r.costUsd ?? 0), 0),
      runs: all.length,
    }];
  }));
}
