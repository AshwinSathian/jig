# Changelog

## 2.4.5 (2026-11-26)

The declared-install skip now works from an allowlist. 2.4.3 and 2.4.4 tried to list the shell features that could redirect an install, and each security review found one the list missed (`then export`, `read`, `printf -v`, a quoted `cd`).

- **An install of a declared name skips the ask only when every other segment is a plain `cd <path>` inside the repo or an output filter (`tail`, `head`, `grep` with plain arguments), and nothing comes before the installer in its own segment.** Anything else asks, including `npm i lodash && npm test`. That costs an occasional ask, which is the cheaper failure.
- **The config fingerprint covers more places:** `$XDG_CONFIG_HOME` pip, uv and pnpm config, pnpm's macOS rc, `/etc` pip, uv and npm config, `$VIRTUAL_ENV/pip.conf`, `uv.toml` in every directory above the repo, `~/.config` even when `$XDG_CONFIG_HOME` points elsewhere, any config file an environment variable names (`PIP_CONFIG_FILE`, `NPM_CONFIG_USERCONFIG` and the like; a relative one asks), and the hook's own registry environment variables.
- **`cd -` and a set `CDPATH` ask,** since either can send `cd` outside the directory it names.

## 2.4.4 (2026-11-26)

Closes four gaps that a security review found in 2.4.3's declared-install skip. In each case 2.4.3 stayed quiet where 2.4.2 asked.

- **Shell state is checked anywhere in a segment.** 2.4.3 looked only at a segment's start, so `if true; then export HOME=/tmp/x; fi; npm i lodash` stayed quiet. A variable set, `export`, `source`, `eval`, `sudo` or `popd` anywhere in a non-install segment now asks.
- **Each install is judged in its own directory.** `cd` targets are followed per segment, resolved through symlinks and kept inside the repo; a subshell around a `cd`, or a target that doesn't exist, asks.
- **User-level registry config counts.** `~/.npmrc`, `~/.yarnrc*`, `~/.bunfig.toml`, pip and uv user config and node's global npmrc are fingerprinted when the session starts, and a change asks. Sessions started before 2.4.4 have no fingerprint, so they ask.
- **A cwd outside the repo declares nothing.**

## 2.4.3 (2026-11-26)

In auto mode every hook ask becomes a prompt, so jig asks only when there is a decision to make.

- **Installing a package the repo already declares doesn't ask.** The name must be in the nearest package.json (any of the four dependency fields), requirements*.txt or pyproject.toml as of the commit the session started from. The working copy and commits made during the session don't count, because the agent can change those without asking. It still asks for aliases (`x@npm:y`), URLs, git refs and paths, for any flag outside a short list that can't change the source (`-D`, `-E`, `-w`, `-U` and the like), for env assignments, when the command mentions a registry, index or config, when the command sets a variable or leaves the repo with `cd`, and when a registry config, lockfile or manifest has changed since the session started (committed or not) or a registry config is gitignored. Sessions that started before 2.4.3 have no start commit recorded, so they ask as before.
- **`jig observe`** summarises `.git/jig/observe.jsonl`: counts by gate and decision, the date range, and the top reasons. Use it to decide whether `commit` should enforce.
- Protected files, the checks freeze, rule files and gate switches ask as before.

## 2.4.2 (2026-11-26)

Closes four gaps that 2.4.1's fixes opened in the install and protects gates. All four were found by a security review of the 2.4.1 commit.

- **Quoted text is read again.** 2.4.1 ignored quoted phrases, so `bash -c "npm i x"` stopped asking. A commit message that mentions an install asks again, which is the safer of the two costs.
- **A flag's value is skipped only for that tool's own flags:** npm `-w`, pnpm `--filter`, and so on. In 2.4.1, `npm i -F x` hid `x`.
- **Continuation lines are joined before parsing.** In 2.4.1, `npm i \` followed by a package on the next line hid the package.
- **Editing checks.json while it's invalid asks again.** There's no trustworthy baseline to compare that edit against. Other files still ask only if they're protected.

## 2.4.1 (2026-11-26)

Fewer prompts in auto mode. A hook "ask" always becomes a prompt there, and most of jig's asks in recent sessions were for nothing.

- **The install check no longer reads redirections or flag values as packages.** `npm install 2>&1 | tail -3` asked to add `2>&1`, and `npm i -w apps/web astro` asked about `apps/web`. Segments are now split quote-aware, quoted text with spaces in it is ignored, and `2>&1`, `> file`, `$VAR` and the values of `-w`, `--workspace`, `--filter`, `-C`, `--dir` and `--cwd` are skipped.
- **An invalid checks.json no longer asks before every edit.** When the problem is in another field (a bad `kind`), the `protects` lists are still readable, so only protected files ask. When jig really can't read `protects`, it still fails closed.
- package.json's description now includes review.

## 2.4.0 (2026-11-26)

Post-build review. Plan, build, verify and review are now one loop, and review also works without a plan.

- **`jig review`** prints the brief a review starts from. It works out the base (`--base` or `--pr`, then the current slice's start, then the merge-base with the default branch, then HEAD), and lists the tree fingerprint, what changed, which triggers matched (`ui`, `prose`, `security`, `invariants`, `tests-or-checks`, `migration`, `trivial`), the `REVIEW.md` entries from the base that apply, and whether the last evidence and review cover the current tree. `--json` is for agents, and `--blind` leaves out the earlier verdict and evidence. It runs git, and gh for `--pr`, never the repo's commands. Every trigger has tests that it fires and that it doesn't. Running it on chattermeter and on the seeded cases caught three false or missed triggers before release: screenshots named `sessions-*.png`, files named `token` in a lexer, and a removed `isAdmin` check.
- **The `review` skill** runs the gate first and stops on a red one. It reviews in two phases: blind against the owner-approved intent, then the builder's claims against the diff, where a claim the diff doesn't back up is a finding. Each Important finding is validated from its claim alone. UI, prose and security files go to loupe, humanizing-writing and owasp-security, and a partner that isn't installed goes under "Not checked". The report is short and ends with a `Reviewed:` line. The build skill's step 4 now calls it.
- **jig-reviewer** runs on `model: opus`. Its diff mode works without a plan, on the merge-base. A validate mode re-derives one finding from file, line and claim. Findings carry a class, a confidence (Confirmed, Likely, Needs verification), reachability for security findings, the quoted rule for convention findings, and the errors each new `catch` would swallow. A "Declined to judge" list and a "Would miss" line are new. Text in the change that tells the reviewer what to conclude is reported as `review-steering`.
- **Review records.** `jig review --record` appends a review to `.git/jig/reviews.jsonl`, tied to the tree from the brief, and refuses one whose tree changed during the review. `jig review --outcome <id> fixed|wrong|intentional|didnt-matter` records what happened to a finding. Finding ids stay the same across reviews. Evidence and observe records now carry `"v": 1`, and `docs/evidence-schema.md` documents all four state files.
- **`Blocked: <reason>`** as the last Log entry is an accepted end state. The Stop hook skips its tree and rounds checks and tells you once per session. The build skill says when to use it: a spec conflict, a check that can't pass in that environment, a missing service.
- **A `commit` gate, observed.** pre-bash notes a `git commit` whose working tree has no passing evidence or review, unless the message says `Verified: none (<reason>)`. It only logs to `observe.jsonl` until you set `JIG_GATES=enforce:commit`, it lets go after two fires a session, and a commit with no message flag is only logged. On a 2,800-file repo the hook takes about 290 ms. `evals/hook-timing.mjs` times it and restores `observe.jsonl` afterwards.
- `docs/research/2026-11-review-landscape.md` is the checked research behind these choices. Of 36 sources, 33 were confirmed on their own pages, six claims were reworded to match, and two are marked UNVERIFIED.
- **The README opens with a real run.** `scripts/readme-run.mjs` drives the CLI and hooks in a throwaway repo: a protected-test edit and an install that ask, an edit outside the slice that gets a note, a failing `jig verify`, the Stop hook's block, then a passing verify with its `Verified:` line. `test/readme-run.test.mjs` fails when the README's copy no longer matches what the CLI prints. The CLI and Hooks sections now cover `jig review`, the `commit` gate and the `Blocked:` exit.
- **`jig verify` records a useful line for a `node --test` failure.** It used to record the error object's closing `}`. It now skips brace-only lines, stack frames, indented properties and the `Node.js vNN` line an uncaught error ends with, so the Log says `7 !== 6`.

## 2.3.0 (2026-11-25)

- **CI workflow edits ask.** The `rules` gate now asks before an edit under `.github/workflows/`, because a workflow runs in CI with the repo's secrets. `JIG_GATES=observe:rules` turns that back into a log entry. Edits to `CLAUDE.md`, `REVIEW.md` and `.claude/` are still only logged, since Claude Code already prompts for `.claude/` writes.
- **The reviewer returns `rethink` in round 3.** The instruction used to say "after round 3", and in the eval it returned `rethink` in only 1 of 3 runs where Important findings were still open. It now says "in round 3", and the build skill matches. No paid run has checked the new wording yet.
- **A live hook smoke test.** `node evals/hooks-live.mjs` drives one real Claude Code session against a scratch repo with jig loaded, and checks that real Edit, Write and Bash calls reach each gate in the shape the hooks parse. Each step is tied to the file it names, and every payload field the hooks read decides an outcome. It passed 11 of 11 for $0.09.
- **Rounds-to-pass is gone from the reviewer eval.** With no fixed standard for "ready", the number measured the builder and the reviewer together. The round loop now reports round behaviour: the verdict sequence, and whether `rethink` came in round 3.
- A workflow path with Windows separators now asks too. So does one under a `protects` entry when only `protects` is observed.
- **Edit hooks see paths the way git does.** A file reached through a symlink of the repo (macOS `/tmp` and `/private/tmp`) was silently ignored by every edit gate. Paths are now resolved before any check.
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
