# Plan Examples

These examples show what a completed plan looks like at each scale. Use them as quality benchmarks.

---

## Example: Micro Plan

**Request**: "Add rate limiting to the /api/export endpoint"

```markdown
# Plan: Add Rate Limiting to /api/export
> Status: PROPOSED
> Scale: Micro
> Created: 2026-07-06

## Goal
The /api/export endpoint is rate-limited to 10 requests/minute per user. Requests exceeding this return HTTP 429 with a Retry-After header.

## Tasks
- [ ] Add rate limiter middleware in `src/middleware/rateLimit.ts` — AC: `RateLimitMiddleware` class exists, enforces 10 req/min per `userId`, uses Redis for state
- [ ] Wire middleware to `/api/export` route in `src/routes/export.ts` — AC: All export routes use the middleware, confirmed via route inspection
- [ ] Return proper 429 response with `Retry-After` header — AC: `curl` over limit returns 429 with `Retry-After: 60`
- [ ] Add unit test for rate limiter — AC: `src/middleware/rateLimit.test.ts` has ≥ 3 tests covering allow, deny, and reset behavior

## Non-Goals
- Not applying rate limiting to other endpoints in this change
- Not implementing per-IP rate limiting (only per-user)

## Notes
Redis already in use for sessions — use existing `redis` client instance from `src/lib/redis.ts`.
```

---

## Example: Standard Plan

**Request**: "Build a CSV export feature for the reports page"

```markdown
# Plan: CSV Export for Reports
> Status: PROPOSED
> Scale: Standard
> Estimated effort: 3 days
> Created: 2026-07-06

## Goal
Users can download any report as a CSV file. The export reflects the current filter/sort state, handles reports up to 100k rows, and completes within 30 seconds for typical usage.

## Background
Reports currently only render in the browser. Finance users export data manually via copy-paste. This causes data accuracy issues and is blocking enterprise deal #4312.

## Non-Goals
- Not supporting Excel (.xlsx) format in this iteration
- Not adding scheduled/automated exports (that is follow-up work)
- Not exporting charts or visualizations — data rows only

## Technical Design

### Overview
Export is a server-side operation: the client sends current filter state → server queries DB and streams CSV → browser downloads the file. We avoid loading 100k rows into the client.

### Key Components
| Component | File / Path | Change Type | Notes |
|-----------|-------------|-------------|-------|
| Export endpoint | `src/api/reports/export.ts` | New | POST, accepts filter params, streams CSV |
| CSV generator | `src/lib/csvExport.ts` | New | Wraps `csv-stringify` stream |
| Export button | `src/components/Reports/ExportButton.tsx` | New | Triggers download, shows progress |
| Report query | `src/db/queries/reports.ts` | Modify | Add cursor-based pagination for export |

### API Design
```
POST /api/reports/export
Body: { reportId: string, filters: ReportFilters, columns: string[] }
Response: text/csv stream, filename in Content-Disposition header
```

### Key Decisions
- **Server-side streaming** over client-side generation → rationale: client can't handle 100k rows; avoids memory spike
- **csv-stringify** over hand-rolled CSV → rationale: handles escaping, encoding edge cases correctly
- **Cursor pagination** for DB query → rationale: OFFSET pagination degrades at high row counts

## Alternatives Considered
| Option | Pros | Cons | Why Rejected |
|--------|------|------|--------------|
| Client-side export (papaparse) | No server work | Memory limit, timeout risk at scale | Rejected — 100k row requirement |
| Background job + email link | Handles huge exports | Complex, new infrastructure, latency | Rejected — 100k fits in 30s streaming |

## Work Breakdown

### Phase 1: Backend (~1d)
- [ ] Install `csv-stringify` dependency — AC: package in `package.json`, types resolve
- [ ] Create `src/lib/csvExport.ts` streaming utility — AC: unit test passes for 1k row fixture
- [ ] Add cursor pagination to `src/db/queries/reports.ts` — AC: query fetches rows in 1k batches, no OFFSET
- [ ] Create `POST /api/reports/export` endpoint — AC: `curl` request returns valid CSV with correct headers

### Phase 2: Frontend (~1d)
- [ ] Add ExportButton component — AC: renders in Reports toolbar, disabled when no rows
- [ ] Wire button to export API with current filters — AC: clicking downloads a file matching screen data
- [ ] Show loading/progress state — AC: button shows "Exporting…" and disables during request
- [ ] Handle error state — AC: toast shown on network error or 4xx/5xx

### Phase 3: Polish & Tests (~0.5d)
- [ ] Add integration test for export endpoint — AC: test covers empty result, 1k rows, invalid filters
- [ ] Test with large fixture (50k rows) — AC: response starts streaming within 2s, completes under 30s
- [ ] Add E2E smoke test — AC: Playwright test clicks Export, verifies download starts

## Milestones
| Milestone | Deliverable | Acceptance Criteria | Estimate |
|-----------|-------------|---------------------|----------|
| M1: Backend ready | Working export API | `curl` returns valid CSV for any report | Day 1 EOD |
| M2: UI wired | Export button functional | User can click and download | Day 2 EOD |
| M3: Ship-ready | Tests passing, reviewed | CI green, manual smoke test passed | Day 3 EOD |

## Testing Strategy
- **Unit tests**: `csvExport.ts` — empty input, special chars in data, column selection
- **Integration tests**: export endpoint — valid params, invalid reportId, oversized response
- **Manual**: download a 10k-row report and open in Excel/Sheets; verify data integrity
- **Regression**: existing report render tests must still pass (no DB query changes break reads)

## Risks & Mitigations
| Risk | Likelihood | Impact | Score | Mitigation |
|------|------------|--------|-------|------------|
| Memory spike on 100k row export | Med | High | 6 | Use streaming — verify with 100k fixture before ship |
| CSV encoding issues with non-ASCII data | Low | Med | 2 | csv-stringify handles this; add test with unicode fixture |
| Export endpoint becomes a DoS vector | Low | High | 3 | Apply rate limiting (10/min per user) in same PR |

## Dependencies
- **Internal**: Redis (for rate limiting), existing ReportFilters type in `src/types/reports.ts`
- **External**: `csv-stringify` npm package (MIT license, actively maintained)
- **Blocked by**: nothing — can start immediately

## Open Questions
- [ ] Should column order match the current display order or a fixed schema? — owner: product, by: EOD today
- [ ] Is 100k the real max, or do we need to handle larger? — owner: @eng-lead, by: start of Phase 1

## Follow-up Work (Out of Scope)
- Excel export (.xlsx)
- Scheduled exports / email delivery
- Export audit log
```

---

## Quality Benchmark

A plan passes quality review if a reviewer answers YES to all of these:

1. Can I tell exactly when this plan is 100% done, without asking the author?
2. Can I identify the riskiest part and what would be done if it fails?
3. Can I explain to a PM what's out of scope and why?
4. Could a mid-level engineer execute Phase 1 without a kickoff meeting?
5. Are there any tasks I can't verify as done or not-done?
6. Does the design reference actual code in this repo, not hypothetical code?

If any answer is NO, the plan is incomplete.
