---
name: review
description: Reviews a change after it is built, with or without a jig plan. It gets the brief from `jig review`, gates on `jig verify` or the repo's verify command, reviews blind against the owner's intent and then against the builder's claims, validates each Important finding, sends UI, prose and security files to their partner skills, and records a review tied to the working tree. Use after building with jig, when a jig plan's slice is done, or to review a jig plan's diff, slice or branch. Not for a generic "review this PR" with no jig context, which the built-in /code-review covers.
allowed-tools: Read Glob Grep Bash(jig review:*) Bash(jig status:*) Bash(gh pr view:*) Bash(git diff:*) Bash(git log:*) Bash(git show:*) Bash(git status:*)
argument-hint: --base <ref>, --pr <number>, or nothing (the doing slice)
---

# Review

Deterministic checks decide, and a model's review advises. A model checking its own work without outside feedback doesn't reliably catch its errors, so the gate runs first and a red gate ends the review. The reviewer reads the change before it reads the builder's account of it, because a persuasive description gets bad changes approved.

## 1. Brief

Run `jig review --json`, adding `--base <ref>` or `--pr <number>` if you were given one. Read:
- `base`, `head`, `how` and `fallback`: what is being compared, and any step that was skipped to get there
- `files`, `stats` and `triggers`: what changed, and which partners apply
- `intent`: the owner-approved part of the plan, when there is one
- `reviewMd`: REVIEW.md entries from the base that match, and those left for the reviewer to judge
- `checks`, `gate`, `evidence`: what the gate runs, and whether the last `jig verify` covers this tree
- `round` and `review`: the round number on this base, and the last review's head and findings

If it prints an error, report it and stop.

**Someone else's code:** with `--pr`, or when the commits aren't the builder's in this session, ask the owner before step 2 runs anything. Running a PR's tests runs its author's code on this machine.

## 2. Gate

- **With checks.json:** if `evidence.current` and `evidence.pass` are true and `evidence.slice` is the brief's `slice`, the gate already passed for this tree. Say so. Otherwise run `jig verify` (with `--slice <id>` when the brief names a slice).
- **Without:** when `gate.D1.level` is `ok`, run the first command in `gate.D1.commands`. Also run the runner `gate.D7` names when its level is `ok`.
- **No gate at all:** put "Not checked: no gate (no checks.json and no one-command verify)" in the report. The verdict can't be `ready` with nothing run.

**A red gate ends the review.** Report the failing check and its deciding line, and stop. Don't model-review code that fails its own checks.

**Light path:** when `triggers` has `trivial` (a small docs-only diff), run the gate and one reviewer pass (step 3, phase 1 only), then go to step 6. Put the skipped partners under Not checked, with "light path" as the reason.

## 3. Review in two phases

**Phase 1.** Run `jig review --json --blind`, which leaves out the earlier verdict and the evidence record. Start the `jig-reviewer` agent in diff mode, and tell it "Phase 1 only". Give it:
- with a plan: the plan path and slice ID
- without one: the base and head from the brief, and the owner's request or the linked issue as the spec
- the blind brief's JSON
- the brief's `round`. On round 2 or later, also the earlier findings (`review.findings`) and the last reviewed commit (`review.head`)

Don't give it the plan's Log, commit messages, the PR description or your own summary of the work. It returns its Phase 1 findings and stops.

**Phase 2.** Use SendMessage to send the same agent (its ID from the Phase 1 call) the builder's claims: the PR title and body (`gh pr view <n> --json title,body` for a PR), the `evidence` from the full brief, and your summary of what was done and verified. If you can't reach it, start a new `jig-reviewer` with the Phase 1 findings quoted verbatim, then the claims. It checks each claim against the diff and the evidence, and can add findings but not remove them. Because the claims arrive only after the Phase 1 findings exist, the blind pass is blind by construction.

## 4. Validate the Important findings

For each Important finding, start a fresh `jig-reviewer` in validate mode. Give it only the claim, `file:line: <the defect>`, never the finder's evidence or reasoning. Run these in parallel.
- `confirmed`: keep the finding, with the validator's evidence.
- `dropped`: remove it, and count it in the report.

Don't validate Nits or Pre-existing findings. Don't retry a dropped finding, and don't count a second run of the same model as a second vote.

**The verdict after validation:** `rethink` if the reviewer returned it. Otherwise `fix first` while a confirmed Important finding remains, else `ready`. Don't let the gate's absence give `ready` (step 2).

## 5. Partners

Each partner reviews only the files its trigger matched, so none of them becomes a second reviewer of the code.

| Trigger | Partner | Files | Notes |
|---|---|---|---|
| `ui` | loupe | the trigger's files | the screens those files render |
| `prose` | humanizing-writing | prose an agent wrote in this change | the files in `voice` are people-facing docs (README, CHANGELOG, docs/, SECURITY, CONTRIBUTING) and use the owner's voice profile when humanizing-writing has one. In jig's own repo that's `voices/ashwin-sathian.md`. Skills, agents and references get the plain rules and no voice. |
| `security` | owasp-security | the trigger's files | its Important findings are validated like the reviewer's (step 4) |

humanizing-writing excludes proofreading a person's own writing, so run it only on prose an agent wrote in this change, and say that in the report. Prose a person wrote, such as most of a PR you didn't build, goes under Not checked with that reason.

A partner that isn't installed goes under "Not checked", with the reason. Never skip one silently. loupe and humanizing-writing findings are listed under the partner's name and don't change the verdict.

## 6. Record

Write the findings JSON to a scratch file outside the repo:

```json
{ "base": "<from the brief>", "head": "<from the brief>", "tree": "<from the brief>", "verdict": "fix first",
  "findings": [{ "severity": "Important", "confidence": "Confirmed", "file": "src/a.js", "line": 12, "class": "swallowed-error", "title": "catch drops the parse error" }],
  "dropped": 1 }
```

Record only the findings that are kept: the reviewer's, after validation, and owasp-security's confirmed ones. `dropped` is the count from step 4. Each finding's `title` is the reviewer's one-line finding, word for word. For a finding still open from an earlier round, reuse its earlier `title` and `class`, so it keeps its id.

Then run `jig review --record <file>`. It prints the `Reviewed:` trailer. If jig refuses because the tree changed, files moved during the review: run the brief again and review the new diff, rather than recording the old review against the new tree.

## 7. Report

Keep it short. Long review comments get acted on less, and AI review can slow a change down.

```
Verdict: <ready | fix first | rethink> · Gate: <the jig verify line, or the command and its result> · Validator: <n> confirmed, <m> dropped
1. [Important] [Confirmed] <class>: <finding>. <file:line>. Fix: <inline fix>.
... at most five shown, Important first, then Confirmed before Likely
<k> more: <one line each, folded>
Partners: <which ran, on which files>
Not checked: <each with its reason>
Declined to judge: <from the reviewer>
Would miss: <one line on what these checks would miss here>
Reviewed: <verdict>, <n> findings (tree <short>)
```

The owner's attention is the audit budget, so the top five carry the report. `ready` with no findings is a normal result.

## Replies, rounds and outcomes

- **The builder answers a finding only with evidence:** a run, or a file:line. A prose rebuttal goes to the owner, never back to the reviewer, because models flip correct answers when asked whether they're sure.
- **Three rounds, then the owner.** On round 3 with Important findings still open, the reviewer returns `rethink`. Stop and take the approach to the owner.
- **Outcomes:** when a finding is settled, record it with `jig review --outcome <id> fixed|wrong|intentional|didnt-matter`. The finding ids are in the record. These outcomes are how jig learns which findings were worth raising.
