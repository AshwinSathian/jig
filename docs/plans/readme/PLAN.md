# README: a real run, and the gaps

Status: shipped · Tier: brief · Baseline: 7b15b19 · Updated: 2026-11-26
Now: Done on branch `readme`, stacked on `review-loop`. A PR waits for PR #7.

## Outcome
The README shows a real jig run near the top: hooks asking before a protected-test edit and an install, a note on an edit outside the slice, a failing `jig verify`, the Stop hook blocking, then a passing verify with its `Verified:` line. A script makes that section from the current CLI, and a test fails when the README's copy no longer matches. The CLI and Hooks sections cover `jig review` and the `commit` gate.
Done when:
- `node --test test/readme-run.test.mjs` passes, and fails after any edit inside the README's run section
- `npm test` passes
- `node cli/jig.mjs lint docs/plans` passes

## Decisions
- The run comes from `scripts/readme-run.mjs`, which builds a temp repo, drives `cli/jig.mjs` and `jig hook <event>` with scripted payloads, and writes the result between `<!-- run:start -->` and `<!-- run:end -->` markers. Reason: output the README shows can't drift from what the CLI prints. Rejected: a GIF or recording, which can't be copied or kept current.
- Output is real, with three normalisations the section states: durations become `(…s)`, the temp path becomes `~/demo`, and hook JSON is shown as its decision and message. Commits use a fixed author and date, so the tree hashes and SHAs are the same on every run. Reason: without these the test would fail on every machine.
- The children run with `CLAUDE_PROJECT_DIR`, `JIG_GATES`, `JIG_HOOKS_OFF` and `JIG_NUDGE` cleared, and every payload sets `cwd`. Reason: hooks take their root from `CLAUDE_PROJECT_DIR` when `cwd` is missing, and the gate variables would silence the run.

## Out of scope
- A site, and the social preview image. The image goes to `~/Downloads` for the owner to upload in the repo settings; it isn't committed.

## Questions
- None.

## Assumptions
- PR #7 is still open, so this branch stacks on `review-loop` and its PR targets that branch until #7 merges.

## Slices

### S1: The generated run [done]
Goal: `scripts/readme-run.mjs` writes the run into the README, and `--check` exits 1 when the README differs. `test/readme-run.test.mjs` runs the check, and also shows that it fails on an edited copy of the README.
Touch: `scripts/readme-run.mjs (new)`, `test/readme-run.test.mjs (new)`, `README.md`, `cli/lib/verify.mjs`, `test/deciding-line.test.mjs (new)`, `CHANGELOG.md`
Checks: `node --test test/readme-run.test.mjs`
- Risk: output differs across Node 20, 22 and 24 or between macOS and Linux. Detect: CI's three Test jobs. Fallback: normalise the differing field and say so in the section.

### S2: The gaps and a writing pass [done]
Goal: the CLI block lists `jig review`. The Hooks table and gate list cover the `commit` gate (observed by default, `JIG_GATES=enforce:commit`) and the `Blocked:` exit. The Contents line links the new section. New and changed prose passes humanizing-writing with the owner's voice profile.
Touch: `README.md`
Checks: `npm test`

## Log
- 2026-11-26: Plan started at 7b15b19.
- 2026-11-26: Approved by agent; no gate applied (brief tier, no one-way doors, no open questions). The owner chose a README over a site.
- 2026-11-26: Scope change in S1: the first generated run showed `jig verify` recording `}` as why a `node --test` check failed, because the deciding line was the last non-empty line. `lastLine` in cli/lib/verify.mjs now skips brace-only lines, stack frames and indented properties. `test/deciding-line.test.mjs` failed before the change and passes after. Added to Touch with CHANGELOG.md.
- 2026-11-26: Two traps fixed in the script. Under `npm test`, the fixture's `node --test` inherited `NODE_TEST_CONTEXT` and passed as a subtest, so the script drops it. `jig new` writes today's date, which would change the tree hash daily, so the script pins it.
- 2026-11-26: S1 and S2 done. `node --test test/readme-run.test.mjs` 4/4, and it failed before the script existed. `npm test` 346/346, `npx eslint@10.15.0 .` clean, `jig lint docs/plans` ok. Not checked: Node 20 and 22 and Linux, which CI covers.
