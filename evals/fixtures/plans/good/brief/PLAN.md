# Rate-limit the export endpoint

Status: approved · Tier: brief · Baseline: 16c5eb7 · Updated: 2026-11-25
Now: S1 in progress.

## Outcome
`/api/export` allows 10 requests a minute per user and answers the 11th with 429 and `Retry-After`.
Done when:
- `npm test -- rateLimit` passes
- `curl` past the limit returns 429 with a `Retry-After` header

## Decisions
- Reuse the Redis client in `src/lib/redis.ts`. Reason: sessions already use it, so no new dependency.

## Out of scope
- Other endpoints. The ticket names only export.

## Questions
- None.

## Assumptions
- Per user, not per IP, because export requires a login.

## Slices

### S1: Limiter middleware on the export route [doing]
Goal: requests past 10 a minute get 429.
Touch: `cli/jig.mjs`, `src/middleware/rateLimit.ts (new)`
Checks: `npm test -- rateLimit`
- Risk: the clock window resets late under load. Detect: the reset test fails. Fallback: use Redis TTL instead of timestamps.

## Log
- 2026-11-25: Plan approved by owner.
