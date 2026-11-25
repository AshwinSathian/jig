# Changelog

## 2.3.0 (2026-11-25)

- **CI workflow edits ask.** The `rules` gate now asks before an edit under `.github/workflows/`, because a workflow runs in CI with the repo's secrets. `JIG_GATES=observe:rules` turns that back into a log entry. Edits to `CLAUDE.md`, `REVIEW.md` and `.claude/` are still only logged, since Claude Code already prompts for `.claude/` writes.
- **The reviewer returns `rethink` in round 3.** The instruction used to say "after round 3", and in the eval it returned `rethink` in only 1 of 3 runs where Important findings were still open. It now says "in round 3", and the build skill matches. No paid run has checked the new wording yet.
- **A live hook smoke test.** `node evals/hooks-live.mjs` drives one real Claude Code session against a scratch repo with jig loaded, and checks that real Edit, Write and Bash calls reach each gate in the shape the hooks parse. Its first run passed 8 of 8 for $0.08.
- **Rounds-to-pass is gone from the reviewer eval.** With no fixed standard for "ready", the number measured the builder and the reviewer together. The round loop now reports round behaviour: the verdict sequence, and whether `rethink` came in round 3.
- A workflow path with Windows separators now asks too.
- `jig lint` no longer raises J24 on `[done]` slices. A finished slice never runs its checks again, so the warning only helped going forward.

## 2.2.0 (2026-11-25)

The rest of the verification review (rows 6 to 10).

- **Run the change, not just its tests.** `e2e` and `differential` are now check kinds. The plan skill and the plan reviewer ask for one check that runs the real app, CLI or service whenever a slice changes something a user sees. `references/fundamentals.md` adds the four property shapes (round-trip, invariant, idempotency, equivalence) and how to write a differential test: normalise the noise, and keep a list of approved differences.
- **Doctor D7** looks for a way to drive the app: a verify skill, an e2e or HTTP test runner, a runner config, `.maestro/`, or an e2e script. It's a gap only for an app, and a note for a CLI or library. A review of the first version found eight false results, and each now has a test.
- **Reviewer rounds.** jig-reviewer takes its earlier findings and the last commit it reviewed, looks only at the new diff, names a bug's whole class instead of one instance, and returns `rethink` after round 3. Severities are now Important, Nit and Pre-existing.
- **REVIEW.md checklist.** In diff mode the reviewer reads `REVIEW.md` from the plan's baseline commit and applies the `When: · Check: · Source:` entries that match. The guard skill proposes an entry only when the problem happened twice, can be seen in a diff, and survived an attempt to disprove it. You commit the file yourself.
- **Observe first.** The guard skill now starts every new gate in observe mode.
- **Reviewer eval with controls.** Separate tuning and held-out cases, a clean control for counting false positives, and plain, fresh and self-review arms. `--dry` prints the cost first, and `--regrade` re-scores saved reviews for free. In the first full run every arm found all 15 held-out defects, and none flagged the clean control. Only the fresh jig-reviewer named an unflagged schema change as a one-way door. Rounds-to-pass needs a builder in the loop, which this eval doesn't have yet. Details are in `evals/results/REPORT.md`.

## 2.1.0 (2026-11-25)

This release closes the five gaps in `docs/research/2026-11-verification-review.md`. Each fix started with a test that reproduced the gap on 2.0.1.

- **A slice can't quietly loosen its own checks.** Once a plan is approved, the edit hook asks before an edit drops a check from `checks.json`, changes its command, expectation, kind, timeout, `fast` flag or slice, or removes a protected path. Adding checks and protected paths doesn't prompt. Edits that get around the hook (Bash, another editor) show up in `jig verify`, which names every loosened check in its output and in the Log line.
- **Evidence is tied to the files it checked.** `jig verify` records `HEAD` and a fingerprint of the working tree, and the Stop hook compares trees rather than edit timestamps. A session that changes code only through `sed`, a codegen script or `git apply` now has to verify before it finishes. A session that only reads a repo that was already dirty doesn't get blocked. Committing after verifying keeps the evidence current. The fingerprint never runs `git add`, so a repo's clean filters can't run from a hook. On a 2,800-file monorepo the hook's tree hash takes about 135 ms.
- **Three rounds, then you.** The Stop hook counts failing verify runs per check. Each new failure blocks once, and on the third in a row it tells the agent to stop, say what it tried, and leave the decision to you. 2.0 blocked once per session and let every later failure through.
- **No flaky-test workarounds in checks.** `jig lint` warns on a check that retries or sleeps (J22) and rejects one that can't fail, such as `npm test || true` or a pipe into `tail` without `pipefail` (J23). J24 warns when a slice lists a check that belongs to another slice, since `jig verify` won't run it there.
- **Every slice commit says how it was verified.** `jig verify --record` prints a `Verified:` line, and the build skill puts it, or `Verified: none (<reason>)`, in each slice commit. `git log --grep 'Verified: none'` finds the rest.
- **Observe mode.** `JIG_GATES=observe` or `observe:<gate>,...` makes gates log to `.git/jig/observe.jsonl` instead of asking or blocking. A new `rules` gate logs edits to `CLAUDE.md`, `REVIEW.md`, `.claude/` and `.github/workflows/` without asking yet. An edit to those files that mentions `JIG_GATES` or `JIG_HOOKS_OFF` always asks.
- Evidence written by 2.0 has no tree fingerprint. The first stop after upgrading asks for one fresh `jig verify`.

## 2.0.1 (2026-11-25)

- First release published from GitHub Actions with npm trusted publishing and provenance.
- README: npm and release badges, installing the CLI on its own with `npx jig-plan`, updating it, and what to do when superpowers also triggers.
- SECURITY: how releases are published and how to check provenance with `npm audit signatures`.

## 2.0.0 (2026-11-25)

We rebuilt the single-file `plan-engineering` skill (1.0, July 2026) as the jig plugin. Our reasons are in `docs/research/2026-11-adversarial-review.md`.

- Plans are sized by what has to be checked and what can't be undone, with no time estimates. Tier 0 is a five-line plan in chat.
- Each plan has a short human layer you approve and an agent layer. The Log is append-only.
- `checks.json` holds executable acceptance checks. `protects` marks tests the agent may not edit without asking.
- Skills: `plan`, `build`, `guard`. Agent: `jig-reviewer`.
- Hooks: a SessionStart nudge and plan status, a protected-test and scope guard on edits, an install guard on Bash, and a Stop hook that asks for verify evidence.
- CLI: `jig new`, `lint` (rules J01 to J20), `status`, `verify --record`, `doctor` (D1 to D6).
- Evals: task, trigger and reviewer evals with isolated arms. See `evals/results/REPORT.md`.
- From running jig on a large Nx monorepo before release:
  - Plans follow the repo's own folder (`docs/plan/` as well as `docs/plans/`, or `plansDir` in `.jig.json`). Before, plans in `docs/plan/` were invisible to status, hooks and verify.
  - The Stop hook no longer counts a `jig verify` that ran no checks as evidence, and asks for plain `jig verify --record` when a slice has no fast checks.
  - A new lint warning (J21) flags acceptance checks that run a whole suite with no filter, since those pass before the feature exists.
  - Doctor names the repo's package manager and its `verify` or `check` script. It says when lint presets hide rules, finds secret files up to four levels deep, matches deny rules as globs, and reports `.githooks/` with no `core.hooksPath`. It doesn't claim CI runs, and `jig doctor --ack` quiets the agent-config review until the files change.
