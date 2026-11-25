# Sizing a plan

Size by what has to be checked and what can't be undone, not by how long a person would take. Neither agents nor planners estimate time well: Fable 5.1 missed requested runtimes by a typical factor of 2.9 (AgentTime, arXiv 2610.09944), and one jig-planned project shipped in 15 days against a 30-week plan. Agent success does fall as a change spreads across more files, so file count is a useful signal.

## Tiers

| Tier | What you produce | Use it when all of these hold |
|---|---|---|
| 0 inline | Up to 5 lines in chat, no file | One reversible change; no contract, schema or data change; an existing check covers it, or one command proves it |
| 1 brief | `PLAN.md` human layer plus 1 to 3 slices; checks as commands | Several files or one new behaviour; everything reversible; no one-way door |
| 2 full | Plus `checks.json`, a jig-reviewer pass, and a gate if a one-way door applies | Any one-way door, a new dependency, an auth or data path, more than 3 slices, or work that spans sessions |
| 3 program | An index plan whose slices point to child plans, and an ADR per one-way door | Work that can't be checked as one plan, or more than one person working in parallel |

Signals that move a plan up a tier:

- **A one-way door:** schema or partition-key design, public API contracts, the auth model, data deletion, production or infrastructure changes, new runtime dependencies, or a scope change.
- **Breadth:** more than about 5 files, or more than one module boundary.
- **Data at risk:** migrations, backfills, deletes, or anything that writes where users store their work.
- **Unfamiliar ground:** you couldn't find an existing pattern in the repo to follow.
- **More than one person**, or parallel agents in separate worktrees.
- **No fast verify command** in the repo. Add slice S0 to create one, because every later slice depends on it.

When unsure between two tiers, take the smaller one and escalate as soon as a signal appears. Log the escalation. A plan that's too heavy for its task costs the reader more than it saves: Böckeler watched Kiro turn a small bug into 4 user stories and 16 acceptance criteria. A bad plan also does worse than no plan (Liu et al., arXiv 2604.12147).

## Tier 0 format

```
Plan: <outcome in one line>
Files: <paths>
Done when: `<command>` <passes / prints X>
Risk: <only if one exists, with how you'd notice it>
```

Then do the work. Tier 0 never stops for approval unless the change turns out to need a gate, and if it does, it isn't tier 0.

## Slices

A slice is one increment you can check. Each slice:

- **Is vertical**, ending in something that runs, rather than a layer such as "all the models" with nothing to verify until the end. Order work inside a feature as contract, then fixture data, then behaviour, then integration.
- **Fits one session.** Anthropic's long-running harness gives each session one feature. Sessions that try more declare victory early.
- **Names the files it may touch.** That list keeps the change in scope, and the edit hook warns outside it.
- **Ends with its checks green and a commit.** The next slice starts from a known-good state, and a bad slice reverts cleanly.
