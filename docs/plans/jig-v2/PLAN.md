# jig v2: a planning and build harness for coding agents

Status: draft · Tier: program · Baseline: `ddb3fdb` · Updated: 2026-11-25
Now: waiting on owner review of this plan. Next: M0 spikes.

This plan uses the format it proposes: a short part for the owner to approve, then a longer part for the agent that builds it. Evidence for every design choice is in [the adversarial review](../../research/2026-11-adversarial-review.md).

## Outcome

jig replaces the `plan-engineering` skill. It is a Claude Code plugin that plans engineering work at any size, carries the plan through to verified code, and turns repeated failures into deterministic guardrails.

Done when:

- `claude plugin validate .` and `skills-ref validate skills/*` pass.
- `node bin/jig.mjs lint` passes every good fixture plan and fails every seeded bad one in `evals/fixtures/plans/`.
- The eval report in `evals/results/` compares jig with three baselines (no skill, plan mode alone, `superpowers:writing-plans`) on the fixture task set. It shows jig at least matching each baseline on task success measured by checks. It also states jig's token overhead on tier-0 tasks, whatever the result.
- Each guardrail hook has a fixture that trips it and one that doesn't, and both pass in CI.
- The README states what was tested, on which models, and what wasn't.

## Decisions

Calls the owner asked me to make, with reasons. Mark any you want changed.

1. **Name: jig.** A jig holds the work and guides the tool so each cut comes out the same, which is what the harness does for an agent. The npm name `jig` is taken, so the CLI ships as `jig-plan`, the same pattern as `loupe-review`. Alternatives: plumb, keel.
2. **Plan mode: work inside it, don't replace it.** Plan mode is the harness's own approval gate, and a skill can't reproduce its UI. When the session is in plan mode, jig's short human-layer section becomes the plan-mode plan and the owner approves it there. jig writes the plan files after approval. Outside plan mode, jig writes the files and asks for approval only when a gate in decision 5 applies. How plan mode treats file writes isn't documented, so M0 tests it first.
3. **superpowers: coexist, don't depend.** jig must work without superpowers installed, so it can't call `superpowers:writing-plans` or `brainstorming`. Both auto-trigger on the same requests, though. The README will say so, and I'll suggest you turn off the superpowers planning skills in your own setup once jig passes its evals. Calling them would tie jig to a third-party release schedule. Silently overriding them can't be done.
4. **Auto-trigger at every size, with a near-free smallest tier.** You asked for automatic triggering on any engineering task. The risk is that small edits pay for a planning step. Tier 0 is therefore a plan of at most 5 lines in chat, with no file and no subagent, and the evals measure its overhead. If tier 0 costs more than it saves, the eval report will say so.
5. **Gates are decided by context and listed once.** jig always stops for the human on one-way doors and lets everything else proceed with a logged assumption. One-way doors are schema and partition-key design, public API contracts, the auth model, data deletion, production or infrastructure changes, new runtime dependencies, and scope changes. When you say "zero intervention", jig proceeds on all of these except destructive or irreversible actions, and lists each one-way decision at the top of the plan for review afterward.
6. **Solo by default, team when detected.** Owners, review assignments and ADR files appear only when the repo has more than one recent author or you say a team is involved.
7. **loupe and humanizing-writing are optional partners.** When a slice changes UI and loupe is installed, its done-when includes a loupe review of the affected screens. When humanizing-writing is installed, the human-layer prose, log entries and PR descriptions follow it. If neither is installed, jig works the same without those steps.
8. **The old skill stays installed until v2 passes its evals.** Removing `~/.claude/skills/plan-engineering` and updating the memory note that points to it are the last step.

## Out of scope for v2.0

- A website, unlike loupe's. The README carries the docs.
- Agents other than Claude Code running the hooks. Skills and plan files stay portable markdown (Agent Skills spec, AGENTS.md snippet), but the hooks are Claude Code only.
- Writing to any user settings file. jig prints suggested deny rules and never applies them.
- Running tests on every turn. The Stop hook runs only the fast check of an in-progress slice.
- Time or effort estimates. jig reports scope (slices, files, checks), not days.

## Questions only you can answer

- None blocking M0. I'll ask in M5 before publishing: public or private repo first, and whether to list jig on any marketplace.

## Assumptions

- Node 20+ is available wherever the CLI runs (loupe already assumes this).
- `claude plugin eval` is available on your account. If not, M0 falls back to skill-creator's eval format.
- Your excerpts on AI code failure modes are used with the corrections in the review's verification table (CodeRabbit's 8x is for excessive I/O only; Gloaguen's cost figure is +20–23%).

---

## Agent layer

Everything below is for the agent building jig. The owner doesn't need to read it to approve the plan.

### What ships

```
jig/
  .claude-plugin/plugin.json, marketplace.json
  skills/
    plan/SKILL.md        frame → survey → size → draft → lint → review → gate → hand off
    build/SKILL.md       resume → one slice → acceptance checks first → implement → verify → log → commit
    guard/SKILL.md       repeated failure or incident → choose a mechanism → add hook, lint rule or test
  agents/
    jig-reviewer.md      read-only, fresh context; modes: plan review, slice diff review
  hooks/hooks.json       SessionStart, PreToolUse (Edit|Write|MultiEdit, Bash), Stop
  bin/jig.mjs            zero-dependency CLI: lint, status, verify, doctor, hook <event>
  references/            loaded on demand by the skills
    plan-format.md       file layout, sections, length budgets, checks.json schema
    sizing.md            tier signals
    failure-modes.md     AI code failure catalogue → the plan field or check that catches each
    fundamentals.md      prompts triggered by what a change touches (concurrency, DB, network ...)
    security.md          lethal trifecta, secrets, supply chain, repo config, blast radius
    mechanisms.md        need → mechanism (deny rule, hook, CLAUDE.md, skill, subagent, MCP)
    safe-change.md       flags, expand and contract migrations, rollback, observability
    team.md              owners, ADRs, worktree split along module boundaries
  evals/                 fixture repos, seeded plans, task set, runner, results
  test/                  CLI and hook unit tests
```

Each component exists because of a failure in the review or the owner's research. If a component's failure fixture doesn't show it catching anything, cut the component.

| Component | Failure it addresses |
|---|---|
| plan skill: separate ambiguity check | Models can't tell underspecified tasks from clear ones (Ambig-SWE); one question at most is too few |
| Two-layer plan with length budgets | Long plans don't get reviewed; 750 KB wayfarer plan |
| `jig lint` | Self-graded checklists don't fail |
| jig-reviewer, plan mode | Self-preference; the author can't review its own plan |
| jig-reviewer, diff mode | Swallowed errors, duplication, invented packages, scope creep, insecure defaults |
| checks.json + protected files | Tests that mirror the code; test tampering |
| PreToolUse Edit hook | Edits to protected acceptance tests, edits outside the slice's files |
| PreToolUse Bash hook | Slopsquatting; agent-initiated installs |
| Stop hook | "Tests pass" without running them |
| SessionStart hook, status line | Plans that go stale; resuming after context rot |
| build skill, one slice per session | Context rot; attempting too much at once |
| guard skill | The same correction made twice |
| `jig doctor` | Repos with no one-command verify, no empty-catch lint, secrets readable by the agent, unread `.claude/settings.json` or `.mcp.json` |
| fundamentals.md | Plausible wrong logic, N+1 queries, races, missing indexes, retry storms |

### Plan file format (lands in references/plan-format.md)

Location: `docs/plans/<slug>/PLAN.md` plus `checks.json`. If the repo already keeps plans elsewhere (for example `docs/PLAN.md`), use that location instead.

Human layer, in this order: status line with the `Now:` resume line, Outcome with done-when commands, Decisions (one-way doors marked), Out of scope, Questions only the human can answer, Assumptions. Budgets: 40 lines at tier 1, 80 lines at tiers 2 and 3.

Agent layer: Slices, then an append-only Log. Each slice has a goal, the files it may touch, check IDs, and its risks. Each risk says how you'd notice it and what the fallback is, with no score. Each Log entry is dated and covers a decision change, check evidence (command, exit code, the decisive output line), or a slice finishing with two or three lines on what changed and why. Those lines are how comprehension debt gets paid down.

Whole file: at most 400 lines. When a plan would pass that, finished slices collapse into one Log line each, and a program-tier plan splits into one plan per phase plus an index.

`checks.json` entries: `id`, `slice`, `kind` (acceptance, regression, property, mutation, perf, security), `cmd`, `expect` (exit code, plus an optional stdout pattern), `timeout_s`, `protects` (paths the agent may not edit without a logged decision), and `fast` (true when the check runs in under 60 seconds and may run from the Stop hook).

### Tiers (lands in references/sizing.md)

| Tier | Output | When |
|---|---|---|
| 0 inline | At most 5 lines in chat: goal, files, done-when command | One reversible change, no contract or data change, existing check covers it |
| 1 brief | PLAN.md human layer + 1 to 3 slices | Several files or one new behaviour, all reversible |
| 2 full | Plus checks.json, reviewer pass, gate if a one-way door applies | Any one-way door, new dependency, auth or data path, or more than 3 slices |
| 3 program | Index plus one plan per phase, ADR per one-way door | Work that can't be verified as one plan, or more than one person |

When unsure, pick the smaller tier and escalate when a signal appears. Escalating is logged.

### Slices

Each slice is one checkable increment, in the order contract, then fixture data, then behaviour, then integration. Each ends with its checks green and a commit.

**M0: Spikes.** Answer the unknowns before building on them. Record each answer in `docs/research/m0-spikes.md` along with the command or transcript that settled it.
- Does plan mode allow a skill to write `docs/plans/...`, or only the plan-mode plan file?
- Does PreToolUse `additionalContext` reach the model on `allow`, so a scope warning can avoid an ask?
- Trigger collision: with jig and superpowers both installed, which skill fires on 10 sample prompts?
- Is `claude plugin eval` available, and can its graders run a shell command?
- Done when: the spike notes answer all four, and the slices below are adjusted where an answer changes them.

**M1: Format and lint.**
- `references/plan-format.md`, a JSON Schema for checks.json, and `jig lint`.
- Lint checks: required sections in order; human-layer and file budgets; every slice has check IDs that exist in checks.json; every path in Touch exists or is marked new; no banned vague words; no day or week estimates; status is a known value; the Log is append-only against git HEAD.
- Done when: `node --test` passes; lint passes all files in `evals/fixtures/plans/good/` and fails every file in `bad/`, each with the expected rule ID.

**M2: plan skill and reviewer.**
- `skills/plan/SKILL.md` (under 200 lines; every rule carries its reason), `agents/jig-reviewer.md`, and the references sizing, failure-modes, fundamentals, security, mechanisms and safe-change.
- Done when: on 8 fixture tasks the produced plans pass lint. On 10 seeded plan defects, the reviewer finds more than the author's self-check does in the same runs. Both numbers are recorded in `evals/results/m2.md`.

**M3: build skill and hooks.**
- `skills/build/SKILL.md`, `hooks/hooks.json`, and the `jig hook` entry points. Hook scripts follow the hardening in the Claude Code docs: git with `core.fsmonitor=` and `core.hooksPath=/dev/null`, JSON escaped, and the `stop_hook_active` guard.
- Done when: each hook's trip fixture and pass fixture behave as expected under `node --test`. In an execution eval, a fresh session resumes a half-built fixture plan from the SessionStart line alone and finishes the next slice with its checks green.

**M4: guard skill and doctor.**
- `skills/guard/SKILL.md`, `jig doctor`, and `references/team.md`.
- Doctor reports, and never fixes: a missing one-command verify, a missing empty-catch lint rule, `.env` or `~/.ssh` readable without a deny rule, `.claude/settings.json` or `.mcp.json` present and not yet reviewed, no secret scanner in CI, and lockfile drift.
- Done when: doctor's output on 3 fixture repos matches the expected findings file for each.

**M5: Evals, packaging and publish prep.**
- Full task set against the three baselines; plugin and marketplace manifests; README; CI (lint the fixtures, unit tests, `claude plugin validate`).
- Done when: everything under Outcome is true, and you've answered the publishing questions.

### Eval task set

These are fixture repos with seeded traps. Each trap tests one claim from the review.

1. A helper already exists that the task needs. Does the plan reuse it?
2. An acceptance test conflicts with the spec. Does the agent stop and report instead of editing the test?
3. A list endpoint where the obvious code is N+1. Does the plan or the reviewer catch it?
4. A new route with no auth check. Does the plan or the reviewer catch it?
5. An underspecified ticket. Are the right questions asked, and none on the clear tickets?
6. A schema change. Is it gated as a one-way door?
7. A one-line fix. Does jig stay at tier 0, and what did it cost?
8. A task that tempts installing a package with a near-miss name. Does the Bash hook ask?
9. Trigger set: 20 prompts, including debugging, code review and questions that should not fire.

Graders run commands: lint, the fixture's hidden checks, `git diff --stat` limits, and hook logs. Prose criteria are allowed only where no command can decide, and the report labels them as such.

### Risks

- **Automatic triggering slows every request.** You'd see this in task 7's token cost. Fallback: tighten the description, or make tier 0 a single line.
- **Hooks ask too often and get switched off.** You'd see this as more asks than trips in the fixtures. Fallback: change the asks to added context, and give each hook a config switch to turn it off.
- **The Stop hook runs slow checks.** You'd see this as a check over its timeout. Fallback: run only checks marked `fast`, and skip with a note.
- **Model judges inflate the M2 and M5 results.** Fallback: where a command can decide the outcome, use the command. Report judged numbers separately and never call them human-tested.
- **Plan mode blocks writing the plan files.** M0 shows this either way. Fallback: write the files on the first turn after approval.

### Log

- 2026-11-25: Imported v1.0 (`16c5eb7`), wrote the adversarial review (`ddb3fdb`), and renamed the repo folder to `jig`. Owner decisions: solo-first with team support, automatic triggering, gates by context, rename plus plugin packaging.
