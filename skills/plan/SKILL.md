---
name: plan
description: Plans engineering work before code is written, sized to the task. A one-file fix gets a few lines in chat. Larger or riskier work gets a short plan file the owner can approve, with slices, executable acceptance checks and a fresh-context review. Use whenever an engineering task is being planned or started, at any size, such as building, adding, changing, fixing, migrating, integrating or refactoring code, or when asked how to approach a change. Not for answering questions, explaining code, reviewing a diff, or debugging an error whose cause is unknown; find the cause first, then plan the fix.
allowed-tools: Read Glob Grep Bash(jig lint:*) Bash(jig status:*) Bash(jig new:*) Bash(git log:*) Bash(git status:*) Bash(git diff:*) Bash(git shortlog:*)
argument-hint: what to build or change
---

# Plan

Goal: $ARGUMENTS (if empty, use the latest request in the conversation).

A plan exists for two readers. The owner approves its short top half, and the agent that builds it follows the rest. Write for those two readers only. The repo already describes itself, so don't restate it. Nobody reads padding, and a bad plan does worse than no plan.

Reference files live in `${CLAUDE_PLUGIN_ROOT}/references/`. Read each one only when its step needs it.

## 1. Frame

Write the outcome in one sentence a person could check: what is true for the user, or for the code, when this is done.

Then check the request for ambiguity as a separate step, before planning. Models are poor at telling a clear request from an underspecified one, and a separate check closes most of that gap. List what you don't know, and sort each item:

- **Changes the plan, and only the owner knows it** (which behaviour they want, a constraint outside the repo, a one-way door's direction): ask it.
- **Changes the plan, and the repo can answer it:** look it up in step 2 instead of asking.
- **Doesn't change the plan:** make the call and record it under Assumptions.

Ask everything in the first group together, in one AskUserQuestion call when it's available, with your recommended answer first. If nothing is in that group, don't ask. If the owner said to proceed without questions, record the first group as assumptions too, except anything destructive or irreversible, which still needs a yes.

## 2. Survey

Read the code the change will touch before deciding anything:

- **Existing helpers, patterns and libraries to reuse.** Search before you design: AI-written code duplicates far more than it reuses, and the fix is to find what's already there.
- **The repo's verify commands** (test, typecheck, lint) and how long they take. If there's no single command that verifies the change, the plan's first slice adds one.
- **Plans already in flight:** run `jig status`, and match the repo's plan location if it already has one.
- **Constraints recorded in the repo:** ADRs, CLAUDE.md or AGENTS.md, module ownership.

When the survey would mean reading across many files, give it to the Explore subagent and keep its conclusions, not its file dumps. For a repo with several active authors, run `git shortlog -sn --since=90.days`. More than one author means team mode: read `references/team.md`.

## 3. Size

Pick the tier using `references/sizing.md`. In short:

- **Tier 0:** a reversible change that one command proves gets five lines in chat and no file.
- **Brief:** several files, all reversible.
- **Full:** any one-way door, new dependency, auth or data path, more than three slices, or work spanning sessions.
- **Program:** work that can't be checked as one plan.

When unsure, take the smaller tier and escalate when a signal appears.

**Tier 0:** write the four-line plan from `references/sizing.md`, then do the work. Stop here.

## 4. Draft

Run `jig new <slug> --tier <tier> --title "<title>"`. It writes the skeleton with the baseline commit. Fill it in following `references/plan-format.md`, which `jig lint` enforces.

What matters most, and why:

- **Done when** lists commands or check IDs. "It works" can't fail, but a command can.
- **Decisions** each give a reason, and name the alternative you rejected when one was real. Consider deleting or changing existing code before adding new code, because people and models both overlook the subtractive fix. Mark one-way doors `[one-way]`: schema and partition keys, public API contracts, the auth model, data deletion, production or infrastructure changes, new runtime dependencies, scope changes.
- **Out of scope** holds only what a reader would otherwise assume is included. Don't write filler to reach a count.
- **Questions** holds only what the owner must answer. Answer everything else yourself.
- **Slices** are vertical, fit one session, and end with checks green and a commit. Each lists the files it may touch.
- **Checks** come from the spec, written before the code. A check that restates what the code does catches nothing. Choose kinds by risk using `references/failure-modes.md`:
  - acceptance examples for behaviour
  - `property` where a rule has an invariant
  - `mutation` on core logic at the full tier
  - `perf` with a threshold on hot paths
  - `security` on auth and input
  - `e2e` when the slice changes behaviour a user sees: one check that starts the real app, CLI or service and drives the changed flow, because tests alone miss what running it shows
  - `differential` when a rewrite must keep behaviour: old and new on the same inputs (see `references/fundamentals.md`)
- **Risks** say how you'd notice each one and what you'd do instead. Don't score them.
- **No time estimates.** They are unreliable, and they turn into deadlines. Scope (slices, files, checks) is the measure.

Read `references/fundamentals.md` for the areas the change touches (concurrency, databases, networking, distributed systems, performance, design). Read `references/security.md` when it touches auth, input, secrets, dependencies, MCP or production. Read `references/safe-change.md` when it changes something people already use. Read `references/mechanisms.md` when a requirement must keep holding after the work is done; it may belong in a hook, test or lint rule rather than in prose.

When a slice changes UI and the loupe skill is available, add a loupe review of the affected screens to that slice's done-when. When the humanizing-writing skill is available, follow it for the human layer and for PR descriptions.

## 5. Check

Run `jig lint <path>` and fix every error.

At the full and program tiers, and whenever a one-way door is involved, hand the plan to the `jig-reviewer` agent in plan mode. Give it the plan path and the original request, not your reasoning. A model grading its own plan tends to approve it, and a fresh context doesn't share your blind spots. Fix what it finds, or record in the Log why a finding doesn't apply.

## 6. Gate

Stop for the owner when the plan has a one-way door, a destructive step, or an open question in Questions. Otherwise, approve it yourself and say so in the Log: "approved by agent; no gate applied". The owner can still read it afterwards.

- **In plan mode:** project files can't be written. Put the whole plan in the plan-mode plan file and exit plan mode for approval. Once it's approved, write `docs/plans/<slug>/PLAN.md` and `checks.json` from it before doing anything else.
- **Outside plan mode:** show the owner the human layer's outcome, one-way decisions and questions, in about ten lines, with the file path. Wait for their answer if a gate applies.

When approved, set `Status: approved`, add `Decided: <who> <date>` to each one-way decision, update `Now:`, and log the approval.

## 7. Hand off

Tell the owner, briefly:
- the outcome
- the tier
- the slice count
- each one-way decision and how it was settled
- the plan path

If they asked for the work and not only the plan, continue with the build skill on the first slice.

## Changing an approved plan

Edit the plan, then append a Log entry saying what changed and why. Never edit earlier Log entries; `jig lint` rejects that. If the change adds or alters a one-way door, gate it again. When the plan nears 400 lines, collapse finished slices into one Log line each.
