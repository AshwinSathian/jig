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
- [one-way] Add a \`notes\` table (id, customer_id, author, body, created_at) in migration \`002_notes.sql\`, with a down migration. Reason: a customer has many notes, each by a known user; a column would hold only one. Decided: owner 2026-11-25
- Reuse \`formatCurrency(cents)\` from \`src/lib/format.js\` for the totals. Reason: it already formats USD.
- Build the list with one \`db.getOrderTotalsByCustomer()\` call. Reason: a query per customer is N+1.
- POST /customers/:id/notes calls \`requireAuth(headers)\` and returns 401 without a session, 404 for an unknown customer, and 400 for an empty body or one over 2,000 characters. Any signed-in user may add a note to any customer. Reason: notes are shared team context, and only signed-in users may write them.
- Notes are returned as data, never rendered as HTML by the API. Reason: escaping belongs to the client that renders them.

## Out of scope
- Editing or deleting notes.

## Questions
- None.

## Assumptions
- Notes are plain text.

## Slices

### S1: Notes route [todo]
Goal: POST /customers/:id/notes stores the note with its author and returns 201 with the stored note; 401 without a session, 404 for an unknown customer, 400 for an empty or oversize body.
Touch: \`src/app.js\`, \`migrations/002_notes.sql (new)\`, \`migrations/002_notes.down.sql (new)\`, \`test/notes.test.js (new)\`
Checks: C1, C3

### S2: Totals in the list [todo]
Goal: GET /customers returns each customer with its total formatted by \`formatCurrency\`, built by \`listCustomers(db)\` from one \`getOrderTotalsByCustomer\` call however many customers there are.
Touch: \`src/list.js (new)\`, \`src/app.js\`, \`test/list.test.js (new)\`
Checks: C2, C4, C5

## Log
- 2026-11-25: Drafted.
`;
const FIXED_CHECKS = { version: 1, checks: [
  { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node --test test/notes.test.js', timeout_s: 30, fast: true, protects: ['test/notes.test.js'] },
  { id: 'C2', slice: 'S2', kind: 'acceptance', cmd: 'node --test test/list.test.js', timeout_s: 30, fast: true, protects: ['test/list.test.js'] },
  { id: 'C3', slice: 'S1', kind: 'regression', cmd: 'node --test test/*.test.js', timeout_s: 60, fast: true },
  { id: 'C4', slice: 'S2', kind: 'regression', cmd: 'node --test test/*.test.js', timeout_s: 60, fast: true },
  { id: 'C5', slice: 'S2', kind: 'e2e', cmd: 'node --test test/e2e.test.js', timeout_s: 60, fast: true, protects: ['test/e2e.test.js'] },
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
    'test/notes.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { handle } from '../src/app.js';\nconst alice = { authorization: 't-alice' };\ntest('notes need a session', () => { assert.equal(handle('POST', '/customers/1/notes', {}, { body: 'x' }).status, 401); });\ntest('a note is stored with its author', () => { const r = handle('POST', '/customers/1/notes', alice, { body: 'call back Monday' }); assert.equal(r.status, 201); assert.deepEqual({ author: r.body.author, body: r.body.body, customer: r.body.customer_id }, { author: 'alice', body: 'call back Monday', customer: 1 }); });\ntest('unknown customer is 404', () => { assert.equal(handle('POST', '/customers/999/notes', alice, { body: 'x' }).status, 404); });\ntest('empty and oversize bodies are 400', () => { assert.equal(handle('POST', '/customers/1/notes', alice, { body: '' }).status, 400); assert.equal(handle('POST', '/customers/1/notes', alice, { body: 'x'.repeat(2001) }).status, 400); });\n",
    'test/e2e.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { handle } from '../src/app.js';\ntest('a signed-in user adds a note, then sees totals in the list', async () => { const alice = { authorization: 't-alice' }; assert.equal(handle('POST', '/customers/1/notes', alice, { body: 'hello' }).status, 201); const r = await handle('GET', '/customers', alice); assert.equal(r.status, 200); assert.ok(Array.isArray(r.body) && r.body.every((c) => /^\\$[\\d,]+\\.\\d{2}$/.test(c.total))); });\n",
    'test/list.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { listCustomers } from '../src/list.js';\nconst fakeDb = () => { const calls = { totals: 0, perCustomer: 0 }; return { calls, async getCustomers() { return [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bo' }]; }, async getOrderTotalsByCustomer() { calls.totals++; return new Map([[1, 123456], [2, 0]]); }, async getOrdersForCustomer() { calls.perCustomer++; return []; } }; };\ntest('totals are formatted as currency', async () => { const db = fakeDb(); assert.deepEqual(await listCustomers(db), [{ id: 1, name: 'Ann', total: '$1,234.56' }, { id: 2, name: 'Bo', total: '$0.00' }]); });\ntest('one totals query, none per customer', async () => { const db = fakeDb(); await listCustomers(db); assert.deepEqual(db.calls, { totals: 1, perCustomer: 0 }); });\n",
  },
  defects: [
  ['check that cannot fail (C1)', /C1[\s\S]{0,240}?(always pass|can(no|')t fail|exit\(0\)|trivial|no-op|passes regardless|vacuous|verifies nothing|stub)|(always pass|can(no|')t fail|exit\(0\))[\s\S]{0,160}?C1/i],
  ['duplicates formatCurrency', /formatCurrency|src\/lib\/format\.js/i],
  ['unmarked one-way door (schema change)', /one-way|schema|migration[^.\n]{0,120}(irreversib|revers|rollback|gate|approv|mark)/i],
  ['new route missing auth', /(auth|requireAuth|unauthenticated|401|signed-in)[^.\n]{0,200}(notes|POST|S1|route)|(notes|POST|S1|route)[^.\n]{0,200}(auth|requireAuth|unauthenticated|401)/i],
  ['query per customer (N+1)', /N\s*\+\s*1|per[- ]customer|in a loop|one query (per|for each)|getOrderTotalsByCustomer|batch/i],
],
};
