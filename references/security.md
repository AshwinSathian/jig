# Security in a plan

Read this when a slice touches authentication or authorization, user input, secrets, dependencies, MCP servers, production credentials, or untrusted content such as issues, PR text, web pages or tool output. Security prompting reduces issues but doesn't remove them, so turn each answer into a check or a human review step.

## Generated code
- **New route or handler:** add a `security` check that calls it without credentials and with another user's credentials, and expects a refusal.
- **Input:** where does it come from, where is it validated, and where is it encoded on output (HTML, SQL, shell, paths)? Use parameterized queries and the framework's escaping; don't hand-roll either.
- **Passwords, tokens, crypto:** use the platform's library (bcrypt or argon2, the framework's session handling). Never write these by hand.
- **Auth paths get a human read.** List them in the slice Goal so the reviewer and the owner know where to look.
- **CI:** if the repo has no SAST or dependency scanner, `jig doctor` reports it. Adding one is a separate slice, not a side effect.

## Lethal trifecta
A coding agent usually has private data, untrusted content and a way to send data out (Willison, June 2025). When a plan feeds untrusted content to the agent (summarizing issues, reading web pages, calling a new MCP server), say which leg the session breaks: no secrets in reach, no network egress, or no untrusted input.

## Secrets
- Keep them out of the agent's environment. `jig doctor` reports `.env` files and credential paths with no deny rule.
- Use short-lived credentials, and run a secret scanner (gitleaks or trufflehog) in CI.
- Never put a secret in a plan, a check command or a log entry.

## Supply chain
- A new dependency is a one-way door. Record its name, registry page, age, weekly downloads and maintainer in Decisions. Hallucinated package names recur across runs (43% recurred in every one of 10 runs; Spracklen et al., USENIX Security 2025), so attackers register them.
- Install with the lockfile (`npm ci`, `pip install -r` with hashes) and review lockfile diffs.
- The jig Bash hook asks before any agent-run install that names a package.

## Repo config is an execution vector
A malicious `.claude/settings.json` or `.mcp.json` has run code or leaked API keys before the trust dialog in past Claude Code versions: CVE-2025-59536, CVE-2026-21852, CVE-2026-33068 and CVE-2026-40068, all patched. In an unfamiliar repo, read those files before running an agent there, and keep Claude Code updated. `jig doctor` lists them; it never edits them.

## MCP servers
Each server is third-party code holding real credentials, and its tool descriptions can carry injected instructions. Allowlist servers, pin versions, use read-only tokens, and prefer fewer, narrower tools.

## Blast radius
- No production write access for agents. Use separate dev and prod credentials, and a read-only database user for exploration.
- Review infrastructure plans (`terraform plan`, `pulumi preview`) before apply. Apply is a one-way door.
- `--dangerously-skip-permissions` belongs only in an isolated container or VM with no credentials.
