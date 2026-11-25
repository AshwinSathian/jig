# Changelog

## 2.0.0 (unreleased)

We rebuilt the single-file `plan-engineering` skill (1.0, July 2026) as the jig plugin. Our reasons are in `docs/research/2026-11-adversarial-review.md`.

- Plans are sized by what has to be checked and what can't be undone, with no time estimates. Tier 0 is a five-line plan in chat.
- Each plan has a short human layer you approve and an agent layer. The Log is append-only.
- `checks.json` holds executable acceptance checks. `protects` marks tests the agent may not edit without asking.
- Skills: `plan`, `build`, `guard`. Agent: `jig-reviewer`.
- Hooks: a SessionStart nudge and plan status, a protected-test and scope guard on edits, an install guard on Bash, and a Stop hook that asks for verify evidence.
- CLI: `jig new`, `lint` (rules J01 to J20), `status`, `verify --record`, `doctor` (D1 to D6).
- Evals: task, trigger and reviewer evals with isolated arms. See `evals/results/REPORT.md`.
