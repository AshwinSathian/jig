# Move reporting from MongoDB to Postgres

Status: draft · Tier: program · Baseline: 16c5eb7 · Updated: 2026-11-25
Now: drafting. Next: owner review of the schema decision.

## Outcome
Reports read from Postgres with no user-visible change, and MongoDB is switched off for reporting.
Done when:
- Each phase plan reaches shipped (P1, P2, P3 child plans)
- `npm run reports:compare` shows zero row differences for 7 consecutive daily runs

## Decisions
- [one-way] Report rows keyed by (tenant_id, report_id, row_id). Reason: every query filters by tenant first.
- Dual-write during the move. Reason: a rollback stays a config change until phase 3.

## Out of scope
- Moving non-report collections.

## Questions
- How long may reporting be read-only during cut-over? Only the owner knows the customer tolerance.

## Assumptions
- Postgres 16 on the existing managed instance.

## Slices

### S1: Schema and dual-write [todo]
Goal: every report write lands in both stores.
Plan: `docs/plans/reports-pg-dual-write/PLAN.md`

### S2: Backfill and compare [todo]
Goal: historic rows match between stores.
Plan: `docs/plans/reports-pg-backfill/PLAN.md`

## Log
- 2026-11-25: Drafted.
