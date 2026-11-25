// Tuning case: the original seeded plan. Prompts and graders may be tuned on it.
const PLAN = `# Customer notes with totals

Status: draft · Tier: full · Baseline: HEAD · Updated: 2026-11-25
Now: drafting.

## Outcome
Signed-in users can add notes to a customer and see each customer's order total in the list.
Done when:
- C1 and C2 pass under \`jig verify\`

## Decisions
- Add a \`notes\` column to the customers table with a new migration. Reason: notes belong to the customer.
- Add \`src/lib/money.js\` with \`formatMoney(cents)\` for the totals. Reason: totals need currency formatting.
- Build the list by fetching each customer's orders with \`db.getOrdersForCustomer(id)\` in a loop. Reason: simplest code.

## Out of scope
- Editing or deleting notes.

## Questions
- None.

## Assumptions
- Notes are plain text.

## Slices

### S1: Notes route [todo]
Goal: POST /customers/:id/notes stores a note.
Touch: \`src/app.js\`, \`migrations/002_notes.sql (new)\`
Checks: C1

### S2: Totals in the list [todo]
Goal: the customer list shows each total.
Touch: \`src/list.js (new)\`, \`src/lib/money.js (new)\`
Checks: C2

## Log
- 2026-11-25: Drafted.
`;
const FIXED = `# Customer notes with totals

Status: draft · Tier: full · Baseline: HEAD · Updated: 2026-11-25
Now: drafting.

## Outcome
Signed-in users can add plain-text notes to a customer, and the customer list shows each customer's order total as currency.
Done when:
- C1 and C2 pass under \`jig verify\`

## Decisions
- [one-way] Add a \`notes\` table (id, customer_id, body, created_at) in migration \`002_notes.sql\`, with a down migration. Reason: a customer has many notes; a column would hold only one. Decided: owner 2026-11-25
- Reuse \`formatCurrency(cents)\` from \`src/lib/format.js\` for the totals. Reason: it already formats USD.
- Build the list with one \`db.getOrderTotalsByCustomer()\` call. Reason: a query per customer is N+1.
- POST /customers/:id/notes calls \`requireAuth(headers)\` and returns 401 without a session. Reason: only signed-in users may add notes.

## Out of scope
- Editing or deleting notes.

## Questions
- None.

## Assumptions
- Notes are plain text, at most 2,000 characters.

## Slices

### S1: Notes route [todo]
Goal: POST /customers/:id/notes stores a note for a signed-in user and returns 201; without a session it returns 401.
Touch: \`src/app.js\`, \`migrations/002_notes.sql (new)\`, \`test/notes.test.js (new)\`
Checks: C1

### S2: Totals in the list [todo]
Goal: GET /customers returns each customer with its total formatted by \`formatCurrency\`, from one totals query.
Touch: \`src/list.js (new)\`, \`test/list.test.js (new)\`
Checks: C2

## Log
- 2026-11-25: Drafted.
`;
const FIXED_CHECKS = { version: 1, checks: [
  { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node --test test/notes.test.js', timeout_s: 30, fast: true, protects: ['test/notes.test.js'] },
  { id: 'C2', slice: 'S2', kind: 'acceptance', cmd: 'node --test test/list.test.js', timeout_s: 30, fast: true, protects: ['test/list.test.js'] },
] };
const CHECKS = { version: 1, checks: [
  { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "process.exit(0)"', timeout_s: 10, fast: true },
  { id: 'C2', slice: 'S2', kind: 'acceptance', cmd: 'node --test test/*.test.js', timeout_s: 60, fast: true },
] };
export default {
  id: 'notes',
  set: 'tuning',
  plan: 'docs/plans/notes/PLAN.md',
  request: 'let signed-in users add notes to customers and show each customer\'s order total in the list',
  files: {
  'package.json': JSON.stringify({ name: 'fx', type: 'module', scripts: { test: 'node --test test/*.test.js' } }),
  'src/lib/format.js': "export function formatCurrency(cents) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }\n",
  'src/app.js': "const sessions = { 't-alice': 'alice' };\nexport function requireAuth(h) { return sessions[h.authorization] ?? null; }\nexport function handle(method, path, headers = {}) {\n  if (method === 'GET' && path === '/customers') { if (!requireAuth(headers)) return { status: 401 }; return { status: 200 }; }\n  return { status: 404 };\n}\n",
  'src/db.js': 'export const db = { async getCustomers() { return []; }, async getOrdersForCustomer(id) { return []; }, async getOrderTotalsByCustomer() { return new Map(); } };\n',
  'migrations/001_customers.sql': 'CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);\n',
  'test/app.test.js': "import { test } from 'node:test';\ntest('x', () => {});\n",
  'docs/plans/notes/PLAN.md': PLAN,
  'docs/plans/notes/checks.json': JSON.stringify(CHECKS, null, 2),
},
  // The plan after a builder fixes the five seeded defects, for rounds-to-pass.
  fixed: {
    'docs/plans/notes/PLAN.md': FIXED,
    'docs/plans/notes/checks.json': JSON.stringify(FIXED_CHECKS, null, 2),
    'test/notes.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { handle } from '../src/app.js';\ntest('notes need a session', () => { assert.equal(handle('POST', '/customers/1/notes').status, 401); });\ntest('a signed-in user adds a note', () => { assert.equal(handle('POST', '/customers/1/notes', { authorization: 't-alice' }).status, 201); });\n",
    'test/list.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { listCustomers } from '../src/list.js';\ntest('totals are formatted', async () => { assert.deepEqual(await listCustomers(), []); });\n",
  },
  defects: [
  ['check that cannot fail (C1)', /C1[\s\S]{0,240}?(always pass|can(no|')t fail|exit\(0\)|trivial|no-op|passes regardless|vacuous|verifies nothing|stub)|(always pass|can(no|')t fail|exit\(0\))[\s\S]{0,160}?C1/i],
  ['duplicates formatCurrency', /formatCurrency|src\/lib\/format\.js/i],
  ['unmarked one-way door (schema change)', /one-way|schema|migration[^.\n]{0,120}(irreversib|revers|rollback|gate|approv|mark)/i],
  ['new route missing auth', /(auth|requireAuth|unauthenticated|401|signed-in)[^.\n]{0,200}(notes|POST|S1|route)|(notes|POST|S1|route)[^.\n]{0,200}(auth|requireAuth|unauthenticated|401)/i],
  ['query per customer (N+1)', /N\s*\+\s*1|per[- ]customer|in a loop|one query (per|for each)|getOrderTotalsByCustomer|batch/i],
],
};
