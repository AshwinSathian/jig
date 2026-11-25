# Changelog

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
