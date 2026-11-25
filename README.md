# jig

[![CI](https://github.com/AshwinSathian/jig/actions/workflows/ci.yml/badge.svg)](https://github.com/AshwinSathian/jig/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/AshwinSathian/jig)](LICENSE)

A planning and build harness for Claude Code. jig plans the work at the size it needs, writes the acceptance checks before the code, and uses hooks to catch the ways agent work usually goes wrong: a test edited until it passes, a package that doesn't exist, edits that wander outside the task, and "done" with nothing run.

```bash
claude plugin marketplace add AshwinSathian/jig
claude plugin install jig@jig
```

Then work the way you already do, e.g. *"add CSV export to the reports page"*. A one-line fix gets a four-line plan in chat and carries on. A feature gets a short plan you approve, and then it's built one slice at a time, with the evidence written into the plan. Run `jig doctor` in a repo to see what it'd want fixed first.

**Contents:** [How it works](#how-it-works) · [What a plan looks like](#what-a-plan-looks-like) · [Hooks](#hooks) · [The CLI](#the-cli) · [Evidence](#evidence) · [Limits](#limits) · [How it compares](#how-it-compares) · [Updating and troubleshooting](#updating-and-troubleshooting)

## How it works

1. **Frame.** jig writes the outcome as something you could check, then looks for ambiguity *before* planning, as a separate step. Questions only you can answer get asked together, each with a recommended answer. Anything the repo can answer, it looks up. The rest becomes a logged assumption.
2. **Survey.** It reads the code the change touches, looking for helpers to reuse and for the repo's own test command.
3. **Size.** It picks a tier by what has to be checked and what can't be undone, never by hours.

   | Tier | You get | When |
   |---|---|---|
   | 0 | Up to five lines in chat | One reversible change that a single command proves |
   | brief | `docs/plans/<slug>/PLAN.md`, 1 to 3 slices | Several files, all reversible |
   | full | Plus `checks.json`, a reviewer pass, and a gate on one-way doors | Schema, public API, auth, data deletion, production, new dependencies |
   | program | One child plan per phase, plus ADRs | Work that can't be checked as one plan, or several people |

4. **Gate.** One-way doors stop for you:
   - schema and partition keys
   - public API contracts
   - the auth model
   - data deletion
   - production or infrastructure changes
   - new runtime dependencies
   - scope changes

   Everything else goes ahead with the assumption logged. Say "no questions" and it goes ahead on all of it, except anything destructive.
5. **Build.** The `build` skill takes one slice per session. It writes the acceptance checks from the spec first, implements, runs `jig verify --record`, logs what changed and commits. If a test and the spec disagree, it stops and tells you rather than editing the test.
6. **Guard.** The second time the same mistake turns up, the `guard` skill turns it into a test, lint rule, deny rule or hook, not another line of prose.

A `jig-reviewer` agent reviews plans, and each slice's diff, in a fresh context and backs every finding with a file and line or a command.

## What a plan looks like

The top half is for you, and it has a line budget (40 lines for a brief plan, 80 for a full one). The bottom half is for the agent.

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

## Out of scope · ## Questions · ## Assumptions

## Slices
### S1: Endpoint streams CSV [done]
Touch: `src/api/reports/export.ts (new)`
Checks: C1, C2
- Risk: cursor paging skips rows. Detect: C2 compares counts. Fallback: keyset paging.

## Log
- 2026-11-25 14:02: jig verify S1: C1 pass; C2 pass
```

`jig lint` checks it against [references/plan-format.md](references/plan-format.md):
- every done-when item is a command or a check ID
- every decision has a reason
- risks say how you'd notice them and what you'd do, with no scoring grid
- no time estimates
- the Log is append-only against the committed version

Why no estimates? Agents miss their own runtimes by a typical factor of 2.9 (AgentTime, arXiv 2610.09944). One plan jig's predecessor wrote estimated 30 weeks for work that shipped in 15 days.

## Hooks

| Hook | What it does | What it never does |
|---|---|---|
| SessionStart | One paragraph telling the model to plan code changes with jig, plus the state of any active plan | Run anything from the repo |
| Before an edit | **Asks** before a file a check protects (an acceptance test) is edited, and also when `checks.json` is invalid. Notes once per file when an edit falls outside the current slice | Return `allow`, so your own permission prompts still apply |
| Before a Bash call | **Asks** before `npm i`, `pip install`, `cargo add` and the like when they name a package | Get in the way of lockfile installs (`npm ci`, `pip install -r`) |
| Stop | If files changed since the last `jig verify`, asks the agent to run it and report the result | Run the checks itself, because `checks.json` comes from the repo and a repo can be hostile |

Turn hooks off with `JIG_HOOKS_OFF=pre-bash,stop` (or `all`), and the session nudge with `JIG_NUDGE=off`. They're guardrails, not a sandbox: a shell command can still change a file without going through the Edit tool. [SECURITY.md](SECURITY.md) says exactly what runs where.

## The CLI

`jig` is plain Node 20+ with no dependencies. It's on the Bash PATH while the plugin is enabled, and the npm package is `jig-plan`.

```
jig new <slug> --tier brief|full|program --title "..."   start a plan with the baseline commit filled in
jig lint [path ...] [--no-paths]                         check plans against the format (rules J01 to J20)
jig status                                               active plans, their Now line, the current slice
jig verify [--slice S2] [--fast] [--record]              run checks.json; --record writes the result to the Log
jig doctor                                               report harness gaps; changes nothing
```

Here's `jig doctor` on a bare repo with an `.env` file in it:

```
GAP    D1 no one-command verify (test script, make test, cargo test, go test, pytest)
GAP    D2 no ESLint or Biome config, so nothing flags empty catch blocks
GAP    D3 secret-looking files the agent can read: .env
       Suggested deny rules for .claude/settings.json (review before adding): {"permissions":{"deny":["Read(./.env)", ...]}}
ok     D4 no repo-level hooks, MCP servers or risky settings
GAP    D5 no CI configuration found
GAP    D6 package.json has dependencies but no lockfile

5 item(s) to look at. jig doctor changed nothing.
```

D4 flags repo settings that can run code or redirect API traffic before you've read them: hooks, `ANTHROPIC_BASE_URL`, `bypassPermissions`, and auto-enabled MCP servers. Those are the settings behind CVE-2025-59536, CVE-2026-21852 and CVE-2026-33068.

## Evidence

The full report, with every caveat, is [evals/results/REPORT.md](evals/results/REPORT.md). Read it as a smoke test, not a benchmark:
- most cells are a single run
- the fixtures are small
- the person who wrote jig wrote the tasks too

All runs used Claude Opus 5.5 and Claude Code 2.1.330, on 2026-11-25. Each arm ran isolated from user skills, plugins and MCP servers.

**Task evals.** There are eight fixture repos, each with one seeded trap. Commands grade them: hidden tests, `git diff` and `jig lint`. Four graders also match a regex against the final message.

| | none | jig | plan mode* | superpowers |
|---|---|---|---|---|
| Passed | 6/8 | 8/8 | 4/8 | 6/8 |
| Cost per task | $0.06 | $0.08 to $0.09 | $0.08 | $0.07 |

\* Headless plan mode can't leave plan mode, so it can't complete the tasks that need code.

What's in those numbers? Without jig, Opus 5.5 already:
- reused an existing helper
- avoided an N+1 query
- put auth on a new route
- left a spec-contradicting test alone
- refused a package that doesn't exist

jig's two wins were the tasks where the right move was to stop. It asked what "Make the export faster" meant instead of guessing, and it waited for approval before writing a schema migration. That cost about $0.02 and three turns a task, roughly a third more on tasks this small.

**Triggering.** With the SessionStart nudge, all 10 trigger prompts behaved as expected, with or without superpowers installed. Without it, direct requests like "Build a CSV export endpoint" skipped the skill altogether (0 of 3).

**Plans and review.** All three multi-slice plans jig wrote in the eval passed `jig lint`. The reviewer found 5 of 5 seeded plan defects in both runs, against 4 and 5 for a plain review in a fresh context. That's too close to call.

Re-run any of it (it spends money on your account, about $0.05 to $0.15 a run):

```bash
node evals/run.mjs --arms none,jig,planmode,superpowers --runs 3 -j 6
node evals/triggers/run.mjs --arms jig,jig+superpowers --runs 3
node evals/reviewer/run.mjs --runs 3
```

## Limits

- **Untested so far:**
  - models other than Opus 5.5
  - repos bigger than a few files
  - a multi-session build run end to end
  - self-review against fresh-context review
  - plans rated by people
- **The hooks are Claude Code only.** The skills and plan files are plain markdown, but the skills point at `${CLAUDE_PLUGIN_ROOT}`, which only Claude Code fills in.
- **It costs tokens.** The nudge is about 80 tokens a session, and planning adds a few turns a task. If you'd rather call `/jig:plan` yourself, set `JIG_NUDGE=off`.
- **The Stop hook only works with a `checks.json`.** Brief plans that list their checks as commands don't trigger it.
- **No telemetry.** The CLI and hooks make no network requests. The evals run Claude on your account, and whatever the agent does in their throwaway fixture repos.

## How it compares

- **No plugin:** Opus 5.5 on its own is strong at the code-level traps (see [Evidence](#evidence)). jig adds the stops: questions before guessing, a gate on one-way doors, checks that a test can't be quietly edited, and evidence before "done".
- **Plan mode:** a built-in approval gate with no plan format, checks or follow-through. jig works inside it, writing the plan to plan mode's file and then to `docs/plans/` once you approve.
- **[superpowers](https://github.com/obra/superpowers):** a broad skills methodology (brainstorm, spec, plan, subagent build) with no enforcing hooks. Both plugins trigger on planning requests. In our trigger eval jig fired first every time, but you'll get two planning workflows if both are on.
- **[Spec Kit](https://github.com/github/spec-kit) and [OpenSpec](https://github.com/Fission-AI/OpenSpec):** spec-driven workflows built around spec, plan and task files, working with many agents. jig keeps the plan short, sizes it to the task, and puts its weight on executable checks and hooks rather than on the spec documents.
- **[AgentOps](https://github.com/boshu2/agentops):** engineering-practice skills with published evals. It's the closest in spirit, and its evidence section is the model ours follows.

jig works alongside [loupe](https://github.com/AshwinSathian/loupe) and [humanizing-writing](https://github.com/AshwinSathian/humanize-writing-skill) when they're installed. A UI slice gets a loupe review, and plan prose and PR descriptions follow humanizing-writing.

## Updating and troubleshooting

```bash
claude plugin marketplace update jig && claude plugin update jig@jig   # update
claude plugin details jig                                               # what's installed and its token cost
claude plugin uninstall jig@jig                                         # remove
```

- **jig never fires:** check `claude plugin details jig` lists the hooks, and that `JIG_NUDGE` isn't `off`.
- **An install keeps asking:** that's the pre-bash hook. Approve it once the package checks out, or set `JIG_HOOKS_OFF=pre-bash`.
- **The agent won't finish:** the Stop hook wants `jig verify` evidence. Run `jig verify --fast --record`, or tell it plainly which check can't run, and why.
- **A plan fails lint:** `jig lint <path>` prints each rule ID and line. The rules are in [references/plan-format.md](references/plan-format.md).

## Contributing

Issues, especially plans jig got wrong and hooks that misfired, are the most useful thing you can send. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). The design is in [docs/design.md](docs/design.md), and the research behind it is in [docs/research/](docs/research/). jig replaces an earlier single-file skill, `plan-engineering`, and [the review](docs/research/2026-11-adversarial-review.md) explains what changed.

MIT licensed.
