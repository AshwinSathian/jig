---
name: guard
description: Turns a repeated agent mistake, an owner's repeated correction, or an incident cause into a deterministic guardrail, such as a permission deny rule, a hook, a lint rule, a test or a type, instead of another reminder in prose. Also audits a repo's harness with `jig doctor`. Use when the same problem has come up twice, after an incident or postmortem, when asked to "stop this from happening again", or when asked whether a repo is ready for agent work.
allowed-tools: Read Glob Grep Bash(jig doctor:*) Bash(git log:*) Bash(git diff:*)
argument-hint: the mistake or incident to guard against, or "doctor"
---

# Guard

A correction in prose is advisory. The model follows it less as instructions pile up, and the next session may never see it. A mistake that has happened twice will happen again, so give it a mechanism that holds whether or not anyone remembers.

## 1. Name the failure precisely

Write down:
- what happened
- where: file, command, or tool call
- how it was caught
- what it cost

Find the earlier occurrence (plan Logs, git history, or the conversation), because "twice" should be a fact. If it has only happened once, fix it, note it in the plan Log, and stop here.

## 2. Choose the mechanism

Use `${CLAUDE_PLUGIN_ROOT}/references/mechanisms.md`. Prefer, in this order:

1. **A test, type or lint rule** when the mistake shows up in the code. It fails in CI for anyone, agent or human. For example: a lint rule against empty `catch`, a type that makes the invalid state unrepresentable, or a test for the bug.
2. **A permission deny rule** when the mistake is an action that must never happen, such as reading `.env`, writing migrations or pushing to main.
3. **A hook** when it must be checked during the agent's work and a deny rule is too blunt. Use `ask` when exceptions are legitimate, so a person decides each one.
4. **One line in CLAUDE.md or AGENTS.md** only when it's a fact the repo doesn't already say and no check can decide it.

## 3. Propose, then apply what's yours to change

Show the owner the mechanism, the exact change, and how you tested that it catches the failure: ideally, run it against the original mistake and see it fire.

- **Tests, lint rules and types** in the repo: make the change in a small commit, as its own slice or a note in the current one.
- **Permission rules and hooks** in `.claude/settings.json` or user settings: propose the exact JSON, and let the owner apply it. Settings files control what the agent may do, so the agent shouldn't edit its own.

Add a Log line to the active plan naming the failure and the guard.

## Doctor

`jig doctor` reports gaps in a repo's harness and changes nothing. It checks:
- for a one-command verify
- for an empty-catch lint rule
- whether `.env` and credential files are readable without a deny rule
- whether `.claude/settings.json` and `.mcp.json` need reading before you trust the repo
- for a secret scanner in CI
- for lockfile drift
- for a way to run the change end to end: a `.claude/skills/verify*/SKILL.md`, an e2e runner or an e2e script (D7; a gap for apps, a note for a CLI or library)

Run it, then turn each gap the owner cares about into a slice or a guard. Treat a repo you didn't write as untrusted: read its `.claude/` and `.mcp.json` before running an agent in it.

## After an incident

Write a short blameless postmortem covering:
- what happened
- the timeline
- the cause
- whether AI-written code or an agent action was involved
- the guard added for each cause

Put it where the repo keeps such documents, or in `docs/postmortems/`. Each cause gets a guard from step 2.
