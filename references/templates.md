# Plan Templates

## Micro Plan (< 4 hours)

```markdown
# Plan: [Task Name]
> Status: PROPOSED
> Scale: Micro
> Created: [YYYY-MM-DD]

## Goal
[One sentence: what observable change will be true when this is done]

## Tasks
- [ ] [Task] — AC: [how to verify it's done]
- [ ] [Task] — AC: [how to verify it's done]

## Non-Goals
- [Explicitly not doing X]

## Notes
[Any caveats, constraints, or follow-ups]
```

---

## Standard Plan (1–5 days)

```markdown
# Plan: [Feature / Work Name]
> Status: PROPOSED
> Scale: Standard
> Estimated effort: [X days]
> Created: [YYYY-MM-DD]
> Author: [inferred from git config or left blank]

## Goal
[What success looks like — observable and testable. Include the user-visible outcome and the technical outcome.]

## Background
[Context: why now, what's broken or missing, any relevant history. Link to tickets, specs, or prior decisions if they exist in the codebase.]

## Non-Goals
[Explicit list of what this plan does NOT cover. At least 2 items. This prevents scope creep and clarifies boundaries.]
- Not in scope: [X]
- Not in scope: [Y]

## Technical Design

### Overview
[Architecture diagram in ASCII or prose. How the pieces fit together.]

### Key Components
| Component | File / Path | Change Type | Notes |
|-----------|-------------|-------------|-------|
| [name]    | [path]      | New / Modify / Delete | [why] |

### Data Model Changes
[If any: schema changes, new types, migrations needed]

### API / Interface Changes
[If any: new endpoints, modified signatures, breaking changes]

### Key Decisions
[Each major design decision with rationale. Format: Decision → Rationale → Alternatives considered]

## Alternatives Considered
| Option | Pros | Cons | Why Rejected |
|--------|------|------|--------------|

## Work Breakdown

### Phase 1: [Name] (~Xd)
- [ ] [Task] — AC: [objective criterion]
- [ ] [Task] — AC: [objective criterion]

### Phase 2: [Name] (~Xd)
- [ ] [Task] — AC: [objective criterion]

## Milestones
| Milestone | Deliverable | Acceptance Criteria | Estimate |
|-----------|-------------|---------------------|----------|
| M1: [name] | [tangible output] | [verifiable condition] | [date/duration] |
| M2: [name] | [tangible output] | [verifiable condition] | [date/duration] |

## Testing Strategy
- **Unit tests**: [what to cover, which files, target coverage]
- **Integration tests**: [what flows to test end-to-end]
- **Manual verification**: [how to smoke-test in dev or staging]
- **Regression check**: [what existing tests must still pass]

## Risks & Mitigations
| Risk | Likelihood | Impact | Score | Mitigation |
|------|------------|--------|-------|------------|
| [risk] | Low/Med/High | Low/Med/High | [see scoring] | [action] |

## Dependencies
- **Internal**: [teams, services, or code paths this depends on]
- **External**: [third-party APIs, libraries, infrastructure]
- **Blocked by**: [anything that must happen first]

## Open Questions
- [ ] [Question] — owner: [who], by: [when]

## Follow-up Work (Out of Scope)
[Known future work that this plan intentionally defers]
```

---

## Epic Plan (1+ week / multiple phases)

```markdown
# RFC: [System / Initiative Name]
> Status: OPEN FOR REVIEW
> Scale: Epic
> Target start: [YYYY-MM-DD]
> Created: [YYYY-MM-DD]
> Author: [inferred from git config or left blank]

---

## 🎯 Goals
[Problem statement: what is broken, missing, or suboptimal. What opportunity does this address. What does success look like 3 months from now.]

## 📘 Background
[Context required to understand and evaluate this RFC. Include: current state, pain points, constraints (technical, organizational, legal), prior attempts. Glossary if needed.]

## 🔭 Non-Goals
[What this RFC explicitly does NOT address. Be aggressive here — this is where RFCs go wrong by trying to solve too much.]

## 🏗 Architecture

### System Diagram
[ASCII diagram or prose description of the target architecture]

### Component Inventory
| Component | New / Modified | Responsible Team | Notes |
|-----------|---------------|-----------------|-------|

### Data Flow
[How data moves through the system. Sequence diagram in ASCII if helpful.]

### Data Model
[Schema, types, migrations. For large changes, link to a separate schema file.]

### API Design
[Public interfaces: endpoints, function signatures, events, protocols]

### Infrastructure Changes
[Hosting, networking, storage, CI/CD, monitoring changes]

## 🔀 Alternatives Considered
[Other solutions evaluated and why this approach was chosen. At least 2 meaningful alternatives. Omitting this signals incomplete analysis.]

| Option | Description | Pros | Cons | Verdict |
|--------|-------------|------|------|---------|

## ⚖️ Tradeoffs
[Explicit downsides of the chosen approach and why they are acceptable]

## 😱 Risks
| Risk | Likelihood | Impact | Score | Mitigation | Owner |
|------|------------|--------|-------|------------|-------|

## 🔗 Dependencies
- **Upstream**: [what this RFC depends on]
- **Downstream**: [what depends on this RFC]
- **External**: [third-party, legal, compliance, infra]

## 📅 Phases & Milestones

### Phase 1: Foundation (~Xw)
**Goal**: [What this phase enables / proves]
**Deliverable**: [Tangible, shippable output]
**Tasks**:
- [ ] [Task] — AC: [criterion]
**Exit criteria**: [What must be true before Phase 2 starts]

### Phase 2: Core (~Xw)
**Goal**: [...]
**Deliverable**: [...]
**Tasks**:
- [ ] [Task] — AC: [criterion]
**Exit criteria**: [...]

### Phase 3: Hardening & Launch (~Xw)
**Goal**: [...]
**Deliverable**: [...]
**Tasks**:
- [ ] [Task] — AC: [criterion]
**Exit criteria**: [...]

## 🧪 Testing Strategy
- **Unit / component tests**: [scope and coverage targets]
- **Integration tests**: [system interactions to cover]
- **Load / performance tests**: [if relevant — thresholds]
- **Rollout strategy**: [feature flags, canary, phased rollout]
- **Rollback plan**: [how to undo if something goes wrong]

## ⚙️ Operations
- **Observability**: [metrics, logs, traces to add]
- **Alerts**: [what to page on]
- **Runbook**: [pointer to ops doc or brief notes]
- **On-call implications**: [what new failure modes exist]

## ❓ Open Questions
- [ ] [Question] — owner: [who], target resolution: [date]

## 🗂 Appendix
[Supporting material: benchmarks, prototypes, prior art, links]
```
