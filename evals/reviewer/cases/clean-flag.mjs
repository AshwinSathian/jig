// Control: a clean, reversible plan for a small CLI flag. Any Important
// finding on it counts as a false positive.
// test/json.test.js is written in S1 (checks first): it runs `node src/cli.js test/rows.json --json`
// and expects {"count":2,"sum":350}.
const PLAN = `# JSON output for report

Status: draft · Tier: full · Baseline: HEAD · Updated: 2026-11-25
Now: drafting.

## Outcome
\`report <file> --json\` prints the same totals as \`report <file>\`, as one JSON object.
Done when:
- C1 and C2 pass under \`jig verify\`

## Decisions
- Reuse \`totals(rows)\` from \`src/report.js\` and only change how it prints. Reason: the numbers must match the text output exactly.
- Add \`json: { type: 'boolean' }\` to the existing \`parseArgs\` options in \`src/cli.js\`, and print \`JSON.stringify(totals(rows))\` when it is set. Reason: no new dependency, and one code path computes the numbers.

## Out of scope
- Other output formats.

## Questions
- None.

## Assumptions
- Keys are the ones \`totals\` already returns (\`count\`, \`sum\`).

## Slices

### S1: --json flag [todo]
Goal: \`report <file> --json\` prints \`{"count":N,"sum":S}\` for the rows in the file and exits 0; \`report <file>\` prints the same text as before (C2 pins it).
Touch: \`src/cli.js\`, \`test/json.test.js (new)\`
Checks: C1, C2

## Log
- 2026-11-25: Drafted.
`;
const CHECKS = { version: 1, checks: [
  { id: 'C1', slice: 'S1', kind: 'e2e', cmd: 'node --test test/json.test.js', timeout_s: 30, fast: true, protects: ['test/json.test.js'] },
  // C2 runs the pinned text-output test too, so a change to `report` without --json fails it.
  { id: 'C2', slice: 'S1', kind: 'regression', cmd: 'node --test test/*.test.js', timeout_s: 60, fast: true },
] };
export default {
  id: 'clean-flag',
  set: 'control',
  plan: 'docs/plans/json/PLAN.md',
  request: 'add a --json flag to the report command',
  files: {
    'package.json': JSON.stringify({ name: 'rep', type: 'module', bin: { report: 'src/cli.js' }, scripts: { test: 'node --test test/*.test.js' } }),
    'src/report.js': 'export function totals(rows) { return { count: rows.length, sum: rows.reduce((a, r) => a + r.amount, 0) }; }\n',
    'src/cli.js': "#!/usr/bin/env node\nimport { parseArgs } from 'node:util';\nimport { readFileSync } from 'node:fs';\nimport { totals } from './report.js';\nconst { positionals } = parseArgs({ options: {}, allowPositionals: true });\nconst t = totals(JSON.parse(readFileSync(positionals[0], 'utf8')));\nconsole.log(`count ${t.count}\\nsum ${t.sum}`);\n",
    'test/rows.json': JSON.stringify([{ amount: 250 }, { amount: 100 }]),
    'test/report.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { execFileSync } from 'node:child_process';\ntest('text output is pinned', () => { assert.equal(execFileSync('node', ['src/cli.js', 'test/rows.json'], { encoding: 'utf8' }), 'count 2\\nsum 350\\n'); });\n",
    'docs/plans/json/PLAN.md': PLAN,
    'docs/plans/json/checks.json': JSON.stringify(CHECKS, null, 2),
  },
  defects: [],
};
