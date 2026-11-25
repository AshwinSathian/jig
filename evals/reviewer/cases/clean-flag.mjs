// Control: a clean, reversible plan for a small CLI flag. Any Important
// finding on it counts as a false positive.
const PLAN = `# JSON output for report

Status: draft · Tier: full · Baseline: HEAD · Updated: 2026-11-25
Now: drafting.

## Outcome
\`report --json\` prints the same totals as \`report\`, as one JSON object.
Done when:
- C1 and C2 pass under \`jig verify\`

## Decisions
- Reuse \`totals(rows)\` from \`src/report.js\` and only change how it prints. Reason: the numbers must match the text output exactly.
- Parse the flag with the existing \`parseArgs\` call in \`src/cli.js\`. Reason: no new dependency.

## Out of scope
- Other output formats.

## Questions
- None.

## Assumptions
- Keys are the text output's labels in camelCase.

## Slices

### S1: --json flag [todo]
Goal: \`report --json\` prints \`{"count":N,"sum":S}\` and exits 0; \`report\` is unchanged.
Touch: \`src/cli.js\`, \`test/json.test.js (new)\`
Checks: C1, C2

## Log
- 2026-11-25: Drafted.
`;
const CHECKS = { version: 1, checks: [
  { id: 'C1', slice: 'S1', kind: 'e2e', cmd: 'node --test test/json.test.js', timeout_s: 30, fast: true, protects: ['test/json.test.js'] },
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
    'src/cli.js': "#!/usr/bin/env node\nimport { parseArgs } from 'node:util';\nimport { totals } from './report.js';\nconst { values } = parseArgs({ options: {} });\nconst t = totals([]);\nconsole.log(`count ${t.count}\\nsum ${t.sum}`);\n",
    'test/report.test.js': "import { test } from 'node:test';\ntest('x', () => {});\n",
    'docs/plans/json/PLAN.md': PLAN,
    'docs/plans/json/checks.json': JSON.stringify(CHECKS, null, 2),
  },
  defects: [],
};
