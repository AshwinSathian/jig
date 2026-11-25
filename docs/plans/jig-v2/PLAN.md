# jig v2: a planning and build harness for coding agents

Status: building · Tier: full · Baseline: ddb3fdb · Updated: 2026-11-25
Now: S5 in progress; S0 to S4 done.

## Outcome
jig replaces the `plan-engineering` skill. It is a Claude Code plugin that plans engineering work at any size, carries the plan through to verified code, and turns repeated failures into deterministic guardrails. Design detail is in [docs/design.md](../../design.md), and the evidence is in [the adversarial review](../../research/2026-11-adversarial-review.md).
Done when:
- `npm test` passes, covering lint mutations, verify, hook trip and pass fixtures, and doctor fixtures (C1)
- `jig lint` passes the good fixture plans and this plan (C2, C3)
- `claude plugin validate .` passes (C4)
- `evals/results/REPORT.md` compares jig with no skill, plan mode and superpowers on the fixture tasks, and states tier-0 overhead whatever it is (C5)

## Decisions
- [one-way] Name: jig, CLI on npm as `jig-plan`. Reason: a jig guides the tool so each cut comes out the same; `jig` is taken on npm. Decided: owner 2026-11-25
- Work inside plan mode, don't replace it. Reason: plan mode blocks project writes (M0 spike 1), so jig writes the plan-mode plan and copies it to `docs/plans/` after approval.
- Coexist with superpowers, don't depend on it. Reason: both auto-trigger; jig must work without it. The README suggests turning off its planning skills.
- Auto-trigger at every size, with a 5-line tier 0 in chat. Reason: owner asked for every size; evals measure tier-0 cost.
- Gates by context. Reason: owner asked for it. One-way doors always stop; "zero intervention" relaxes all but destructive actions.
- Hooks never return `allow`, and the Stop hook never runs repo commands. Reason: `allow` would skip the user's prompts; repo-defined commands at Stop are an execution vector (M0 spike notes).
- Solo by default, team when the repo shows more than one recent author. Reason: owner decision.
- loupe and humanizing-writing are optional partners. Reason: jig must work without them.
- [one-way] Keep the old skill installed until v2 passes its evals. Reason: the owner relies on it daily. Decided: owner 2026-11-25

## Out of scope
- A website. The README carries the docs.
- Hooks for agents other than Claude Code. Skills and plan files stay portable markdown.
- Writing any user settings file. Doctor suggests deny rules and never applies them.

## Questions
- None until S5: public or private repo first, and whether to list jig on a marketplace.

## Assumptions
- Node 20+ wherever the CLI runs.
- The owner's excerpts are used with the corrections in the review's verification table.

## Slices

### S0: Spikes [done]
Goal: settle plan mode, hook context, eval tooling and arm isolation before building on them.
Touch: `docs/research/m0-spikes.md`
Checks: `test -s docs/research/m0-spikes.md`

### S1: Format and lint [done]
Goal: the plan format is specified and `jig lint` enforces it.
Touch: `references/plan-format.md`, `cli/jig.mjs`, `cli/lib/plan.mjs`, `cli/lib/lint.mjs`, `cli/lib/checks.mjs`, `cli/lib/scaffold.mjs`, `cli/lib/status.mjs`, `cli/lib/verify.mjs`, `cli/lib/git.mjs`, `test/lint.test.mjs`, `test/verify.test.mjs`, `evals/fixtures/plans/good`
Checks: C1, C2, C3

### S2: Plan skill and reviewer [done]
Goal: the plan skill produces lintable plans at the right tier, and the reviewer finds seeded defects the author misses.
Touch: `skills/plan/SKILL.md`, `agents/jig-reviewer.md`, `references/`, `.claude-plugin/plugin.json`, `evals/triggers/`, `evals/lib/`
Checks: C4, C6
- Risk: the skill over-fires and slows small requests. Detect: the trigger and tier-0 evals in S5. Fallback: narrow the description, or cut tier 0 to one line.
- Risk: superpowers fires instead of jig. Detect: the trigger-collision run in this slice. Fallback: document the conflict and suggest disabling superpowers' planning skills.

### S3: Build skill and hooks [done]
Goal: a fresh session resumes from the SessionStart line and finishes a slice with evidence; the hooks trip on their fixtures and stay quiet otherwise.
Touch: `skills/build/SKILL.md`, `hooks/hooks.json`, `cli/lib/hooks.mjs`, `test/hooks.test.mjs`
Checks: C1
- Risk: hooks ask too often and get switched off. Detect: more asks than trips in the fixtures. Fallback: downgrade to added context, with an env switch per hook.

### S4: Guard skill and doctor [done]
Goal: repeated failures become hooks, lint rules or tests, and doctor reports harness gaps without changing anything.
Touch: `skills/guard/SKILL.md`, `cli/lib/doctor.mjs`, `references/team.md`, `test/doctor.test.mjs`, `eslint.config.js`
Checks: C1

### S5: Evals, packaging, publish prep [doing]
Goal: the evidence report exists, and the plugin installs from its own marketplace.
Touch: `evals/run.mjs (new)`, `evals/tasks (new)`, `evals/triggers (new)`, `evals/results (new)`, `README.md (new)`, `.claude-plugin/marketplace.json (new)`, `.github/workflows/ci.yml (new)`
Checks: C4, C5
- Risk: model judges inflate results. Detect: judged numbers disagree with command graders. Fallback: report command-graded numbers only, and label judged ones.

## Log
- 2026-11-25: Imported v1.0 (`16c5eb7`), wrote the adversarial review (`ddb3fdb`), and renamed the repo folder to `jig`. Owner decisions: solo-first with team support, automatic triggering, gates by context, rename plus plugin packaging.
- 2026-11-25: Owner approved the plan ("Plan looks good"). Converted it to the jig format; design detail moved to `docs/design.md`.
- 2026-11-25: S0 done. Plan mode blocks project writes; hook context reaches the model with or without a decision; plugin eval has no command graders; `--setting-sources project,local --strict-mcp-config` isolates arms.
- 2026-11-25: S1 done. Format spec, `jig new/lint/status/verify`, 35 tests including 26 single-rule mutations of good plans.
- 2026-11-25 15:43: jig verify S1: C1 pass; C2 pass; C3 pass
- 2026-11-25: Trigger spike (S2). jig alone missed direct build prompts ("Build a CSV export endpoint": 0/3); superpowers' SessionStart prompt made them fire. Added a one-line SessionStart nudge: misses then fired 4/4, negatives stayed quiet 4/4. superpowers:brainstorming beat jig:plan on 1 of 7 planning prompts. A one-word typo fix never fires; the case now scores either way.
- 2026-11-25: Hooks built ahead of S3 because the nudge needed them: session-start, pre-edit (protected tests ask, out-of-scope warns once), pre-bash (installs ask), stop (asks for verify evidence; never runs repo commands). 48 tests pass.
- 2026-11-25: S2 closed without its produced-plans check (C6), which moves to S5 with the task evals so plans are produced once and graded once. S3 done: build skill on top of the hooks. S4 done: guard skill, `jig doctor` (D1 to D6, report only), team reference. A security review flagged the pre-edit hook failing open on a bad checks.json; it now asks instead. ESLint on jig's own code found an empty catch in the hooks, now fixed.
- 2026-11-25 15:54: jig verify S1: C1 pass; C2 pass; C3 pass
