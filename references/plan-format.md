# jig plan format

`jig lint` enforces everything on this page. Rule IDs are in brackets.

## Where plans live

`<plans dir>/<slug>/PLAN.md`, with `checks.json` beside it at the full and program tiers. The plans directory is `plansDir` from `.jig.json` if set, otherwise an existing `docs/plans/` or `docs/plan/`, otherwise `docs/plans/`. `jig status` prints which one it uses. Start a plan with `jig new <slug> --tier brief|full|program --title "..."`, which picks that directory and fills in the baseline commit and date.

## Layout

```markdown
# CSV export for reports

Status: draft · Tier: full · Baseline: 3f2a91c · Updated: 2026-11-25
Now: drafting. Next: owner review.

## Outcome
Users download the filtered report as CSV, streamed, for reports up to 100k rows.
Done when:
- `npm test -- export` passes (C1, C2)
- `node scripts/export-load.mjs 100000` finishes under 30 s (C3)

## Decisions
- [one-way] Stream from the server, not build in the browser. Reason: 100k rows don't fit in browser memory. Decided: owner 2026-11-25
- Use the existing `csvStringify` in `src/lib/csv.ts`. Reason: it already handles escaping.

## Out of scope
- Excel output. A reader could assume "export" includes it.

## Questions
- None.

## Assumptions
- 100k rows is the ceiling (from the ticket).

## Slices

### S1: Export endpoint streams CSV [todo]
Goal: POST /api/reports/export returns text/csv for the current filters.
Touch: `src/api/reports/export.ts (new)`, `src/db/queries/reports.ts`
Checks: C1, C2
- Risk: the cursor query skips rows at page boundaries. Detect: C2 compares row counts with the report query. Fallback: switch to keyset pagination on `id`.

## Log
- 2026-11-25: Plan drafted from ticket #212.
```

## Header

- Line 1 is `# <title>` [J01].
- The Status line comes within the next few lines, with fields separated by ` · ` [J02]:
  - `Status`: one of `draft`, `approved`, `building`, `shipped` or `abandoned`.
  - `Tier`: one of `brief`, `full` or `program`. Tier 0 plans live only in chat and never get a file.
  - `Baseline`: the commit the plan was written against.
  - `Updated`: a date.
- The `Now:` line says where things stand in one line. A resuming session reads this first [J03]. A slice ID it names must exist [J18].

## Sections

The sections are, in this order [J04]: Outcome, Decisions, Out of scope, Questions, Assumptions, Slices, Log. Everything before `## Slices` is the **human layer**, the part the owner approves. Slices and Log are the **agent layer**.

- **Outcome** needs a `Done when:` list in which each item names a command in backticks or a check ID [J05].
- **Decisions**: every item gives a `Reason:` [J14]. Mark one-way doors `[one-way]`. Once the status is past `draft`, every one-way item also needs `Decided: <who> <date>` [J14]. One-way doors are:
  - schema and partition-key design
  - public API contracts
  - the auth model
  - data deletion
  - production or infrastructure changes
  - new runtime dependencies
  - scope changes
- **Out of scope**: list an item only when a reader would otherwise assume it's included. No minimum count.
- **Questions**: only what the human has to answer. Write `None.` if there are none.
- **Assumptions**: what you decided without asking, so the owner can overrule it.

## Budgets

| Tier | Human layer | Whole file |
|---|---|---|
| brief | 40 lines | 400 lines |
| full | 80 lines | 400 lines |
| program | 80 lines | 400 lines |

Going over the human-layer budget [J06] means the plan says things the owner won't read. Going over the file budget [J07] means it's time to collapse finished slices into one Log line each, or to split a program plan into child plans.

## Slices

```markdown
### S2: Export button in the toolbar [doing]
Goal: ...
Touch: `src/components/ExportButton.tsx (new)`, `src/pages/Reports.tsx`
Checks: C4
- Risk: ... Detect: ... Fallback: ...
```

- The heading is `### S<n>: <title> [todo|doing|done|dropped]` [J08], and at most one slice is `doing` [J19].
- `Touch:` lists the files the slice may change. Each path must exist or be marked `(new)` [J09, J11]. The edit hook warns when the agent edits a file outside the `doing` slice's list.
- `Checks:` names check IDs from `checks.json` [J09, J10]. A brief plan without `checks.json` may give commands in backticks instead.
- A program-tier slice can give `Plan: docs/plans/<child>/PLAN.md` instead of Touch and Checks.
- Every `Risk:` line has a `Detect:` and a `Fallback:` [J15]. Don't score risks; likelihood × impact grids rank risks badly (Cox 2008).

## Log

The Log is append-only and dated: `- 2026-11-25: ...` or `- 2026-11-25 14:02: ...` [J16]. `jig lint` compares it with the committed version and fails if an earlier entry changed or disappeared. Log entries record:

- decisions changed after approval, with the reason
- check evidence, which `jig verify --record` writes: command, exit code, the line that decides it
- each finished slice, with two or three lines on what changed and why

## Wording

- No time or effort estimates such as `(~3d)`, "estimated effort" or "will take 2 weeks" [J12]. Report scope instead: slices, files, checks. Agents and planners both estimate badly, and estimates turn into deadlines.
- Avoid words that defer a decision: soon, eventually, as needed, TBD, etc. [J13, warning]. Write the decision, or put it under Questions.

## checks.json

```json
{
  "version": 1,
  "checks": [
    {
      "id": "C1",
      "slice": "S1",
      "kind": "acceptance",
      "cmd": "npm test -- export.accept",
      "expect": { "exit": 0 },
      "timeout_s": 60,
      "fast": true,
      "protects": ["test/export.accept.test.ts"]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Letters, digits, `.`, `-` or `_`, starting with a letter. Unique |
| `slice` | A slice ID from the plan |
| `kind` | `acceptance`, `regression`, `property`, `mutation`, `perf`, `security`, `e2e` (starts the real app, CLI or service and drives the changed flow) or `differential` (compares old and new output on the same inputs) |
| `cmd` | Shell command, run from the repo root |
| `expect.exit` | Expected exit code (default 0) |
| `expect.stdout` | Optional JavaScript regex the output must match |
| `timeout_s` | 1 to 600 |
| `fast` | True for checks that finish within 120 s. The build skill runs these before every stop |
| `protects` | Paths the agent may not edit without a logged decision. The edit hook asks first |

Write acceptance checks from the spec, before the code they check. They state what the code should do, not what it already does. Point each one at its own tests (a file path, `--grep`, `--testPathPattern`, `-t`): a whole-suite command passes before the behaviour exists, and `jig lint` warns about it [J21]. A `cmd` that retries or sleeps hides a flaky test [J22, warning], and one that can't fail (`|| true`, `|| :`, `; exit 0`) checks nothing [J23]. `jig verify` runs a slice's checks by their `slice` field, so a slice's `Checks:` line should name only its own checks [J24, warning]. Other lint errors here are [J17].
