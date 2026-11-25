# Close the open items after 2.2.0

Status: building · Tier: brief · Baseline: 3aded02 · Updated: 2026-11-25
Now: S3 in progress. S1 and S2 done.

## Outcome
Every item left open after the 2.2.0 release is decided and in the code or docs: workflow edits ask, the reviewer eval stops claiming a metric it can't measure, a live session has exercised the hooks, jig-v2 is closed, and the docs agree with what was measured.
Done when:
- `npm test` passes, including new tests for the workflow ask and the J24 rule on done slices
- `node evals/hooks-live.mjs` reports every gate entry expected from a live Claude Code session
- `node cli/jig.mjs lint docs/plans` prints no errors and no J24 warnings

## Decisions
- The rules gate asks before edits under `.github/workflows/`. CLAUDE.md, REVIEW.md and `.claude/` stay logged only. Reason: workflows run in CI with secrets and are rarely touched in normal work. Claude Code already prompts for `.claude/` writes in `default` and `acceptEdits` mode (permission-modes docs, "Protected paths"), and CLAUDE.md edits are usually legitimate. `JIG_GATES=observe:rules` still turns the ask into a log entry. The docs promise that only `deny` holds in `bypassPermissions`, so a person who picks that mode skips this ask too. Rejected: asking on every rule file, which doubles Claude Code's prompt and fires on ordinary CLAUDE.md work.
- Drop rounds-to-pass as a metric. Keep the round loop, reported as round behaviour. Reason: the number measures builder and reviewer together, with no fixed standard for "ready", so a lower number can just mean a laxer reviewer. The loop still tests S8's finding tracking and its rethink after round 3. Rejected: a builder-in-the-loop eval, about $3 to $8 for a number that can't be anchored.
- A live hook smoke eval, `evals/hooks-live.mjs`, run on demand and not in CI. It drives one Claude Code session in observe mode on a scratch fixture repo and asserts the gate log. Reason: the Edit and Write payload shapes were only ever checked against the docs (verification-loops S1 risk).
- Close jig-v2 S5 and mark that plan shipped. Reason: S5's check (C5) passes. The 3-run eval was a wish on the Now line, not a Done-when item. The old skill was removed, which was the one-way door that waited on the evals. README and REPORT already call the evals smoke-scale.
- J24 skips `[done]` slices. Reason: it warns about checks that won't run for a slice, and a finished slice won't run again. Rewriting a shipped slice's history to quiet a warning is worse.

## Out of scope
- Deprecating `jig-plan@0.0.0-stage`: it needs the owner's npm credentials. The command is in the hand-off.

## Questions
- None.

## Assumptions
- One live session (a few dollars at most, capped at $1 by `--max-budget-usd`) is enough as a smoke test, because each assertion is a yes or no about a payload shape.

## Slices

### S1: Workflow ask and J24 on done slices [done]
Goal: an Edit or Write under `.github/workflows/` asks (gate `rules`), CLAUDE.md, REVIEW.md and `.claude/` are logged only, and `jig lint` gives no J24 for `[done]` slices.
Touch: `cli/lib/hooks.mjs`, `cli/lib/lint.mjs`, `test/observe.test.mjs`, `test/lint.test.mjs`, `evals/dogfood-hooks.mjs`, `README.md`, `CHANGELOG.md`, `docs/plans/verification-loops/PLAN.md`
Checks: `npm test`, `node cli/jig.mjs lint docs/plans`

### S2: Eval honesty and the live hook smoke [done]
Goal: rounds-to-pass is gone from the grader and the report. `evals/hooks-live.mjs` exists and has passed once. README and REPORT agree on models, case counts and what is still untested.
Touch: `evals/reviewer/grade.mjs`, `evals/reviewer/run.mjs`, `test/reviewer-grade.test.mjs`, `evals/hooks-live.mjs (new)`, `evals/results/REPORT.md`, `README.md`
Checks: `npm test`, `node evals/hooks-live.mjs`
- Risk: the model edits with Bash or Write instead of Edit, so a payload shape goes untested. Detect: the script checks the tool stream and reports the run invalid. Fallback: name the exact tool in the prompt and rerun once.

### S3: Close jig-v2 [doing]
Goal: jig-v2 is shipped, with S5 done and a closing Log line, and its Now line matches the facts.
Touch: `docs/plans/jig-v2/PLAN.md`
Checks: `node cli/jig.mjs lint docs/plans`, `node cli/jig.mjs status`

## Log
- 2026-11-25: Plan started at 3aded02.
- 2026-11-25: Decisions came from an adversarial review of the open items, which the owner delegated ("decide and lock them in"). Approved by agent under that delegation: no gate applies, since there are no one-way doors or destructive steps. The workflow ask changes behaviour, and README and CHANGELOG will say so.
- 2026-11-25: S1 done. Two new tests failed first. A Write to `.github/workflows/ci.yml` now asks with gate `rules`, keeps the scope note, and becomes a log entry under `JIG_GATES=observe:rules`. Only the root workflows folder asks. The existing rules-gate test no longer expects workflows to be logged, because that spec changed with this plan's first Decision. J24 now skips `[done]` slices, which leaves one warning on jig-v2's S5 (still `[doing]`, closed in S3). Dogfood on a scratch clone of chattermeter: 13 sessions, 11 expected entries, 0 unexpected, 0 missed. `npm test` gives 167 pass.
- 2026-11-25: S2 done. Rounds-to-pass is replaced by round behaviour in `grade.mjs`. Its protected test assertion changed with that Decision, and the old behaviour is kept as a comment in the test. Regrading the saved run with no spend found a contract gap: in round 3, with Important findings still open, the reviewer returned rethink in 1 of 3 runs and fix first in the other 2. The instruction said "after round 3", which reads as a round 4 that never comes. It now says "in round 3" in the agent and the build skill. No paid run has checked the new wording. A background security review found the workflow check missed Windows separators. A new test failed on the old code, and both checks now share one helper. `evals/hooks-live.mjs` passed 8 of 8 on its first live run ($0.08): real Edit, Write and Bash payloads reached freeze, protects, rules and tree, adding a check raised nothing, and every entry carried the real session id. README and REPORT now agree on models (Opus for tasks and triggers, Sonnet for the reviewer eval), the nine task fixtures, and what is still untested.
