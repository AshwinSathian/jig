# CSV export of orders with customer names

Status: draft · Tier: brief · Baseline: 3ded234 · Updated: 2026-11-25
Now: drafted. Next: owner review (one open question).

## Outcome
`node src/cli.js export-orders > out.csv` writes a CSV of every order with its customer's name to stdout; errors go to stderr with a non-zero exit.
Done when:
- `node --test test/export-orders.test.js` passes
- `node --test test/*.test.js` passes
- `node src/cli.js export-orders` prints `id,customer_id,customer_name,total` and `1,1,C1,12.00` against the fixture db

## Decisions
- Fetch customer names in one `db.getCustomersByIds` call with de-duplicated ids, then join in memory. Reason: avoids one query per order.
- Hand-write a small RFC 4180 escaper (quote fields containing `,` `"` or newline; double inner quotes) in `src/export-orders.js`. Reason: no CSV helper exists and a new dependency is not worth ~10 lines.
- Keep the logic in `src/export-orders.js` as `ordersToCsv()`, with `src/cli.js` only dispatching. Reason: testable without spawning a process.
- Orders whose customer is not found get an empty `customer_name`; the export does not fail. Reason: one orphan should not block the whole export.
- Build the whole CSV in memory, not a stream. Reason: `db.getOrders()` returns an array already, so streaming would not save memory.

## Out of scope
- Filters, date ranges, or a `--output` flag. Redirecting stdout is the requested interface.
- Other formats (Excel, JSON) and other entities (customers export).
- Changing `src/db.js`.

## Questions
- Spreadsheet formula injection: should names starting with `=`, `+`, `-` or `@` be prefixed with `'` so Excel won't run them? Recommended: yes. It changes the name text in the CSV, but a customer-controlled name is untrusted input.

## Assumptions
- Columns: `id,customer_id,customer_name,total`, with a header row. `total` is `cents / 100` to two decimals, since the repo has no currency convention.
- Output uses `\n` line endings and ends with a trailing newline.
- Data size fits in memory (the db layer returns arrays).

## Slices

### S1: export-orders command [todo]
Goal: `export-orders` prints the CSV to stdout; the unknown-command path and usage text still work.
Touch: `src/export-orders.js (new)`, `src/cli.js`, `test/export-orders.test.js (new)`
Checks: `node --test test/*.test.js`, `node src/cli.js export-orders`
- Risk: names containing commas, quotes or newlines corrupt the CSV. Detect: test with a name like `Smith, "Jo"\nX` parsed back. Fallback: quote every field unconditionally.
- Risk: an unhandled async rejection in `cli.js` exits 0 with a partial file. Detect: test with a stubbed db that throws expects a non-zero exit. Fallback: wrap the dispatch in try/catch and set `process.exitCode = 1`.

Tests are written before the code: header and row format, escaping, the missing-customer case, a single `getCustomersByIds` call with unique ids, and the formula-injection behaviour decided in Questions.

## Log
- 2026-11-25: Plan started at 3ded234.
- 2026-11-25: Drafted as brief tier: one slice, reversible, no new dependency or public contract beyond the CSV columns.
