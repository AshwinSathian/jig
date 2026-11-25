# Verification loops

Status: building · Tier: full · Baseline: 9bffbb5 · Updated: 2026-11-25
Now: S6 dogfood and release 2.1.0 in progress. S1 to S5 done.

## Outcome
jig closes the five gaps in [the verification review](../../research/2026-11-verification-review.md): a slice can't loosen its own checks without a person seeing it, evidence is tied to the working tree, failing checks get three rounds and then go to the owner, check commands can't retry or swallow failure, and every slice commit says how it was verified. 2.2.0 adds end-to-end check kinds, reviewer rounds, a diff-triggered checklist and a reviewer eval with clean controls.
Done when:
- `jig verify --plan docs/plans/verification-loops/PLAN.md` passes every check (C1 to C25, R2 to R11)
- `gh pr checks` shows Test 20/22/24 and Secret scan passing on the 2.1.0 and 2.2.0 PRs
- `npm view jig-plan version` prints 2.2.0 after the owner's release, and `npm audit signatures` passes in a scratch dir

## Decisions
- The checks.json freeze compares by check id: new ids and new `protects` entries pass silently; a removed id, a removed `protects` entry, or any change to `cmd`, `expect`, `kind`, `timeout_s`, `fast` or `slice` asks. An edit whose result doesn't parse asks. Reason: build step 2 adds checks every slice, so a blanket ask would fire constantly.
- `jig verify` stores a hash of each check's frozen fields and its sorted `protects` list. It names any check whose hash changed, or that lost a `protects` entry, compared with the plan's previous record. When there's no earlier record, it compares with `git show HEAD:<checks.json>` and says which one it used. Reason: Bash edits skip the hook. Reporting only removals keeps added protected files quiet. Rejected: the plan's Baseline commit, because it predates the checks, and the approval commit, because nothing records it.
- The Stop hook compares **tree ids only**. `HEAD` is recorded for the trailer but not compared. Reason: the build skill commits after verifying, so comparing `HEAD` would make every committed slice stale.
- The tree id is a sha256 over `git ls-files -z --cached --others --exclude-standard`: each path with its type and raw bytes, leaving out plan Markdown files and keeping checks.json. Git runs through `git.mjs`. When git fails and the tree comes back null, the hook falls back to the `editedAt` logic. The tree is computed after the checks run, so build output a check writes doesn't make its own record stale. Reason: the first version used `git add -A` into a temporary index with `git write-tree`, and that runs clean filters from `.git/config`, which is a command the hook would run outside the sandbox (shown by a test). Hashing with `ls-files` runs no filters, writes no objects and takes no index lock. It measured 130 ms p50 on chattermeter. Changed 2026-11-25, see Log.
- SessionStart stores the tree id only if the session has none yet. Reason: its matcher includes `resume` and `compact`, and overwriting the id there would forget changes made earlier in the session.
- The "can't fail" rule (`|| true`, `; exit 0`, `|| :`) gets its own id, J23, as a lint error, and doesn't extend J17. Reason: J17 comes from `validateChecks`, which the edit hook also calls and fails closed on, so every edit in the repo would ask. Retries and sleeps are J22, a warning.
- Observe mode ships in 2.1.0. `JIG_GATES=observe` covers every gate, and `JIG_GATES=observe:freeze,tree,rounds` covers only the named ones (gate names: `protects`, `install`, `freeze`, `tree`, `rounds`). The guard skill's observe-first guidance stays in 2.2.0. Reason: the 2.1.0 dogfood runs the new gates in observe mode, so the code has to exist by then, and naming gates lets one new gate start in observe mode while the old ones keep enforcing. This moves part of row 9 into the first milestone.
- A `rules` gate asks before edits to REVIEW.md, CLAUDE.md, `.claude/**` and `.github/workflows/**`. It ships observed by default in 2.1.0, whatever `JIG_GATES` says, until the owner decides from the observe log whether it enforces. Reason: owner's answer, observe first.
- The dogfood drives the working-tree hooks with scripted hook payloads on the chattermeter clone (an Edit that loosens a check, a Bash-only change, repeated failures, rule-file edits), not headless Claude sessions. Reason: the owner declined that API spend. The observe log then measures false positives on those payloads only, not on a real session.
- Every slice has its own `npm test` regression check (C2, R2 to R11), and a new lint warning, J24, flags a slice whose `Checks:` line names another slice's check. Reason: `jig verify` selects checks by `slice`, so a check that S1 owns never runs in S2.
- Severity rename (blocker/major/minor to Important/Nit/Pre-existing). Reason: the review's source. The reviewer eval grades topics by regex and doesn't parse severities, so its graders don't change. S8 checks that.
- Dogfood runs on a `git clone --local` of chattermeter in the scratchpad. Reason: hooks write `.git/jig` state and the fingerprint writes blobs, and the owner asked for chattermeter to stay read-only. A clean checkout gives the same tree (it had 0 changed files at survey).
- [one-way] Publish 2.1.0 and 2.2.0 to npm. Reason: published versions can't be reused. The owner merges and releases; I open the PRs. Decided: owner 2026-11-25

## Out of scope
- `/goal`, Claude Approvals, PR Steward, `/ship`, moving acks, chaos loops and multi-agent voting, which the review checked and left out.
- Closing jig-v2 S5. It stays `[doing]`, so every `jig verify` here passes `--plan`.

## Questions
- None. Answered 2026-11-25: rule files get an observe-first gate, and the dogfood skips API spend.

## Assumptions
- PreToolUse input shapes: Edit has `old_string`, `new_string` and `replace_all`; Write has `content`; MultiEdit has `edits[]`. An Edit whose `old_string` isn't in the file stays silent, because the tool fails on its own.
- Rounds count per plan and per check id, from that check's last passing record. Each new failing record blocks once, and from round 3 on the reason says to stop and report to the owner.
- Evidence written before 2.1.0 has no tree id. The hook treats it as stale and says so.
- Outside git, the Stop hook keeps the `editedAt` timestamp logic.
- Skill and agent text checks are `grep` presence checks. They show the rule is written down, not that a model follows it. S10 is the only behavioural test of the reviewer.
- I skip a `mutation` check on the freeze diff. Each frozen field gets its own test case, so removing any one comparison fails a test.

## Slices

### S1: Freeze checks.json [done]
Goal: an Edit, Write or MultiEdit that loosens an existing check asks while the plan is approved or building; additions are silent; `jig verify` records per-check hashes and names changed checks in its output and Log line. First test reproduces gap 1 on the current code.
Touch: `cli/lib/hooks.mjs`, `cli/lib/checks.mjs`, `cli/lib/verify.mjs`, `cli/jig.mjs`, `test/freeze.test.mjs (new)`, `test/helpers.mjs (new)`, `test/hooks.test.mjs`
Note: `test/helpers.mjs` takes `hook()` and `planRepo()` out of `hooks.test.mjs`. `tempRepo` stays in `verify.test.mjs`.
Checks: C1, C2
- Risk: real Edit payloads differ from the assumed shape. Detect: a `claude --plugin-dir .` run in an isolated config dir that loosens a check gets no ask. Fallback: ask on any checks.json edit whose result can't be computed.

### S2: Evidence fingerprint [done]
Goal: evidence records carry `head` and `tree`; the Stop hook blocks when the tree differs from both the session-start tree and the last evidence, including when code changed only through Bash. First test reproduces gap 2.
Touch: `cli/lib/git.mjs`, `cli/lib/verify.mjs`, `cli/lib/hooks.mjs`, `test/fingerprint.test.mjs (new)`, `evals/hook-timing.mjs (new)`
Checks: C3, C4, R2
- Risk: hashing every file is slow on a repo with large untracked files. Detect: `evals/hook-timing.mjs` exits 1 when p50 reaches 1000 ms (C4); S6 and S11 run it with `JIG_TIMING_REPO` set to the chattermeter clone. Fallback: skip files whose size and mtime match the last run, cached in `.git/jig`.

### S3: Three rounds [done]
Goal: the Stop hook blocks once per new failing record, and at round 3 says to stop and report the three attempts; build step 4 says the same. First test reproduces gap 3.
Touch: `cli/lib/hooks.mjs`, `cli/lib/verify.mjs`, `skills/build/SKILL.md`, `test/rounds.test.mjs (new)`
Checks: C5, C6, R3

### S4: Flaky checks and Verified trailer [done]
Goal: lint warns on retry and sleep in a check (J22), errors on a check that can't fail (J23), and warns on a slice that lists another slice's check (J24); `jig verify --record` prints a `Verified:` line; build step 5, failure-modes.md and team.md carry the rules.
Touch: `cli/lib/lint.mjs`, `cli/lib/verify.mjs`, `cli/jig.mjs`, `test/lint.test.mjs`, `test/verify.test.mjs`, `skills/build/SKILL.md`, `references/failure-modes.md`, `references/team.md`, `references/plan-format.md`
Checks: C7, C8, C9, R4

### S5: Observe mode [done]
Goal: with `JIG_GATES=observe`, every ask or block is appended to `.git/jig/observe.jsonl` and the hook prints nothing. With `observe:<gates>`, only the named gates are observed, and the rest still ask. Context-only output is unchanged. The `rules` gate exists and is always observed.
Touch: `cli/lib/hooks.mjs`, `test/observe.test.mjs (new)`, `evals/dogfood-hooks.mjs (new)`
Checks: C10, R5

### S6: Dogfood and release 2.1.0 [doing]
Goal: doctor, lint and the hooks in observe mode run on the chattermeter clone; a Log line starting "observe-mode dogfood 2.1.0" gives the observe event count, false positives and hook p50; versions are bumped, the CHANGELOG and README are updated where behaviour changed, and the PR is open with CI green.
Touch: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `cli/jig.mjs`, `CHANGELOG.md`, `README.md`, `evals/dogfood-hooks.mjs (new)`
Checks: C11, C12, C24, R6

### S7: Running the change [todo]
Goal: `e2e` and `differential` are check kinds; doctor reports D7 (with the level chosen from the jig and chattermeter runs); fundamentals.md has the four property shapes and the differential rules; the plan-mode reviewer asks for one real-system check per user-visible slice.
Touch: `cli/lib/checks.mjs`, `cli/lib/doctor.mjs`, `test/doctor.test.mjs`, `references/fundamentals.md`, `references/plan-format.md`, `agents/jig-reviewer.md`, `skills/guard/SKILL.md`
Checks: C13, C14, C15, R7

### S8: Reviewer rounds [todo]
Goal: jig-reviewer takes earlier findings and a last-reviewed commit, reviews only the new diff after round 1, never repeats a finding, flags the class of a bug, returns `rethink` after round 3, and uses Important / Nit / Pre-existing; build step 4 passes it what it needs.
Touch: `agents/jig-reviewer.md`, `skills/build/SKILL.md`, `evals/reviewer/run.mjs`
Checks: C16, C17, R8

### S9: Diff-triggered checklist and observe-first [todo]
Goal: diff mode applies `When: · Check: · Source:` entries from `git show <Baseline>:REVIEW.md`; the guard skill proposes entries with the three-part bar, leaves the commit to the owner, adds pruning, and recommends observe mode for new gates.
Touch: `agents/jig-reviewer.md`, `skills/guard/SKILL.md`, `references/mechanisms.md`
Checks: C18, R9

### S10: Reviewer eval with controls [todo]
Goal: grading moves to `evals/reviewer/grade.mjs`, with recall, false positives on clean controls and rounds-to-pass; the eval has separate tuning and test cases and self-review and fresh-review arms; the dry-run cost is reported, the owner agrees to the full run, and the result goes into REPORT.md.
Touch: `evals/reviewer/run.mjs`, `evals/reviewer/grade.mjs (new)`, `evals/reviewer/cases/ (new)`, `test/reviewer-grade.test.mjs (new)`, `evals/results/REPORT.md`
Checks: C19, C20, R10
- Risk: the self-review arm isn't really self-review, because a pasted plan isn't the session's own work. Detect: the arm's transcript shows it treating the plan as someone else's. Fallback: the session writes the plan from the request in the same run, reviewed against defects that appear in its own output, and the report labels the arm.

### S11: Dogfood and release 2.2.0 [todo]
Goal: same as S6 for 2.2.0 (Log line "observe-mode dogfood 2.2.0"), plus D7 on the chattermeter clone and on jig.
Touch: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `cli/jig.mjs`, `CHANGELOG.md`, `README.md`
Checks: C21, C22, C23, C25, R11

## Log
- 2026-11-25: Plan started at 9bffbb5.
- 2026-11-25: Survey. 69 tests pass in 4.0 s. A fingerprint spike on chattermeter (2,805 tracked files, clean) took 364 ms cold and 93 ms warm with an empty temp index, and 112 to 118 ms with a copied index, giving the same tree. Changes to the design brief, from the code: tree-only comparison (commits move HEAD), tree computed after the checks run, session-start tree stored once, J23 split from J17, observe mode moved to 2.1.0, and the reviewer eval graders don't parse severities.
- 2026-11-25: jig-reviewer plan review: fix first, 10 findings, all applied. Each slice gets its own regression check, and J24 is added. The verify freeze falls back to HEAD and tracks `protects` removals. Observe mode can name gates. C4 enforces 1000 ms. The temp index is per process, and a null tree falls back to `editedAt`. Added a filter risk, version checks in C11 and C21, and dogfood Log checks C24 and C25. `helpers.mjs` holds only the hook helpers.
- 2026-11-25: Owner approved the plan. Answers: the rule-file gate goes observe-first (the `rules` gate, always observed in 2.1.0), and the observe-mode dogfood uses no headless sessions, so it drives the hooks with scripted payloads. The reviewer eval still needs the owner's yes after its dry run.
- 2026-11-25 19:27: jig verify S1: C1 pass; C2 pass
- 2026-11-25 19:29: jig verify S1: C1 pass; C2 pass
- 2026-11-25: S1 done. Gap 1 reproduced first: 5 of 7 new freeze tests failed on 9bffbb5, including a plain Edit that loosened C1's `cmd`. The pre-edit hook now applies the Write, Edit or MultiEdit to checks.json in memory and asks when a check is removed, a frozen field changes or a `protects` entry is dropped. Evidence records carry per-field hashes, and `jig verify` names loosened checks against the last logged record (or HEAD). The jig-reviewer diff pass found 5 issues, all fixed: a plain verify could absorb a Bash edit before the Log saw it (now compared against records that wrote a Log line), an unreadable HEAD checks.json was silent, the replace_all test passed vacuously, and `lastEvidence` parsed the whole file. The payload shapes were checked against the Claude Code hooks docs, not a live run, because the owner declined API spend.
- 2026-11-25 19:31: jig verify S2: C3 pass; C4 pass; R2 pass
- 2026-11-25 19:34: jig verify S2: C3 pass; C4 pass; R2 pass
- 2026-11-25 19:35: jig verify: C4 pass
- 2026-11-25: S2 done. Gap 2 reproduced first: 5 of 8 new fingerprint tests failed on ac794f4, including a session that changed `src/a.js` with no Edit hook and stopped unblocked. Evidence now records `head` and `tree`, and the Stop hook blocks when the tree moved since session start (or an Edit ran) and differs from the last evidence. A commit after verifying leaves the evidence current. Design change: a background security review and the diff reviewer both flagged that `git add` into a temp index runs `.git/config` clean filters outside the sandbox, and a scratch repo confirmed it, so the tree is hashed from `git ls-files` in Node instead. The diff review also found that excluding the whole plans directory hid checks.json edits (now only PLAN.md files are left out), and that sessions starting before a plan was active never got a start tree (now taken at the first PreToolUse call too). Hook timing (fresh node process computing the tree): jig 41 ms p50, chattermeter clone 133 ms p50 and 142 ms max, against a 1000 ms budget.
- 2026-11-25 19:36: jig verify S1: C1 pass; C2 pass
- 2026-11-25: S1 follow-up from a background security review of `ac794f4`. Four fail-open paths were each reproduced by a new test before the fix. A check id such as `constructor` resolved on the object prototype and threw inside the hook, so snapshots now use null-prototype objects and `Object.hasOwn`. An Edit the hook can't apply now asks. A path spelled in another case is matched by inode. An edit that moves an active plan out of approved or building (for example to draft) asks, since that would lift the freeze. Marking a plan shipped now asks once, which is the owner's call anyway.
- 2026-11-25 19:38: jig verify S3: C5 pass; C6 pass; R3 pass
- 2026-11-25: S3 done. Gap 3 reproduced first: 4 of 5 new rounds tests failed on 77d744d, including a second failing verify in one session that got no block. The Stop hook now counts consecutive failing records per check, for this plan only, back to that check's last pass. Each new failing record blocks once. At round 3 the reason says to stop, report each attempt and the current error to the owner, and not try again. Evidence records keep the failure reason (200 chars) so the hook can quote it. Build step 4 states the same rule.
- 2026-11-25 19:40: jig verify: C1 pass; C3 pass; C5 pass
- 2026-11-25: S2 follow-up from two background security reviews. An unreadable untracked file made `treeId` throw before the protected-test check ran, so the pre-edit hook failed open. A new test reproduced it. Each file is now hashed in its own try (unreadable files by size and mtime), FIFOs and devices are never opened, and the start tree is taken after the protection checks. An Edit to an active PLAN.md that the hook can't simulate now asks, matching checks.json.
- 2026-11-25: S3 diff review: ready, 5 minor findings, all applied. `cli/lib/verify.mjs` is added to S3's Touch, because evidence records now keep the failure reason. Rounds are now counted per active plan from that plan's own current record. Before, a later verify of a second plan hid the first plan's round 3, which this repo would hit with jig-v2 also in progress. The cross-plan test now fails without the fix. A dead regex alternative is removed. The round-3 reason allows continuing when the owner says so. A ponytail note marks the full evidence parse.
- 2026-11-25 19:41: jig verify S3: C5 pass; C6 pass; R3 pass
- 2026-11-25 19:42: jig verify S4: C7 pass; C8 pass; C9 pass; R4 pass
- 2026-11-25 19:43: jig verify S4: C7 pass; C8 pass; C9 pass; R4 pass
- 2026-11-25: S4 done. Seven new lint mutations failed before the rules existed. J22 warns on a check that retries or sleeps, J23 errors on one that can't fail (`|| true`, `|| :`, `; exit 0`), and J24 warns on a slice that lists another slice's check. The mutation table takes an optional level for warnings. J24 found four such cases in jig-v2's plan, which are left as warnings because that plan is out of scope. `jig verify --record` prints a `Verified:` line for the commit, and build step 5, failure-modes.md, team.md and plan-format.md carry the rules.
- 2026-11-25: S4 diff review: fix first, 6 findings, all taken. J23 now looks only at how a command ends, so a cleanup step such as `pkill x || true; npm test` passes. It also catches `|| echo`, `; true`, a trailing comment, and a pipe into `tail`, `head` or `tee` without `pipefail`. J22 no longer matches tests named "retry". It adds `retries=N`, `while …; do` and `for …; do … break`. Eight negative commands and seven new mutations cover these cases. The trailer keeps the owner's `(tree <short>)` format, and team.md says the value is jig's fingerprint, not a git tree id.
- 2026-11-25 20:03: jig verify S4: C7 pass; C8 pass; C9 pass; R4 FAIL (exit 1 (expected 0): })
- 2026-11-25 20:04: jig verify S4: C7 pass; C8 pass; C9 pass; R4 pass
- 2026-11-25: The first S4 re-verify above failed R4 because `npm test` picked up S5's untracked `observe.test.mjs`, which fails until S5 lands. I moved it aside and verified again (the line above). The fix commit was amended so its trailer reports that run.
- 2026-11-25 20:05: jig verify S5: C10 pass; R5 pass
- 2026-11-25: S5 done. Three of four new observe tests failed before the change. Every ask and block now names its gate (protects, freeze, install, tree, rounds). With `JIG_GATES=observe` (all gates) or `observe:<gates>`, `runHook` appends the decision to `.git/jig/observe.jsonl` and prints nothing. Context-only output is unchanged. The new rules gate (REVIEW.md, CLAUDE.md, `.claude/`, `.github/workflows/`) only logs, in any repo, until the owner decides from the log. `evals/dogfood-hooks.mjs` moves to S6, where it is used.
- 2026-11-25 20:08: jig verify: C10 pass; R5 pass
- 2026-11-25: S5 diff review: ready, 4 minor findings, all applied. The rules gate now matches CLAUDE.md, REVIEW.md and `.claude/` at any depth, as Claude Code reads them. An edit that writes `JIG_GATES` or `JIG_HOOKS_OFF` into a rule file now asks. It has no gate name, so observe mode can't silence it. Before, such an edit could switch every gate off and only be logged. A test now checks that a rule-file edit keeps its scope warning, and `evals/dogfood-hooks.mjs` is added to S6's Touch.
- 2026-11-25 20:10: jig verify: C10 pass; R5 pass
- 2026-11-25: S5 follow-up from a background security review of `c6d9cca`. A new test reproduced three bypasses of the switches ask: an Edit that assembled `JIG_GATES` from existing text, a `_` escape in JSON, and a `.CLAUDE/` path on a case-insensitive filesystem. The ask now compares the switch names in the whole file before and after the edit, decoding JSON first. Rule paths are compared in lower case. An Edit to a rule file that can't be simulated asks. A Bash edit can still set a switch, as it can bypass every edit hook.
