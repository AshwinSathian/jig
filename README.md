# jig

[![CI](https://github.com/AshwinSathian/jig/actions/workflows/ci.yml/badge.svg)](https://github.com/AshwinSathian/jig/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/jig-plan?label=npm%20jig-plan)](https://www.npmjs.com/package/jig-plan) [![Release](https://img.shields.io/github/v/release/AshwinSathian/jig)](https://github.com/AshwinSathian/jig/releases) [![License: MIT](https://img.shields.io/github/license/AshwinSathian/jig)](LICENSE)

A planning and build harness for Claude Code. jig plans the work at the size it needs, writes the acceptance checks before the code, and uses hooks to catch the ways agent work usually goes wrong: a test edited until it passes, a package that doesn't exist, edits that wander outside the task, and "done" with nothing run.

```bash
claude plugin marketplace add AshwinSathian/jig
claude plugin install jig@jig
```

Only want the CLI, say for CI or a repo where you don't run Claude Code? It's on npm as `jig-plan`, with no dependencies:

```bash
npx jig-plan doctor            # or: npm install -g jig-plan, then `jig doctor`
```

Then work the way you already do, e.g. *"add CSV export to the reports page"*. A one-line fix gets a four-line plan in chat and carries on. A feature gets a short plan you approve, and then it's built one slice at a time, with the evidence written into the plan. Run `jig doctor` in a repo to see what it'd want fixed first.

## A real run

This is jig's own output, from a throwaway repo with one plan and one acceptance test. The `#` lines stand in for the agent, and everything else is what the CLI and hooks print. In a session, Claude Code shows an `ask` as a permission prompt, and a `block` sends the agent back to work with the reason. [`scripts/readme-run.mjs`](scripts/readme-run.mjs) generates the section, and a test fails if it drifts from what the current CLI prints. Durations show as `(…s)`, and each hook's JSON is cut down to its decision and message.

<!-- run:start -->
```console
$ jig status
Plans live in docs/plans/ (set "plansDir" in .jig.json to change).
Order totals (docs/plans/totals/PLAN.md) · building · 0/1 slices done
  Now: S1, totals.
  Doing: S1 Totals · touch: src/total.js, test/

# The agent goes to edit the acceptance test. Before an edit:
ask: jig: test/total.accept.test.js is protected by check C1 in docs/plans/totals/PLAN.md. Acceptance tests come from the spec; edit one only when the spec changed, and log the decision in the plan.

# It reaches for a package. Before a Bash call:
ask: jig: this adds left-pad (npm). A new dependency is a one-way door: check that the name is the real package (hallucinated names get registered by attackers), its age and downloads, and record it in the plan's Decisions.

# It edits a file the slice doesn't list:
note: jig: src/format.js is outside S1's Touch list (src/total.js, test/). If the slice needs it, add it to Touch with a Log line; otherwise leave it for its own slice.

# It changes src/total.js with a bug and runs the checks:
$ jig verify
FAIL C1 (…s) node test/total.accept.test.js
     exit 1 (expected 0): 7 !== 6
0/1 passed

# It says "done". The Stop hook:
block: jig (docs/plans/totals/PLAN.md): the last `jig verify` had failing checks (C1). Rounds so far: C1 (round 1 of 3). Fix the code, not the check, and verify again, or tell the user plainly they are failing; don't describe the slice as done.

# It fixes the bug:
$ jig verify --record
PASS C1 (…s) node test/total.accept.test.js
1/1 passed · recorded in the plan Log

For the slice commit:
Verified: S1 C1 pass (tree c5f5e00)

# It stops again:
(nothing: the hook lets it through)
```
<!-- run:end -->

**Contents:** [A real run](#a-real-run) · [How it works](#how-it-works) · [What a plan looks like](#what-a-plan-looks-like) · [Review](#review) · [Hooks](#hooks) · [The CLI](#the-cli) · [Evidence](#evidence) · [Limits](#limits) · [How it compares](#how-it-compares) · [Updating and troubleshooting](#updating-and-troubleshooting)

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
6. **Review.** Once a slice's checks pass, the `review` skill reviews the diff (see [Review](#review)). So the loop is plan → build → verify → review.
7. **Guard.** The second time the same mistake turns up, the `guard` skill turns it into a test, lint rule, deny rule or hook, not another line of prose.

A `jig-reviewer` agent reviews plans, and each slice's diff, in a fresh context and backs every finding with a file and line or a command. It tags each finding Important, Nit or Pre-existing, so nobody gets held to a bug they didn't write. On a second pass it only looks at what changed and doesn't repeat itself. If Important findings are still open after three rounds, it says to rethink the approach. If your repo has a `REVIEW.md` of `When: · Check: · Source:` entries, it applies the ones that match the diff, reading the file from the plan's baseline commit so the slice can't edit its own checklist.

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

## Review

The `review` skill runs after a slice is built and `jig verify` is green. It also works without a plan, on a branch or a PR.

1. `jig review` works out what to compare: `--base` or `--pr` if you give one, otherwise the start of the slice you're on, then the merge-base with your default branch, then HEAD for uncommitted work. It prints a brief: the tree fingerprint, what changed, which triggers matched, and the `REVIEW.md` entries from the base that apply. It runs git, and gh for `--pr`, and never your repo's own commands.
2. The gate runs first: `jig verify`, or your test command when there's no plan. A red gate ends the review there. On someone else's PR it asks before running anything, because that runs their code.
3. jig-reviewer reads the change blind first. It gets the parts of the plan you approved (or your request), the diff and the repo, but not the Log, the commit messages or the PR text. Only after its findings exist does it get the builder's account, and it checks each claim against the diff. A claim the diff doesn't back up is a finding, and so is a comment telling the reviewer what to conclude.
4. Each Important finding goes to a fresh validator that sees only the file, the line and the defect claimed, never the reasoning. It confirms the finding from the code or drops it, and the report counts what it dropped.
5. The red team (jig-redteam) gets one attempt to write failing tests in a throwaway worktree. jig:review re-runs each one in clean head and base worktrees, and a repro counts only if it fails on head and passes on base. The brief's tamper signals (removed or edited assertions, skips, edited checks, a check retried on the same tree) and, when that session built the change, the builder's transcript go to the second phase. They can raise suspicion, never clear a finding.
6. UI files go to loupe, prose an agent wrote goes to humanizing-writing, and security-sensitive files go to owasp-security, if you have them installed. If you don't, the report says so under "Not checked".
7. The review is recorded in `.git/jig/reviews.jsonl` against the tree it reviewed, and the report ends with a `Reviewed:` line to put in the commit beside `Verified:`. [docs/evidence-schema.md](docs/evidence-schema.md) describes the format, so CI can read it without jig.

The report leads with the verdict and the gate's result, shows five findings at most, and lists what it didn't check.

When a finding is settled, `jig review --outcome <id> fixed|wrong|intentional|didnt-matter` records it, and `jig review --outcome <review id> missed --file <path> --note "<what>"` records something a review let through. `jig review --propose` turns those, plus reverts and `fix:` commits after a `ready` review, into `Suppress:` and REVIEW.md proposals. It writes nothing: REVIEW.md is yours. Only style and upkeep classes can be suppressed.

Two hooks go with it: the `Blocked:` exit and the `commit` gate (see [Hooks](#hooks)).

## Hooks

| Hook | What it does | What it never does |
|---|---|---|
| SessionStart | One paragraph telling the model to plan code changes with jig, plus the state of any active plan | Run anything from the repo |
| Before an edit | **Asks** before a file a check protects (an acceptance test) is edited, and also when `checks.json` is invalid. Once a plan is approved, also asks when an edit would loosen `checks.json` (drop a check, change its command or expectation, unprotect a file) or move the plan out of approved or building. New checks and new protected files go through without a prompt. Notes once per file when an edit falls outside the current slice | Return `allow`, so your own permission prompts still apply |
| Before a Bash call | **Asks** before `npm i`, `pip install`, `cargo add` and the like when they name a package. Notes a `git commit` whose tree has no passing `jig verify` or `ready` review, unless the message says `Verified: none (<reason>)` | Get in the way of lockfile installs (`npm ci`, `pip install -r`) |
| Stop | If the working tree changed since the session started and doesn't match the last `jig verify`, asks the agent to run it and report the result. That catches changes made through Bash too. Each new failing run blocks once, and on the third failure of the same check it tells the agent to stop and bring you what it tried. A builder that can't finish as specified (a test contradicts the spec, a check can't run here) writes `Blocked: <reason>` as the last Log line, and the hook lets the session end and tells you why | Run the checks itself, because `checks.json` comes from the repo and a repo can be hostile |

Turn hooks off with `JIG_HOOKS_OFF=pre-bash,stop` (or `all`), and the session nudge with `JIG_NUDGE=off`. To try a gate before trusting it, `JIG_GATES=observe` (or `observe:freeze,tree,rounds`) makes the gates write what they'd have asked or blocked to `.git/jig/observe.jsonl` and stay quiet; `jig observe` counts those events by gate and decision and lists the top reasons. The gates are `protects` (protected files, and an invalid `checks.json`), `freeze` (loosening checks, or changing an approved plan's status), `install` (every install that names a package), `tree` and `rounds`. `rules` asks before an edit to a CI workflow under `.github/workflows/`, since workflows run with your repo's secrets. Edits to `CLAUDE.md`, `REVIEW.md` and `.claude/` only get logged: editing CLAUDE.md is usually ordinary work, and Claude Code already asks before writes to `.claude/`. `commit` starts observed: it only logs until you set `JIG_GATES=enforce:commit`, so you can see how often it would ask first. An edit to one of those files that mentions `JIG_GATES` or `JIG_HOOKS_OFF` always asks, observe mode or not. They're guardrails, not a sandbox: a shell command can still change a file without going through the Edit tool. [SECURITY.md](SECURITY.md) says exactly what runs where.

## The CLI

`jig` is plain Node 20+ with no dependencies. It's on the Bash PATH while the plugin is enabled, and the npm package is `jig-plan`.

```
jig new <slug> --tier brief|full|program --title "..."   start a plan with the baseline commit filled in
jig lint [path ...] [--no-paths]                         check plans against the format (rules J01 to J24)
jig status                                               active plans, their Now line, the current slice
jig verify [--slice S2] [--fast] [--record]              run checks.json; --record writes the result to the Log
                                                         and prints a Verified: line for the commit
jig doctor [--ack]                                       report harness gaps; --ack marks the repo's agent config as read
jig review [--base <ref> | --pr <n>] [--json] [--blind]  the brief for reviewing a change: base, tree, files, triggers
jig review --record <findings.json>                      record a review against the tree; prints a Reviewed: line
jig review --outcome <id> fixed|wrong|intentional|didnt-matter   settle a finding
jig review --outcome <review id> missed --file <path> --note "<what>"   record what a review missed
jig review --propose [--json]                            Suppress and REVIEW.md proposals from outcomes; writes nothing
```

Here's `jig doctor` on a bare repo with an `.env` file in it:

```
GAP    D1 no one-command verify (test script, make test, cargo test, go test, pytest)
GAP    D2 no ESLint or Biome config, so nothing flags empty catch blocks
GAP    D3 secret-looking files the agent can read: .env
       Suggested deny rules for .claude/settings.json (review before adding): {"permissions":{"deny":["Read(./.env)", ...]}}
ok     D4 no repo-level hooks, MCP servers or risky settings
GAP    D5 no CI configuration or git hooks found
GAP    D6 package.json has dependencies but no lockfile
note   D7 no e2e runner or verify skill; fine for a CLI or library if a check runs the real command

5 item(s) to look at. jig doctor changed nothing.
```

Plans go in your repo's existing plans folder (`docs/plans/` or `docs/plan/`), or wherever `.jig.json` says with `{"plansDir": "..."}`.

D4 flags repo settings that can run code or redirect API traffic before you've read them: hooks, `ANTHROPIC_BASE_URL`, `bypassPermissions`, and auto-enabled MCP servers. Those are the settings behind CVE-2025-59536, CVE-2026-21852 and CVE-2026-33068. Once you've read them, `jig doctor --ack` keeps D4 quiet until one of those files changes. Doctor never runs repo code, so where a lint preset or CI status can't be read from the files, it says so rather than guessing. D7 asks whether there's a way to run the change, not just test it: a `.claude/skills/verify*` skill, an e2e or HTTP test runner, or an e2e script. It's only a gap for an app (a UI or server framework in its dependencies). A CLI or library gets a note.

## Evidence

The full report, with every caveat, is [evals/results/REPORT.md](evals/results/REPORT.md). Read it as a smoke test, not a benchmark:
- most cells are a single run
- the fixtures are small
- the person who wrote jig wrote the tasks too

The task and trigger runs used Claude Opus 5.5, and the reviewer eval used Sonnet 5.5 (the default `claude -p` model in an isolated config), all on Claude Code 2.1.330 on 2026-11-25. Each arm ran isolated from user skills, plugins and MCP servers.

**Task evals.** There are nine fixture repos, each with one seeded trap. The ninth, writing a plan file, ran on jig only. Commands grade them: hidden tests, `git diff` and `jig lint`. Four graders also match a regex against the final message.

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

**Plans and review.** All three multi-slice plans jig wrote in the eval passed `jig lint`. The reviewer found 5 of 5 seeded plan defects in both runs, against 4 and 5 for a plain review in a fresh context. That's too close to call. `evals/reviewer/` now keeps a held-out test case apart from the one we tune on, adds a clean plan as a control, and has a same-session self-review arm. In that run (Sonnet 5.5, 3 runs per cell), plain, fresh and self-review all found 15 of 15 held-out defects, and none flagged the clean plan. The one difference: only the fresh reviewer called an unflagged schema change a one-way door that needs your decision (3 of 3, against 0 of 3 each). So jig's case for a separate reviewer rests on its rubric more than on the fresh context. The details, including what went wrong in the first run, are in [the report](evals/results/REPORT.md).

Re-run any of it (it spends money on your account, about $0.05 to $0.15 a run):

```bash
node evals/run.mjs --arms none,jig,planmode,superpowers --runs 3 -j 6
node evals/triggers/run.mjs --arms jig,jig+superpowers --runs 3
node evals/reviewer/run.mjs --dry      # one review, prints the cost estimate
node evals/reviewer/run.mjs --runs 3
```

## Limits

- **Untested so far:**
  - models other than Opus 5.5 and Sonnet 5.5
  - repos bigger than a few files
  - a multi-session build run end to end (one live session has driven the hooks: `node evals/hooks-live.mjs`)
  - fresh review beating self-review on more than one held-out case
  - plans rated by people
- **The hooks are Claude Code only.** The skills and plan files are plain markdown, but the skills point at `${CLAUDE_PLUGIN_ROOT}`, which only Claude Code fills in.
- **It costs tokens.** the always-on cost is about 470 tokens a session (the skill and agent descriptions; 2.4.x measured 430 with `claude plugin details jig`, and 2.5.0's estimate scales that by its 2,578 characters of descriptions), and the nudge adds about 80 more. Planning adds a few turns a task. If you'd rather call `/jig:plan` yourself, set `JIG_NUDGE=off`.
- **The Stop hook only works with a `checks.json`.** Brief plans that list their checks as commands don't trigger it.
- **Review is new and barely measured.** No eval has yet shown that the blind first pass, the validator or the partner routing find more real bugs than a plain review. 2.5.0's eval is meant to. The tests on the review skill and the reviewer show the rules are written down, not that a model follows them.
- **The red team's limits are a prompt, not a sandbox.** jig-redteam is told to write only test and repro files, use no network and leave `.env*` alone, and nothing enforces that: plugin agents can't carry hooks or a permission mode, and Bash can reach the network. The controls: it works in a throwaway worktree, only its new repro files leave it, jig:review re-runs each one in clean head and base worktrees before it counts, and jig:review asks before it runs on someone else's PR.
- **Tamper signals are line patterns, and they can be evaded.** They flag removed or edited assertions, skips, `exit(0)`, edited checks and any changed test line with a comment or string delimiter, but some language's syntax will hide an assertion they don't see. Six security reviews in a row each found a new form. A signal only raises suspicion: the reviewer model reading the diff is the backstop, and a clean signal list proves nothing.
- **The router's triggers are path and line patterns.** They over-match on purpose, since a missed trigger skips a partner. A security trigger only means owasp-security gets a look.
- **No telemetry.** The CLI and hooks make no network requests. The evals run Claude on your account, and whatever the agent does in their throwaway fixture repos.

## How it compares

- **No plugin:** Opus 5.5 on its own is strong at the code-level traps (see [Evidence](#evidence)). jig adds the stops: questions before guessing, a gate on one-way doors, checks that a test can't be quietly edited, and evidence before "done".
- **Plan mode:** a built-in approval gate with no plan format, checks or follow-through. jig works inside it, writing the plan to plan mode's file and then to `docs/plans/` once you approve.
- **Built-in `/code-review`, `/security-review` and `/simplify`:** `/code-review` checks a diff for correctness bugs, `/security-review` looks for vulnerabilities in the branch's changes, and `/simplify` cleans up changed code and applies the fixes. jig's review is for the end of a jig build: it gates on the plan's checks, reads the diff before the builder's account of it, and records a review tied to the tree. For a quick review with no plan, the built-ins are the lighter tool.
- **[superpowers](https://github.com/obra/superpowers):** a broad skills methodology (brainstorm, spec, plan, subagent build) with no enforcing hooks. Both plugins trigger on planning requests. In our trigger eval jig fired first every time, but you'll get two planning workflows if both are on.
- **[Spec Kit](https://github.com/github/spec-kit) and [OpenSpec](https://github.com/Fission-AI/OpenSpec):** spec-driven workflows built around spec, plan and task files, working with many agents. jig keeps the plan short, sizes it to the task, and puts its weight on executable checks and hooks rather than on the spec documents.
- **[AgentOps](https://github.com/boshu2/agentops):** engineering-practice skills with published evals. It's the closest in spirit, and its evidence section is the model ours follows.

jig works alongside [loupe](https://github.com/AshwinSathian/loupe) and [humanizing-writing](https://github.com/AshwinSathian/humanize-writing-skill) when they're installed. A UI slice gets a loupe review, and plan prose and PR descriptions follow humanizing-writing.

## Updating and troubleshooting

```bash
claude plugin marketplace update jig && claude plugin update jig@jig   # update the plugin
npm install -g jig-plan@latest                                          # update the standalone CLI, if you use it
claude plugin details jig                                               # what's installed and its token cost
claude plugin uninstall jig@jig                                         # remove
```

- **jig never fires:** check `claude plugin details jig` lists the hooks, and that `JIG_NUDGE` isn't `off`.
- **An install keeps asking:** that's the pre-bash hook. Approve it once the package checks out, or set `JIG_HOOKS_OFF=pre-bash`.
- **The agent won't finish:** the Stop hook wants `jig verify` evidence for the files as they are now. Run `jig verify --fast --record`, or tell it plainly which check can't run, and why. If a check has failed three times running, the hook asks the agent to stop and report, and the call on what happens next is yours.
- **Two planning workflows at once:** superpowers' skills also trigger on planning requests. In our trigger eval jig fired first on every planning prompt with both installed, but if you'd rather have one, `claude plugin disable superpowers@claude-plugins-official` turns superpowers off.
- **A plan fails lint:** `jig lint <path>` prints each rule ID and line. The rules are in [references/plan-format.md](references/plan-format.md).

## Contributing

Issues, especially plans jig got wrong and hooks that misfired, are the most useful thing you can send. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). The design is in [docs/design.md](docs/design.md), and the research behind it is in [docs/research/](docs/research/). jig replaces an earlier single-file skill, `plan-engineering`, and [the review](docs/research/2026-11-adversarial-review.md) explains what changed.

MIT licensed.
