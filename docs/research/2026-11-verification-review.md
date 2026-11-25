# Review: how the Claude Code team verifies agent work

Reviewed 2026-11-25. The main source is Addy Osmani's "How the Claude Code team thinks about verification" (claude.dev, 2026-11-16). I read these alongside it:

- "How the Claude Code team does code review" (Osmani, Westlee Lunt, Wang, 2026-10-15)
- "A practical guide to shipping with Claude Code" (Osmani, 2026-11-24)
- "Lessons from building Claude Code: how we use skills" (Shihipar, 2026-06-03)
- "Building verification loops in Claude Code with skills" (de Oliveira, 2026-07-22)
- the `/goal` and REVIEW.md docs pages
- "Using a chaos loop to harden the Claude Docs launch" (Nair, 2026-11-17)
- "Safely scaling multi-agent teams with Claude Fable 5.2" (Zhang et al., 2026-11-09)

Every number below is the team reporting on itself. None of it has been replicated outside Anthropic.

## Verdict

jig already does most of what these posts recommend. Completion has to be shown with evidence, acceptance tests are protected, one-way doors go to a person, a fresh-context reviewer checks the work, and a mistake seen twice becomes a mechanism. One principle in the main post is something jig breaks: "If a change can modify the check that judges it, the check is broken." Reading the code turned up two places where it breaks it. It also lacks three things the team relies on: a cap on fix rounds, verification tied to a specific commit, and running the change end to end.

## Gaps found in jig's code

1. **A slice can edit its own checks.** `preEdit` returns early for any file under the plans directory ([hooks.mjs:100](../../cli/lib/hooks.mjs#L100)), and `checks.json` is not in `protects` unless someone lists it. So an agent can change a check's `cmd`, loosen its `expect`, or drop a `protects` entry without being asked, and then edit the test it just unprotected. `jig verify` runs whatever `checks.json` is in the working tree. Code Review avoids the same problem by reading REVIEW.md only from the base branch.
2. **Edits made through Bash never trigger the Stop hook.** `editedAt` is set only by the Edit and Write hook ([hooks.mjs:69](../../cli/lib/hooks.mjs#L69)), and `stop` returns early when it is zero ([hooks.mjs:166](../../cli/lib/hooks.mjs#L166)). If a session changes code only with `sed -i`, a codegen script, `git apply` or `mv`, it can finish without verifying. The post's phrasing: "A passing review on an out-of-date commit means nothing." jig's evidence records a time ([verify.mjs:40](../../cli/lib/verify.mjs#L40)) but not which tree it checked.
3. **Fix rounds have no limit.** The build skill says to fix the code and verify again ([build/SKILL.md:43](../../skills/build/SKILL.md#L43)), with no cap. The team's rule is that a check still failing after three rounds goes to a person, and `/ship` pushes at most three times per issue and then reports what it tried. The Stop hook makes things worse: it blocks on a failure only once per session ([hooks.mjs:180](../../cli/lib/hooks.mjs#L180)), so the second and later failures get no prompt at all.
4. **Flaky tests have no rule.** The team doesn't let Claude skip a flaky test, add sleeps, or retry until it passes. When the root cause can't be found, the test is deleted and the reason written down. jig says nothing about flaky tests, and a retry loop in a check's `cmd` would pass lint.
5. **Nothing asks the agent to run the change.** "Running the app end to end matters more than tests." The check kinds in [checks.mjs:4](../../cli/lib/checks.mjs#L4) have no `e2e` or `differential`. `jig doctor` looks for a one-command verify but not for a way to start and drive the app, such as a `.claude/skills/verify/SKILL.md`.

## What jig should take, ranked by value for the effort

| # | Change | Source | Size |
|---|---|---|---|
| 1 | Freeze `checks.json` once a plan is approved. The pre-edit hook asks before any edit to it while the plan's status is `approved` or `building`. `jig verify` compares it with the version committed at approval and names any changed check in its output and the Log line. | "Changes can't modify their own checks" | S |
| 2 | Tie evidence to the tree. `jig verify` records `HEAD` plus a hash of `git diff HEAD` and the untracked files. The Stop hook compares the current fingerprint with the last evidence, instead of timestamps from the Edit hook, which also closes the Bash gap. | "a passing review on an out-of-date commit means nothing" | S |
| 3 | Three rounds, then a person. The build skill stops after three failed verify rounds on the same check and reports what it tried. The Stop hook counts consecutive failures per check in `evidence.jsonl` and says so, rather than blocking only once. | Verification post, `/ship` | S |
| 4 | A flaky-test rule in the build skill and `failure-modes.md`: no retries, sleeps or skips. Find the cause, or delete the test and log why (deleting a protected test already asks). Add a lint warning for `retry`, `--retries` or `sleep` in a check's `cmd`. | Verification post | XS |
| 5 | A verification stamp on every slice commit: a `Verified:` trailer carrying the `jig verify` line, or `Verified: none (<reason>)`. Then `git log --grep 'Verified: none'` lists the unverified commits. | "stamp each commit with how it was verified" | XS |
| 6 | Run the change. Add `e2e` and `differential` to the check kinds. The plan skill asks for at least one check that runs the real system when the slice changes behaviour a user can see. Doctor adds D7: a gap when there's no `verify` skill and no e2e runner. `fundamentals.md` gets the property shapes the post lists (round-trip, invariant, idempotency, equivalence) and the rules for differential tests (normalize noise, keep a list of approved differences). | "Verification means running the change" | M |
| 7 | Reviewer rounds. jig-reviewer takes earlier findings as input, re-reviews only the new diff, never repeats a finding, flags the class of bug rather than one instance, and asks the builder to rethink the approach after three rounds. Adopt the Important / Nit / Pre-existing severities, so a builder isn't held responsible for old bugs. | Code review post; the team found that stacking a second reviewer is worse than tuning the first | S |
| 8 | Diff-triggered checklist. The guard skill can write a past incident as a checklist entry with three parts: a trigger readable from a diff, the check, and the incident or PR behind it. Diff mode in the reviewer reads `REVIEW.md` from the base branch with `git show <base>:REVIEW.md` and applies only the entries whose trigger matches. A rule gets promoted only if it happened twice, can be seen in a diff, and survived an attempt to disprove it. Prune the list on a schedule. | 39-item checklist, "Turn misses into rules" | M |
| 9 | Observe mode for gates the guard skill proposes: a new hook logs what it would have blocked before it enforces anything. | "Start a new gate in observe mode" | XS (guidance only) |
| 10 | Reviewer eval with controls. Add clean, merged changes to `evals/reviewer` to count false positives, keep a fixed test set apart from the tuning set, and track rounds-to-pass. This is the "self-review vs fresh-review" eval that's still open. | "Test your checks on what actually matters" | M |

## Checked and left out

- **`/goal`.** It's a session-scoped prompt Stop hook. Its evaluator reads only the conversation and runs no commands. A goal such as "`jig verify S2` reports every check passing, or stop after 20 turns" works with jig unchanged, so this is a one-line tip for the build skill, not code.
- **Claude Approvals, PR Steward and `/ship`.** These are hosted services, some of them billed, and they overlap the gates in jig's `team.md`. Linking them from `team.md` is enough.
- **Moving the doctor acks to `${CLAUDE_PLUGIN_DATA}`.** The skills post mentions this directory. Acks in `~/.config/jig` work, and moving them would orphan the acks people already have.
- **Multi-agent fan-out, chaos loops, and voting among several bug finders.** They cost too much for jig's solo-first reader. The chaos-loop rule (try easy-to-undo changes, stop and offer options for hard-to-undo ones) is what jig's one-way-door gate already does.
- **The "up to 10 points" grader result.** It comes from internal testing on structured file generation. It supports keeping the separate reviewer, but it doesn't measure anything jig does.
