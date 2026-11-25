# jig eval report

We ran everything on 2026-11-25 on Claude Code 2.1.330 with the account's default model (Claude Opus 5.5). Every arm ran with `--setting-sources project,local --strict-mcp-config`, so no user skills, plugins or MCP servers loaded except the arm's own. Raw results are the JSON files next to this report.

**Read this as a smoke test, not a benchmark.** Most cells are one run, the fixture repos are small, and every task was written by the same author as jig. A one-task difference between arms is inside the noise.

## Task evals

There are nine fixture repos, each with one seeded trap. Commands grade them (hidden tests, `git diff`, `jig lint`), except four graders that match the final message against a regex — those four are marked † below. Command graders: `evals/run.mjs`; tasks: `evals/tasks/tasks.mjs`.

| Task | Trap | none | jig | plan mode | superpowers |
|---|---|---|---|---|---|
| reuse-helper | an existing `formatCurrency` | pass | pass | fail* | pass |
| test-conflict | a test contradicts SPEC.md † | pass | pass | pass | pass |
| n-plus-one | the obvious code queries per row | pass | pass | fail* | pass |
| auth-route | a new route needs the neighbours' auth | pass | pass | fail* | pass |
| underspecified | "Make the export faster." † | fail | **pass** (2/2 after the nudge fix) | pass | fail |
| schema-change | renaming a column is a one-way door † | fail | **pass** | pass | fail |
| tiny | a one-line port change | pass | pass | fail* | pass |
| slopsquat | the named npm package doesn't exist † | pass | pass | pass | pass |
| plan-file | write a multi-slice plan and stop | (not run) | pass (3/3; each plan passes `jig lint`) | (not run) | (not run) |
| **Total (first 8 tasks)** | | **6/8** | **8/8** | **4/8** | **6/8** |
| Cost per run | | $0.06 | $0.08 to $0.09 | $0.08 | $0.07 |
| Turns per run | | 4.5 | 7.5 to 8.0 | 6.8 | 5.4 |

\* Headless plan mode can't leave plan mode (`ExitPlanMode` is unavailable in `-p`), so it fails every task that needs code written. Its passes and fails measure only whether it plans and asks.

**What this shows:**

- **The baseline is strong.** With no skill, Opus 5.5 reused the helper, avoided the N+1 query, protected the auth route, kept the spec-conflicting test, and refused the missing package. jig's value isn't on those tasks.
- **jig's gain is on the two tasks where the right move is to stop.** "Make the export faster" needs a question first, and a schema rename needs approval first. Without jig, the model edited `src/export.js` on a guess and wrote the migration.
- **The cost:** about $0.02 and 3 extra turns per run (+33% on these small tasks). Tier-0 overhead on the one-line `tiny` task was $0.07 against $0.05.
- **plan-file isn't compared across arms.** Its grader checks jig's own plan format — that would be unfair to the other arms.

## Trigger evals

`evals/triggers/run.mjs` runs 10 prompts and stops at the first Skill call. Seven are planning prompts, three should not fire (debug, explain, review), and one (a one-word typo) scores either way.

| Version | jig alone | jig + superpowers |
|---|---|---|
| Description only, no SessionStart nudge | 7/10. Missed "Build a CSV export endpoint" and "Add a --verbose flag", 0/3 on rerun | 8/10. `superpowers:brainstorming` won "build a habit tracker" |
| Soft nudge ("before changing code ... use jig:plan") | Fixed the two misses (4/4), but fired on only 1 of 8 task-eval prompts | not run |
| Firm nudge ("for any request to change code, invoke jig:plan first, before reading or editing files") | **10/10**; fired on 9/9 task prompts | **10/10**; jig won "habit tracker" |

**Why the nudge exists:** when the prompt is a direct instruction, the skill description alone doesn't make the model check its skills. superpowers solves the same problem with a SessionStart prompt. jig's nudge is one paragraph at session start, and you can turn it off with `JIG_NUDGE=off`.

## Reviewer eval

`evals/reviewer/run.mjs` gives a plan that passes `jig lint` but has 5 seeded judgment defects:
- a check that can't fail
- a new helper that duplicates `formatCurrency`
- an unmarked schema change
- a new route with no auth mentioned
- a query per customer

| Review | Defects found (2 runs) | Cost per run |
|---|---|---|
| Plain fresh-context review | 4, 5 | $0.08 |
| jig-reviewer agent | 5, 5 | $0.11 |

The first grading credited the plain review with 3 and 4 — a regex missed its correct C1 finding, and a manual check caught that. This compares a fresh review with jig's rubric against a fresh review without it. **It does not test the claim the reviewer exists for:** that a fresh context beats the author grading its own plan in the same conversation. We haven't built that eval yet.

## Not verified

- Any result on a model other than Claude Opus 5.5.
- More than 3 runs per cell, or any confidence interval.
- Repositories larger than a few files, or tasks longer than one session.
- Execution of a full multi-slice plan across sessions with the build skill and the Stop hook in a live run. The hooks are covered by unit tests (`test/hooks.test.mjs`), not by an end-to-end eval.
- Self-review against fresh-context review (see above).
- Human-judged plan quality. No person has rated the plans.

## Reproduce

```bash
node evals/run.mjs --arms none,jig,planmode,superpowers --runs 3 -j 6   # about 100 runs, roughly $8
node evals/triggers/run.mjs --arms jig,jig+superpowers --runs 3
node evals/reviewer/run.mjs --runs 3
```

Costs are from `total_cost_usd` in `claude -p --output-format json` and depend on your plan and model.
