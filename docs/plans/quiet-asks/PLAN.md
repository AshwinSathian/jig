# Fewer false asks (2.4.1)

Status: shipped · Tier: brief · Baseline: ae0e226 · Updated: 2026-11-26
Now: Done. 2.4.1 released, then 2.4.2 for the security review's four findings.

## Outcome
In auto mode a hook "ask" always becomes a prompt, so jig asks only when there is something to decide. `npm install 2>&1` and `npm i -w apps/web astro` no longer name `2>&1` or `apps/web` as packages, and a checks.json that's invalid in a field other than `protects` no longer asks before every edit in the repo.
Done when:
- `node --test test/quiet-asks.test.mjs` passes, and failed before the fix
- `npm test` passes

## Decisions
- A checks.json whose `protects` lists are still readable is judged as usual: only protected files ask, and the plan-status and checks freezes still run. Unparseable JSON or malformed `protects` still fails closed. Reason: transcripts from 2026-11-25 to 26 had 16 asks from one bad `kind` in the jig repo, and the existing fail-closed test (hooks.test.mjs) covers the case where jig really can't tell. Rejected: no longer failing closed at all, which would weaken that test.
- The install parser splits segments quote-aware, drops quoted text that has spaces in it, and skips redirections and the values of `-w`, `--workspace`, `--filter`, `-C`, `--dir` and `--cwd`. Reason: 13 of the 15 install asks in those transcripts named something that wasn't a package.

## Out of scope
- Changing what an ask means in auto mode (for example a note instead of an ask). That's an owner decision with a safety cost, and it's in the next prompt.

## Questions
- None.

## Assumptions
- The owner's "handle all the items left" covers merging this PR and releasing 2.4.1, as it did for 2.4.0.

## Slices

### S1: Quiet the two false asks [done]
Goal: the Outcome, with tests that fail without each fix.
Touch: `cli/lib/hooks.mjs`, `test/quiet-asks.test.mjs (new)`, `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `cli/jig.mjs`, `CHANGELOG.md`
Checks: `node --test test/quiet-asks.test.mjs`

## Log
- 2026-11-26: Plan started at ae0e226.
- 2026-11-26: Approved by agent; no gate applied (brief tier, no one-way doors). Cause found by counting jig's asks in local transcripts: 37 since 2.0.1 was installed, 36 of them in auto mode, made up of 16 invalid checks.json, 15 installs (13 false) and 6 protects (all correct).
- 2026-11-26: S1 done. quiet-asks 8/8 (failed 3 of 3 before the fix), `npm test` 355/355, eslint clean. package.json's description now names review; it still said "Plan, verify and guard".
- 2026-11-26: A security review of the 2.4.1 commit found four gaps, and all four were real: quoted-phrase stripping hid `bash -c "npm i x"`, generic `-F`/`-C` skips hid a package, reading only a segment's first line dropped continuation lines, and editing checks.json while invalid compared against the invalid file. 2.4.2 fixes each one with a test. It also removes the 2.4.1 assertion that a commit message mentioning an install stays quiet, because that behaviour was the first gap.
