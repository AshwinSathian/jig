# Security

jig runs code in three places:

- **Hooks**, on every session start, file edit, Bash call and stop, as `node cli/jig.mjs hook <name>`. They read the hook's JSON input, the repo's `docs/plans/`, and their own state under `.git/jig/`. They run `git` with `core.fsmonitor` and `core.hooksPath` disabled, so a checkout's git config can't start programs. They never run commands from the repo, never return `allow`, and never make network requests.
- **`jig verify`**, which runs the commands in a plan's `checks.json`. Those commands come from the repository, so treat them like any script in it. The skills never pre-approve `jig verify`, so it goes through your normal Bash permissions.
- **`jig doctor --ack`** writes one file per repo under `~/.config/jig/acks/` (or `$JIG_HOME/acks/`). Acks live outside the repo on purpose, so a repo can't ship one that silences its own warning.
- **`jig doctor`, `lint`, `status` and `new`**, which read files under the repo. `new` writes the plan skeleton it's asked for. The others write nothing.

If you find a way for a repository, a plan, a `checks.json` or hook input to make jig run commands, write files outside `docs/plans/` and `.git/jig/`, or send data anywhere, please report it to us privately through [GitHub's private vulnerability reporting](https://github.com/AshwinSathian/jig/security/advisories/new) rather than in a public issue. Include the input that triggers it and what happened.

We support only the latest release.

## The hooks are guardrails, not a sandbox

The protected-test and install hooks ask before the Edit and Bash calls they recognise. A shell command can still change a file, and a package can arrive some way the hook doesn't match. Use Claude Code's permission rules and sandboxing for anything that must hold. `jig doctor` suggests deny rules for secrets.
