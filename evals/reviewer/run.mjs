#!/usr/bin/env node
// Does the jig-reviewer agent find seeded plan defects that a plain review misses?
// The plan passes `jig lint`; its five defects need judgment, not format checks.
// Usage: node evals/reviewer/run.mjs [--runs 2]
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude, arms, usageOf, pool } from '../lib/claude.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Throwaway fixture repos are removed on exit; pass --keep to inspect them.
const MADE = [];
process.on('exit', () => { if (!process.argv.includes('--keep')) for (const d of MADE) rmSync(d, { recursive: true, force: true }); });
const JIG = join(HERE, '..', '..');
const runs = Number((process.argv.includes('--runs') ? process.argv[process.argv.indexOf('--runs') + 1] : '2'));

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
const CHECKS = { version: 1, checks: [
  { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "process.exit(0)"', timeout_s: 10, fast: true },
  { id: 'C2', slice: 'S2', kind: 'acceptance', cmd: 'node --test test/*.test.js', timeout_s: 60, fast: true },
] };
const FILES = {
  'package.json': JSON.stringify({ name: 'fx', type: 'module', scripts: { test: 'node --test test/*.test.js' } }),
  'src/lib/format.js': "export function formatCurrency(cents) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }\n",
  'src/app.js': "const sessions = { 't-alice': 'alice' };\nexport function requireAuth(h) { return sessions[h.authorization] ?? null; }\nexport function handle(method, path, headers = {}) {\n  if (method === 'GET' && path === '/customers') { if (!requireAuth(headers)) return { status: 401 }; return { status: 200 }; }\n  return { status: 404 };\n}\n",
  'src/db.js': 'export const db = { async getCustomers() { return []; }, async getOrdersForCustomer(id) { return []; }, async getOrderTotalsByCustomer() { return new Map(); } };\n',
  'migrations/001_customers.sql': 'CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);\n',
  'test/app.test.js': "import { test } from 'node:test';\ntest('x', () => {});\n",
  'docs/plans/notes/PLAN.md': PLAN,
  'docs/plans/notes/checks.json': JSON.stringify(CHECKS, null, 2),
};
// Seeded defects and how a review is credited with finding each one.
const DEFECTS = [
  ['check that cannot fail (C1)', /C1[\s\S]{0,240}?(always pass|can(no|')t fail|exit\(0\)|trivial|no-op|passes regardless|vacuous|verifies nothing|stub)|(always pass|can(no|')t fail|exit\(0\))[\s\S]{0,160}?C1/i],
  ['duplicates formatCurrency', /formatCurrency|src\/lib\/format\.js/i],
  ['unmarked one-way door (schema change)', /one-way|schema|migration[^.\n]{0,120}(irreversib|revers|rollback|gate|approv|mark)/i],
  ['new route missing auth', /(auth|requireAuth|unauthenticated|401|signed-in)[^.\n]{0,200}(notes|POST|S1|route)|(notes|POST|S1|route)[^.\n]{0,200}(auth|requireAuth|unauthenticated|401)/i],
  ['query per customer (N+1)', /N\s*\+\s*1|per[- ]customer|in a loop|one query (per|for each)|getOrderTotalsByCustomer|batch/i],
];

function scaffold() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jig-rev-')));
  MADE.push(dir);
  for (const [p, b] of Object.entries(FILES)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), b); }
  const g = (...a) => execFileSync('git', ['-c', 'user.email=e@e', '-c', 'user.name=e', ...a], { cwd: dir, stdio: 'ignore' });
  g('init', '-q'); g('add', '-A'); g('commit', '-qm', 'fx');
  return dir;
}

const ARMS = arms({ jigDir: JIG, superpowersDir: '' });
const VARIANTS = {
  'plain review': { flags: ARMS.none, prompt: 'Review the plan at docs/plans/notes/PLAN.md against this repository and list its defects. Do not edit files.' },
  'jig-reviewer': { flags: ARMS.jig, prompt: 'Run the jig-reviewer agent in plan mode on docs/plans/notes/PLAN.md (original request: "let signed-in users add notes to customers and show each customer\'s order total in the list"). Report its findings verbatim. Do not edit files.' },
};
const jobs = [];
for (const [name, v] of Object.entries(VARIANTS)) for (let r = 0; r < runs; r++) jobs.push({ name, v });
const results = await pool(jobs, 4, async ({ name, v }) => {
  const out = await runClaude({ cwd: scaffold(), prompt: v.prompt, armFlags: v.flags, budgetUsd: 3, timeoutMs: 15 * 60_000, extra: ['--allowedTools', 'Read,Glob,Grep,Agent,Skill,Bash(jig:*),Bash(git:*),Bash(node:*)'] });
  const text = out.result?.result ?? '';
  const found = DEFECTS.map(([label, re]) => ({ label, hit: re.test(text) }));
  console.error(`${name}: ${found.filter((f) => f.hit).length}/5  ${found.map((f) => (f.hit ? '+' : '-') + f.label).join(' | ')}  $${usageOf(out.result)?.costUsd?.toFixed(2)}`);
  return { name, found, usage: usageOf(out.result), text };
});
const outDir = join(HERE, '..', 'results'); mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `reviewer-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`), JSON.stringify(results, null, 2));
for (const name of Object.keys(VARIANTS)) {
  const rs = results.filter((r) => r.name === name);
  console.log(`${name}: ${rs.map((r) => r.found.filter((f) => f.hit).length).join(', ')} of 5 found per run`);
}
