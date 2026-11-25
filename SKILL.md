---
description: Plans software engineering efforts with structured milestones, tasks, acceptance criteria, risk assessment, and technical design. Produces a durable PLAN-[feature].md artifact grounded in the actual codebase. Use when planning, designing, scoping, or preparing to build any feature, system, API, refactor, integration, or code change.
when_to_use: Trigger on phrases like "plan", "build", "implement", "design", "create a feature", "add a feature", "add an endpoint", "architect", "how should we approach", "what's the approach to", "let's work on", "I want to build", "we need to implement", "scaffold", "set up a system", "migrate to", "integrate with". Also trigger when the user describes a goal without a clear single-step implementation path. Do NOT trigger for: reviewing already-written code without building, debugging a specific existing error, trivial one-liners (comment, typo), pure refactors scoped to one function.
effort: high
allowed-tools: Read Bash Glob Grep
argument-hint: what to build, design, or implement
---

ultrathink

## Engineering Request

Goal: $ARGUMENTS

(If $ARGUMENTS is empty, derive the engineering goal from the most recent user message in the conversation.)

**Quick-plan mode**: If the user said "quick", "rough", "sketch", "brief", or "high-level", produce a Micro checklist regardless of actual scale. Skip Steps 3–5 and go straight to Step 4 using the Micro template. State this assumption explicitly.

## Codebase Context
```!
echo "=== Project ===" && pwd
echo "=== Type ===" && ls package.json pyproject.toml Cargo.toml go.mod pom.xml Makefile 2>/dev/null | tr '\n' ' ' || echo "(no manifest found)"
echo "=== Git ===" && git status --short 2>/dev/null || echo "(not a git repo)"
echo "=== Last 5 commits ===" && git log --oneline -5 2>/dev/null || echo "(none)"
echo "=== Structure ===" && find . -maxdepth 3 \( -path "*/node_modules" -o -path "*/.git" -o -path "*/__pycache__" -o -path "*/dist" -o -path "*/.next" -o -path "*/build" -o -path "*/vendor" -o -path "*/.venv" \) -prune -o -print 2>/dev/null | head -60
echo "=== Existing Plans ===" && find . \( -name "PLAN-*.md" -o -name "PLAN.md" \) 2>/dev/null | grep -v ".git" | head -8
```

---

## Steps

You are a senior staff engineer. Execute every step in order. Do not skip.

### Step 1 — Understand the Goal

1. Extract the engineering goal from $ARGUMENTS or the conversation context.
2. Read every file in the codebase that relates to this goal — routes, models, types, config, existing tests.
3. If the codebase is new/empty, note this and plan from first principles, clearly marking all file paths as "to be created."
4. List what already exists vs. what must be built.
5. If ONE ambiguity would produce a materially wrong plan, ask it — one focused question, then wait. Otherwise state your assumptions and proceed.

### Step 2 — Assess Scale

| Scale | Signals | Format |
|-------|---------|--------|
| **Micro** (< 4h) | ≤ 2 files touched, no new abstraction, no schema change, fully reversible | Short checklist |
| **Standard** (1–5 days) | 3–15 files, one feature or API, coordinated testing | Full PLAN-*.md |
| **Epic** (> 5 days) | 15+ files, new system, migration, cross-cutting concern, infra change | RFC-style with phases |

**Rule**: When uncertain between two scales, choose the larger. Underestimating is more costly than overestimating.

**Naming the plan file**:
- Derive a short kebab-case name from the goal: `PLAN-jwt-auth.md`, `PLAN-csv-export.md`, `PLAN-db-migration.md`
- If a plan file of the same name already exists, prepend today's date: `PLAN-jwt-auth-2026-07-06.md`
- Write the file to the project root, or current directory if there is no project root.

### Step 3 — Explore the Codebase

Run targeted searches before writing anything:
- Grep for symbols, endpoints, models, and types relevant to the goal
- Read the key source files — understand the data models, API contracts, and existing patterns
- Check how tests are organized and what's already covered
- Look for prior decisions: inline comments, ADRs, existing PLAN files, or CLAUDE.md notes
- Identify any third-party libraries already in use that would be relevant

For a new/empty project: describe the intended architecture and note all paths as future.

### Step 4 — Write the Plan

Read [references/templates.md](references/templates.md) and use the template matching the assessed scale. Write the plan file now.

**Non-negotiable for every plan at every scale:**

| Requirement | What "done" looks like |
|-------------|----------------------|
| Observable goal | Someone can verify it's achieved without asking you |
| ACs on every task | Binary: done or not done — no "works", only specific observable states |
| Non-goals (≥ 2) | Explicit list of what this plan does NOT cover |
| At least 1 risk | Identified, scored (Likelihood L/M/H × Impact L/M/H), with mitigation |
| Real code refs | File paths, function names, or schema fields from the actual codebase (or "to be created" for new projects) |
| Specific tests | States what behavior to test and what type — not just "add tests" |
| Named dependencies | Every external team, service, library, or infrastructure component stated |
| Open questions | All unresolved decisions listed — even "none identified" must be stated |

Use [references/scoring.md](references/scoring.md) for risk scoring and quality benchmarks.
Use [references/examples.md](references/examples.md) to calibrate quality — the CSV export example is the Standard benchmark.

**"Wrong is better than vague."** If you're uncertain about a detail, state your assumption explicitly rather than writing something vague.

### Step 5 — Verify and Fix

Run this checklist against the plan file. For every item that fails: **go back and fix it right now, then re-check**.

```
Plan Quality Verification:
- [ ] Goal is observable without asking the author (no "improve X", only "X achieves Y under Z")
- [ ] Every single task has a binary acceptance criterion
- [ ] At least 2 non-goals are listed
- [ ] At least 1 risk is identified and scored with a mitigation
- [ ] Technical design references real file paths or symbols (or notes "to be created")
- [ ] Testing strategy names what behaviors to test, not just "add tests"
- [ ] All dependencies are explicitly named
- [ ] A mid-level engineer could start Phase 1 right now with no kickoff meeting
- [ ] Open questions section exists (even if empty)
- [ ] No vague language: no "soon", "better", "improve", "as needed", "eventually"
```

If all 10 items pass: done. If any fail: fix and re-verify.

### Step 6 — Deliver the Summary

Output this to the conversation (do NOT paste the full plan file):

1. **Goal**: one sentence — what success looks like
2. **Scale**: Micro / Standard / Epic — one line explaining why
3. **Phases**: list with time estimates (Standard and Epic only)
4. **Top risk**: the single biggest thing that could derail this, with score
5. **First action**: the exact, concrete next step the user should take right now
6. **Plan file**: the path where the plan was written

Offer to walk through any section in detail, or to update the plan if scope changes.
