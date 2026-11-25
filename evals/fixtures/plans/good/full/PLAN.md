# CSV export for reports

Status: building · Tier: full · Baseline: 16c5eb7 · Updated: 2026-11-25
Now: S2 in progress; S1 done.

## Outcome
Users download the filtered report as a streamed CSV, for reports up to 100k rows.
Done when:
- C1, C2 and C3 pass under `jig verify`
- `node scripts/export-load.mjs 100000` finishes under 30 s (C4)

## Decisions
- [one-way] Stream from the server instead of building the file in the browser. Reason: 100k rows don't fit in browser memory. Decided: owner 2026-11-25
- Reuse `csvStringify` in `src/lib/csv.ts`. Reason: it already handles quoting.

## Out of scope
- Excel output. "Export" could be read to include it.

## Questions
- None.

## Assumptions
- 100k rows is the ceiling, from the ticket.

## Slices

### S1: Endpoint streams CSV [done]
Goal: POST /api/reports/export returns text/csv for the given filters.
Touch: `cli/lib/plan.mjs`, `src/api/reports/export.ts (new)`
Checks: C1, C2
- Risk: cursor paging skips rows at page edges. Detect: C2 compares row counts. Fallback: keyset paging on `id`.

### S2: Export button [doing]
Goal: the toolbar button downloads the CSV for the current filters.
Touch: `cli/lib/lint.mjs`
Checks: C3, C4

## Log
- 2026-11-25: Plan approved by owner.
- 2026-11-25 14:02: jig verify S1: C1 pass; C2 pass
