# jig

A planning and build harness for Claude Code. jig sizes the plan to the task, writes acceptance checks before the code, and uses hooks to stop the usual ways agent work goes wrong: edited tests, unvetted packages, out-of-scope edits, and "done" with nothing run.

A one-line fix gets a four-line plan in chat. A feature gets a short plan file you approve, plus a machine-readable list of checks. Each slice of the plan then gets built in its own session, verified, and logged with evidence.

```bash
claude plugin marketplace add AshwinSathian/jig
claude plugin install jig@jig
```

Then work as usual: *"add CSV export to the reports page"*. jig plans first, at the size the task needs.

## Contents

- [What it does](#what-it-does)
- [The plan file](#the-plan-file)
- [Hooks](#hooks)
- [The CLI](#the-cli)
- [What the evals show](#what-the-evals-show)
- [With plan mode and superpowers](#with-plan-mode-and-superpowers)
- [Limits](#limits)
- [Repository](#repository)

## What it does

| Part | What it's for |
|---|---|
| `plan` skill | Checks the request for ambiguity before planning and asks only what changes the plan. Surveys the code for things to reuse. Picks a tier, drafts the plan, lints it, sends larger plans to a fresh-context reviewer, and stops for you on one-way doors. |
| `build` skill | Resumes from the plan's `Now:` line, works one slice, writes acceptance checks before the code, runs `jig verify --record`, logs what changed, and commits. |
| `guard` skill | When the same mistake happens twice, turns it into a test, lint rule, deny rule or hook instead of another reminder. Also runs `jig doctor`. |
| `jig-reviewer` agent | Reviews a plan, or a slice's diff, in a fresh context. Every finding comes with evidence. |
| Hooks | See [Hooks](#hooks). |
| `jig` CLI | Zero-dependency Node 20+ CLI: `new`, `lint`, `status`, `verify`, `doctor`. |

### Tiers

| Tier | Output | When |
|---|---|---|
| 0 | Up to five lines in chat | One reversible change that one command proves |
| brief | `docs/plans/<slug>/PLAN.md` with 1 to 3 slices | Several files, all reversible |
| full | Plus `checks.json`, a reviewer pass, and a gate on one-way doors | Schema, public API, auth, data deletion, production, new dependencies, more than three slices |
| program | An index plan with one child plan per phase, plus ADRs | Work that can't be checked as one plan, or several people |

Tiers are sized by what has to be checked and what can't be undone, never by hours. jig plans contain no time estimates.

**One-way doors always stop for you:** schema and partition keys, public API contracts, the auth model, data deletion, production or infrastructure changes, new runtime dependencies, and scope changes. Everything else goes ahead, with each assumption logged so you can overrule it. If you say "no questions", jig proceeds on all of these except destructive actions.

## The plan file

A plan has a short part for you and a longer part for the agent:

```markdown
# CSV export for reports

Status: approved · Tier: full · Baseline: 3f2a91c · Updated: 2026-11-25
Now: S2 in progress; S1 done.

## Outcome
Users download the filtered report as a streamed CSV, up to 100k rows.
Done when:
- `npm test -- export` passes (C1, C2)

## Decisions
- [one-way] Stream from the server. Reason: 100k rows don't fit in browser memory. Decided: owner 2026-11-25

## Out of scope
## Questions
## Assumptions

## Slices
### S1: Endpoint streams CSV [done]
Touch: `src/api/reports/export.ts (new)`
Checks: C1, C2
- Risk: cursor paging skips rows. Detect: C2 compares counts. Fallback: keyset paging.

## Log
- 2026-11-25 14:02: jig verify S1: C1 pass; C2 pass
```

The rules are in [references/plan-format.md](references/plan-format.md), and `jig lint` enforces them. The ones that matter most:
- every done-when item is a command or a check ID
- every decision gives a reason
- each risk says how you'd notice it and what you'd do
- the human layer stays within 40 or 80 lines
- the Log is append-only, compared against the committed version

## Hooks

| Hook | Does | Never |
|---|---|---|
| SessionStart | One paragraph telling the model to plan engineering changes with jig, plus the status of active plans | Runs repo commands |
| PreToolUse on edits | **Asks** before editing a file a check protects (an acceptance test). Adds a note, once per file, when an edit falls outside the current slice's files. Asks if `checks.json` is invalid. | Returns `allow`, so your own permission prompts still apply |
| PreToolUse on Bash | **Asks** before `npm i`, `pip install`, `cargo add` and similar when they name a package | Blocks lockfile installs (`npm ci`, `pip install -r`) |
| Stop | When files changed after the last `jig verify`, asks the agent to run it and report the result. Asks once more if the last verify failed. | Runs the checks itself, because `checks.json` comes from the repo and a repo can be hostile |

Turn hooks off with `JIG_HOOKS_OFF=pre-bash,stop` (or `all`), and the nudge with `JIG_NUDGE=off`. The hooks are guardrails, not a security boundary. A shell command can still edit a file without going through the Edit tool.

## The CLI

```
jig new <slug> --tier brief|full|program --title "..."
jig lint [PLAN.md or directory ...]
jig status
jig verify [--slice S2] [--fast] [--record]
jig doctor
```

`jig doctor` reports, and never changes:
- a missing one-command verify
- no empty-catch lint rule
- `.env` or key files the agent can read with no deny rule
- repo `.claude/settings.json` or `.mcp.json` that can run code or redirect API traffic (the settings behind CVE-2025-59536, CVE-2026-21852 and CVE-2026-33068)
- no secret scanner or SAST in CI
- lockfile drift

## What the evals show

Full report: [evals/results/REPORT.md](evals/results/REPORT.md). In short, from small fixture repos on Claude Opus 5.5, mostly one run per cell:

- **Task evals.** jig passed 8 of 8 trap tasks, no skill 6 of 8, superpowers 6 of 8, and headless plan mode 4 of 8. Without jig, the model was already good at reuse, N+1 queries, auth and fake packages. jig's two gains were stopping to ask on "Make the export faster" and stopping for approval before a schema rename.
- **Cost.** About $0.02 and three turns more per task than no skill (+33% on these small tasks).
- **Triggering.** 10 of 10 prompts as expected, with or without superpowers installed. That needed the SessionStart nudge: without it, direct build requests skipped the skill.
- **Plan files.** All three multi-slice plans the eval produced passed `jig lint`.
- **Reviewer.** It found 5 of 5 seeded plan defects in both runs, against 4 and 5 for a plain review. That's too close to call.

Not tested:
- models other than Opus 5.5
- large repos
- multi-session builds end to end
- self-review against fresh review
- plans rated by people

The research behind the design is in [docs/research/](docs/research/).

## With plan mode and superpowers

- **Plan mode.** jig works inside it. Plan mode blocks project writes, so jig puts the whole plan in the plan-mode plan, and writes `docs/plans/` after you approve.
- **superpowers.** Both plugins auto-trigger on planning requests. In the trigger eval jig fired first on all seven planning prompts, but you'll get two planning workflows if both are on. Consider turning off superpowers' `brainstorming` and `writing-plans` skills while jig is installed.
- **loupe and humanizing-writing.** When they're installed, a UI slice includes a loupe review, and plan prose and PR descriptions follow humanizing-writing.

## Limits

- **Claude Code only for hooks.** Skills and plans are plain markdown that other agents can read, but the plan skills reference `${CLAUDE_PLUGIN_ROOT}`, which only Claude Code substitutes.
- **It adds tokens.** The nudge is about 80 tokens per session, and planning adds a few turns per task. On a one-line change that's pure overhead. Turn the nudge off if you'd rather invoke `/jig:plan` yourself.
- **The Stop hook needs `checks.json`.** Brief plans that list checks as commands don't trigger it.

## Repository

```
skills/      plan, build, guard
agents/      jig-reviewer
hooks/       hooks.json
cli/         the jig CLI (no dependencies)
references/  loaded on demand by the skills
evals/       task, trigger and reviewer evals, fixtures, results
test/        node --test suites for the CLI and hooks
docs/        design, research, and jig's own build plan
```

Run the tests with `npm test`, and lint with `npx eslint`. Running evals spends money on your account. Start with `node evals/run.mjs --tasks tiny --arms none,jig`.

jig replaces an earlier single-file skill, `plan-engineering`. [docs/research/2026-11-adversarial-review.md](docs/research/2026-11-adversarial-review.md) explains what changed and why.

MIT licensed.
