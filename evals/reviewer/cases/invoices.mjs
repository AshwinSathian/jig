// Held-out test case: never used to tune prompts or graders (its graders were
// frozen before any review of it was read). Passes `jig lint`; its five
// defects need judgment. Recall only: rounds-to-pass is measured on the
// tuning case, because writing a 'fixed' plan here would tune on the test set.
const plan = (body) => `# Invoice CSV export

Status: draft · Tier: full · Baseline: HEAD · Updated: 2026-11-25
Now: drafting.

## Outcome
Account admins can download their account's invoices as CSV from GET /invoices/export.
Done when:
- C1 and C2 pass under \`jig verify\`

## Decisions
${body.decisions}

## Out of scope
- Excel output.

## Questions
- None.

## Assumptions
- An account has at most 50k invoices.

## Slices

### S1: Export route [todo]
Goal: ${body.goal}
Touch: \`src/app.js\`, \`src/export.js (new)\`${body.touch ?? ''}
Checks: C1, C2

## Log
- 2026-11-25: Drafted.
`;
const BAD = {
  decisions: [
    '- Write `src/export.js` with a `toCsvRow(fields)` helper that quotes values. Reason: invoices need CSV escaping.',
    '- Load all of the account\'s invoices with `db.allInvoices(accountId)` and build the file in memory. Reason: simplest code.',
    '- Use the `csv-stringify-fast` package for the header row. Reason: saves a few lines.',
    '- Also add PDF export at GET /invoices/export.pdf, since it shares the query. Reason: little extra work.',
  ].join('\n'),
  goal: 'GET /invoices/export returns text/csv with every invoice for the account in the path.',
};
const CHECKS = { version: 1, checks: [
  { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node --test test/export.test.js', timeout_s: 30, fast: true, protects: ['test/export.test.js'] },
  { id: 'C2', slice: 'S1', kind: 'regression', cmd: 'node --test test/*.test.js', timeout_s: 60, fast: true },
] };
const repo = {
  'package.json': JSON.stringify({ name: 'inv', type: 'module', scripts: { test: 'node --test test/*.test.js' } }),
  'src/lib/csv.js': "export function toCsv(rows) { return rows.map((r) => r.map((v) => `\"${String(v).replace(/\"/g, '\"\"')}\"`).join(',')).join('\\n'); }\n",
  'src/auth.js': "const sessions = { 't-admin': { user: 'ann', account: 'a1', role: 'admin' } };\nexport function requireAdmin(h) { const s = sessions[h.authorization]; return s?.role === 'admin' ? s : null; }\n",
  'src/db.js': 'export const db = { async allInvoices(accountId) { return []; }, async invoicePage(accountId, cursor) { return { rows: [], next: null }; } };\n',
  'src/app.js': "import { requireAdmin } from './auth.js';\nexport function handle(method, path, headers = {}) {\n  if (method === 'GET' && path === '/invoices') { if (!requireAdmin(headers)) return { status: 403 }; return { status: 200 }; }\n  return { status: 404 };\n}\n",
  'test/app.test.js': "import { test } from 'node:test';\ntest('x', () => {});\n",
  'test/export.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { handle } from '../src/app.js';\ntest('export needs an admin', () => { assert.equal(handle('GET', '/invoices/export').status, 403); });\ntest('export returns CSV for an admin', () => { const r = handle('GET', '/invoices/export', { authorization: 't-admin' }); assert.equal(r.status, 200); assert.match(r.type, /text\\/csv/); });\n",
  'docs/plans/invoices/checks.json': JSON.stringify(CHECKS, null, 2),
};
export default {
  id: 'invoices',
  set: 'test',
  plan: 'docs/plans/invoices/PLAN.md',
  request: 'let account admins download their invoices as CSV',
  files: { ...repo, 'docs/plans/invoices/PLAN.md': plan(BAD) },
  defects: [
    ['duplicates toCsv', /toCsv|src\/lib\/csv\.js/i],
    ['whole result set in memory', /in memory|invoicePage|pag(e|ing|inat)|stream|50k|unbounded/i],
    ['new dependency not a one-way door', /csv-stringify-fast|new (runtime )?dependenc|one-way[^.\n]{0,80}(package|dependenc)/i],
    ['PDF export not requested', /PDF[^.\n]{0,160}(scope|not (asked|requested)|wasn't asked|creep)|(scope|not (asked|requested)|creep)[^.\n]{0,160}PDF/i],
    ['account from the path, no admin check', /(requireAdmin|authori[sz]|403|IDOR|another account|other account|account in the path|path param)/i],
  ],
};
