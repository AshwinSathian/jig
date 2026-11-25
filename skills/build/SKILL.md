---
name: build
description: Carries out an approved jig plan one slice at a time. It resumes from the plan's Now line, writes the acceptance checks before the code, implements, runs `jig verify --record`, logs what changed, and commits. Use when continuing or executing a plan under docs/plans/, when asked to work the next slice or pick up where a previous session stopped, or right after the plan skill hands off.
allowed-tools: Read Glob Grep Bash(jig status:*) Bash(jig lint:*) Bash(git status:*) Bash(git diff:*) Bash(git log:*)
argument-hint: plan path or slice ID (optional)
---

# Build

Work one slice per session. A long session degrades as context fills, and it tends to take on too much and declare victory early. The plan file holds everything a fresh session needs.

## 1. Resume

Run `jig status`, then read the plan: its human layer, the slice you're working on, and the last few Log entries. Run `git status` and `git log -3`, so you start from what's actually there, not from memory.

- **A slice already `[doing]`:** continue it. Check its Log lines to see how far it got.
- **Otherwise:** take the first `[todo]` slice, mark it `[doing]`, and update `Now:`. Set the plan's status to `building` if it's still `approved`.
- **The plan isn't approved:** stop and send the owner back to it. Building an unapproved plan skips the gate they rely on.

Run the repo's fast checks before changing anything. If they already fail, log that and tell the owner, so their failures aren't blamed on your work.

## 2. Checks first

For each acceptance check in the slice that doesn't exist yet, write it from the spec (the plan's Outcome and the slice Goal) before writing the code it checks. Run it and confirm it fails for the right reason. A check that passes before the feature exists is checking nothing.

List each acceptance test file under `protects` in `checks.json`. From then on, the edit hook asks before anyone changes it.

**If a test and the spec disagree, stop.** Don't edit the test to make it pass, and don't special-case the code to satisfy it. Report the conflict to the owner with both sides quoted. Editing tests to go green is the most common way agents fake progress, and it's the one prompts least reliably prevent.

## 3. Implement

- **Stay inside the slice's `Touch:` list.** If you need another file, add it to Touch and say why in the Log. The edit hook warns when you go outside it.
- **Reuse before adding.** Before writing a new helper, search for an existing one.
- **Let failures show.** Don't add an empty or broad `catch`, or a fallback that hides an error, to get past a problem. Handle the error the slice says to handle, and let the rest surface.
- **Follow the repo's existing patterns** for structure, naming, error handling and tests.
- **Ask before installing.** A new dependency is a one-way door. If the plan doesn't already decide it, ask the owner. The Bash hook asks too.

## 4. Verify

Run `jig verify --record` for the slice. It runs the slice's checks, prints one line per check, and appends the result to the Log. That Log line is the evidence the slice is done. A sentence saying the tests pass is not evidence.

- **All green:** go to step 5.
- **A check fails:** fix the code, not the check, and verify again. You get three rounds on the same check. If it still fails on the third `jig verify`, stop: don't try a fourth fix. Report to the owner what you changed in each round and the current error, and let them decide. The Stop hook counts the rounds from `evidence.jsonl` and says when you've reached three.
- **A check is flaky** (passes and fails on the same code): don't add retries, sleeps or a skip, and don't rerun it until it passes. Find the cause. If you can't, delete the test, log why, and tell the owner (deleting a protected test asks first). `jig lint` warns on a check command that retries or sleeps [J22], and rejects one that can't fail, such as `|| true` [J23].
- **A check can't run here** (missing service, credentials, hardware): say so in the Log and to the owner. Don't count it as passing.

At the full tier, hand the slice to the `jig-reviewer` agent in diff mode, with the plan path and slice ID. Fix the findings, or log why one doesn't apply.

When the slice changes UI and the loupe skill is available, run it on the affected screens if the slice's done-when calls for it.

## 5. Close the slice

1. Mark the slice `[done]` and update `Now:` to the next slice.
2. Append a Log line saying, in two or three sentences, what changed and why. This is for whoever reads the code next, including the owner checking they still understand their system.
3. Run `jig lint` on the plan.
4. Commit the slice with a message that says what it does. End the message with the `Verified:` line that `jig verify --record` printed, for example `Verified: S2 C1 pass, C2 pass (tree 3f2a91c)`. If nothing was verified, write `Verified: none (<reason>)` instead, so the commit can be found later.

Then stop and report to the owner:
- the slice
- the evidence line
- anything you couldn't verify
- the next slice

Start the next slice in a fresh session unless the owner asks you to keep going.

When every slice is done and the Outcome's done-when commands pass, set `Status: shipped` and log it.

## When something goes wrong twice

If you make the same mistake a second time, or the owner corrects the same thing twice, use the guard skill to turn it into a hook, lint rule or test.
