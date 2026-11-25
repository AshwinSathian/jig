# M0 spikes

Run 2026-11-25 on Claude Code 2.1.330, macOS, Node 24.19. Each answer lists the command that settled it. Transcripts weren't kept; rerun the command to reproduce.

## 1. Can a skill write `docs/plans/...` in plan mode?

No. Plan mode blocks every write except the session's plan file under `~/.claude/plans/`. In headless mode (`-p`), `ExitPlanMode` isn't available either, so a headless plan-mode run can never leave plan mode.

```
claude -p --permission-mode plan --model sonnet "Create the file docs/plans/demo/PLAN.md ..."
```

The model replied: "Plan mode was active, and it blocks any edit except to the plan file." It wrote its plan to `~/.claude/plans/<slug>.md` and no project file was created.

**Effect on the design:** in plan mode, the plan skill writes the whole jig plan (both layers) into the plan-mode plan file. After approval, its first action is to copy that plan to `docs/plans/<slug>/PLAN.md` and write `checks.json`. The plan-mode eval baseline can measure plan quality only, not execution.

## 2. Does a PreToolUse hook's `additionalContext` reach the model?

Yes, both with `permissionDecision: "allow"` and with no decision at all. A hook that printed `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"JIG-NOTE: codeword PLUM-3"}}` before a Read was quoted back verbatim by the model.

**Effect on the design:** the out-of-scope edit warning is added context with no decision, so it never prompts the user. jig hooks never return `allow`, because that would skip the user's own permission prompts. They return `ask` only for protected acceptance tests and package installs.

## 3. Trigger collision with superpowers

Deferred to M2. This needs the jig plan skill to exist. superpowers 7.0.2 is installed at `~/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.2`, and the eval runner loads it with `--plugin-dir` for the superpowers arm.

## 4. Eval tooling

- `claude plugin eval` exists. It runs `evals/**/prompt.md` with `graders/*.md`, or a `case.yaml`, and adds a no-plugin baseline arm automatically. Grader types are `regex`, `tool_used`, `tool_order`, `file_exists`, `llm` and `baseline`. **There are no custom-code graders**, so a grader can't run `jig lint` or a fixture's hidden tests.
- **Isolation.** `--setting-sources project,local` hides user skills and plugins: the run saw 19 built-in skills instead of about 221, with no plan-engineering, superpowers or loupe. claude.ai MCP connectors still loaded, so add `--strict-mcp-config`. `--bare` isn't usable here, because it needs an API key and skips plugin hooks.

**Effect on the design:**
- Trigger evals use `claude plugin eval` with `tool_used: Skill` graders.
- Execution and plan-quality evals use `evals/run.mjs`. It scaffolds a fixture repo, runs `claude -p --setting-sources project,local --strict-mcp-config` with each arm's flags, then runs command graders (`jig lint`, hidden checks, `git diff --stat`).
- The arms are none, jig (`--plugin-dir .`), plan mode (`--permission-mode plan`) and superpowers (`--plugin-dir <superpowers>`).

## 5. Other facts confirmed in the docs

- Plugin `bin/` executables are on the Bash tool's PATH, so the CLI runs as `jig`. Plugins with a top-level `bin/` aren't installed on claude.ai or Cowork; that's acceptable, because jig targets Claude Code.
- Skills can pre-approve `Bash(jig lint:*)` and similar in `allowed-tools`. `jig verify` is never pre-approved, because it runs commands from the repo's `checks.json`, and a repo is untrusted input.
- A Stop hook blocks with `{"decision":"block","reason":...}`. It gets `stop_hook_active`, and Claude Code overrides it after 8 consecutive blocks.
- A Stop hook that ran repo-defined commands would be an execution vector of the same kind as the 2025–2026 Claude Code CVEs. So jig's Stop hook never runs checks itself. It compares the time of the last edit with the time of the last recorded `jig verify` evidence and asks the agent to run verification through its normal permissions.

## Open

- The sign-in on this machine expires between 2026-11-26 and 2026-11-29. Long eval runs need `claude auth login` first.
