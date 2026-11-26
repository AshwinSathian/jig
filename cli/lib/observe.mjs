// `jig observe`: what the observed gates would have asked or blocked, from
// .git/jig/observe.jsonl, so the owner can decide whether a gate enforces.
import { readJsonl } from './verify.mjs';

const day = (t) => new Date(t).toISOString().slice(0, 10);
// Tree ids and shas differ on every fire of the same reason.
const reasonKey = (r) => String(r ?? '').replace(/\b[0-9a-f]{7,40}\b/g, '<id>');

export function observeSummary(root, { top = 5 } = {}) {
  const events = readJsonl(root, 'observe.jsonl').filter((e) => typeof e.t === 'number');
  if (!events.length) return 'jig observe: no events in .git/jig/observe.jsonl (gates log there when observed: JIG_GATES=observe, and `commit` by default).';
  const ts = events.map((e) => e.t);
  const count = (key) => [...events.reduce((m, e) => m.set(key(e), (m.get(key(e)) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  const byGate = count((e) => `${e.gate}\0${e.decision}`);
  const reasons = count((e) => `${e.gate}\0${reasonKey(e.reason)}`).slice(0, top);
  const w = Math.max(...byGate.map(([k]) => k.split('\0')[0].length));
  return [
    `jig observe: ${events.length} events, ${day(Math.min(...ts))} to ${day(Math.max(...ts))}`,
    '',
    'By gate and decision:',
    ...byGate.map(([k, n]) => { const [g, d] = k.split('\0'); return `  ${g.padEnd(w)}  ${d.padEnd(5)}  ${n}`; }),
    '',
    'Top reasons:',
    ...reasons.map(([k, n]) => { const [g, r] = k.split('\0'); return `  ${String(n).padStart(3)}  ${g.padEnd(w)}  ${r.length > 160 ? `${r.slice(0, 159)}…` : r}`; }),
  ].join('\n');
}
