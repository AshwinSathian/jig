# jig design

Reference for the agent building jig. The plan that schedules this work is [docs/plans/jig-v2/PLAN.md](plans/jig-v2/PLAN.md). The evidence behind each choice is in [the adversarial review](research/2026-11-adversarial-review.md).

## What ships

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

Each component exists because of a failure in the review or the owner's research — if a component's failure fixture doesn't show it catching anything, cut the component.

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

## Plan file format

Specified in [references/plan-format.md](../references/plan-format.md) and enforced by `jig lint`.

## Tiers (lands in references/sizing.md)

| Tier | Output | When |
|---|---|---|
| 0 inline | At most 5 lines in chat: goal, files, done-when command | One reversible change, no contract or data change, existing check covers it |
| 1 brief | PLAN.md human layer + 1 to 3 slices | Several files or one new behaviour, all reversible |
| 2 full | Plus checks.json, reviewer pass, gate if a one-way door applies | Any one-way door, new dependency, auth or data path, or more than 3 slices |
| 3 program | Index plus one plan per phase, ADR per one-way door | Work that can't be verified as one plan, or more than one person |

When you're unsure, pick the smaller tier and escalate when a signal appears. Escalating is logged.

## Milestone detail

Each slice is one checkable increment, in the order contract, then fixture data, then behaviour, then integration — and each ends with its checks green and a commit.

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

## Eval task set

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

Graders run commands: lint, the fixture's hidden checks, `git diff --stat` limits, and hook logs. Prose criteria are allowed only where no command can decide — and the report labels them as such.


## Context and cost

jig adds to every session it runs in, so it keeps that addition small and avoids invalidating Claude Code's prompt cache. Evidence: [docs/research/2026-11-context-cost-review.md](research/2026-11-context-cost-review.md).

- **No `effort` or `model` in any skill frontmatter.** Changing effort invalidates the messages cache, and changing model invalidates all of it.
- **Hooks append, are short, and don't repeat.** The out-of-scope warning fires once per file per session (state in the jig state dir). SessionStart prints at most about 10 lines.
- **CLI output is bounded.** One line per check, plus the deciding line on failure. No log dumps.
- **One slice per session.** The plan file is the memory, so a fresh session resumes cheaply instead of compacting a long one.
- **The reviewer gets paths, not content,** and runs only at the full and program tiers.
- **Evals report cost per completed task** for each arm (total cost, cache-read and cache-write tokens, turns), from `claude -p --output-format json`.
