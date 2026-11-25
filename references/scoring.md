# Risk Scoring & Complexity Sizing

## Risk Score Matrix

Risk Score = Likelihood × Impact

| | Impact: Low (1) | Impact: Med (2) | Impact: High (3) |
|---|---|---|---|
| **Likelihood: Low (1)** | Score 1 — Monitor | Score 2 — Note | Score 3 — Mitigate |
| **Likelihood: Med (2)** | Score 2 — Note | Score 4 — Mitigate | Score 6 — Priority |
| **Likelihood: High (3)** | Score 3 — Mitigate | Score 6 — Priority | Score 9 — Blocker |

**Score thresholds:**
- 1–2: Low — note in plan, no active mitigation required
- 3–4: Medium — mitigation plan required
- 6–9: High — must be resolved or explicitly accepted before starting

## Complexity Sizing Guide

### Micro (< 4h)
- Touches ≤ 2 files
- No new abstractions, no schema changes
- No external API integration
- Fully reversible with a single revert
- Examples: fix a bug, add a config flag, update a dependency, add a small utility function

### Standard (1–5 days)
- Touches 3–15 files
- New module or significant modification to existing one
- May involve schema migration or API contract change
- Requires coordinated testing
- Examples: add a new API endpoint, build a UI component with state, integrate a third-party SDK, refactor a data model

### Epic (1+ week)
- Touches 15+ files or requires 3+ phases
- Introduces new architectural layer or cross-cutting concern
- Requires coordination across teams or systems
- Migration strategy needed (data, traffic, API versions)
- Examples: new authentication system, service extraction, major platform upgrade, new product surface

## Plan Quality Checklist

Before finalizing any plan, score it against these dimensions:

### Completeness (must be 100%)
- [ ] Goal is observable (someone can verify it without asking you)
- [ ] Every task has an acceptance criterion
- [ ] Non-goals are listed (at least 2)
- [ ] At least 1 risk identified and scored
- [ ] Dependencies are named explicitly
- [ ] Testing strategy says WHAT to test, not just "write tests"

### Accuracy
- [ ] Technical design references real paths/files in the codebase
- [ ] Estimates are based on actual scope, not aspirational
- [ ] Alternatives considered are real alternatives, not strawmen
- [ ] Open questions are actual unknowns, not rhetorical

### Executability
- [ ] A new engineer could execute this plan without asking you for clarification
- [ ] The first task is concrete and startable immediately
- [ ] Milestones are checkpoints, not just percentage markers
- [ ] Exit criteria for each phase are binary (done/not done), not subjective

### Durability
- [ ] No time-relative language ("next sprint", "soon") — use absolute estimates
- [ ] Decisions are recorded with rationale so they survive personnel changes
- [ ] Follow-up work is captured, not silently deferred

## Common Planning Failures

| Failure | Symptom | Fix |
|---------|---------|-----|
| **Goal vagueness** | "Improve performance" | "p95 latency < 200ms for /api/search under 100 RPS load" |
| **Missing non-goals** | Scope creep mid-implementation | Explicitly list at least 2 non-goals before writing tasks |
| **Unverifiable ACs** | "Task complete when it works" | Each AC must reference an observable, measurable state |
| **Missing alternatives** | First idea becomes the design | Force ≥ 2 real alternatives before committing to approach |
| **Optimistic estimates** | Everything is "1 day" | Add 20–50% buffer for unknowns; surface uncertainty as risks |
| **Invisible dependencies** | Blocked mid-sprint by other team | Explicitly map every external dependency before starting |
| **No rollback** | Can't undo a bad deploy | Define rollback procedure for every state change |
| **99% done syndrome** | Milestone marked done with cleanup remaining | ACs must be binary, not "mostly done" |
