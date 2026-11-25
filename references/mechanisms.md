# Match the need to the mechanism

Prose instructions are advisory, and models follow them less as they pile up (IFScale, arXiv 2507.11538). Claude Code's own guidance is that a rule that can't bend should be a hook. Use this table when a plan has a requirement that must keep holding after the plan is done, and in the guard skill when a correction repeats.

| Need | Mechanism | Why |
|---|---|---|
| A rule that must always hold ("never edit migrations", "no prod credentials") | Permission deny rule, or a PreToolUse hook | Deterministic: it runs whether or not the model remembers it |
| A behaviour that must be true of the code | A test, type or lint rule, run in CI | Fails the build instead of relying on review |
| A convention or non-obvious fact (build command, a trap in this repo) | One line in CLAUDE.md or AGENTS.md | Advisory and cheap. Only write what isn't already in the repo; generated context files raised cost 20–23% with no significant gain (Gloaguen et al., arXiv 2602.11988) |
| A review rule that only shows in a diff (no test can decide it) | A `When: · Check: · Source:` entry in REVIEW.md, applied by the diff reviewer from the base commit | Read only when the trigger matches, and a slice can't edit the copy that judges it |
| A procedure used now and then | A skill | Loaded only when needed, so it costs nothing the rest of the time |
| Investigation, or parallel work | A subagent, or one agent per git worktree split along module boundaries | Keeps searches and logs out of the main context and avoids merge conflicts |
| Access to an outside system | An MCP server, pinned, with a read-only token where possible | Each server widens what an injected instruction can reach |

## The second-time rule

The first time the agent makes a mistake, fix it. The second time it makes the same mistake, add a mechanism from the top three rows, and note it in the plan Log. The guard skill does this.

## Choosing between rows

- If a check can decide it, use a test, lint rule or type. Prose is the last resort.
- If it must hold during the agent's work, not only in CI, use a hook.
- If the cost of being wrong is high and the rule has exceptions, use a hook that asks (`permissionDecision: ask`) rather than one that denies, so a person decides each case.
