# Declared installs don't ask, and jig observe

Status: building · Tier: brief · Baseline: 7c0e77f · Updated: 2026-11-26
Now: S2 done. Next: PR, CI, then the owner's yes to merge and release.

## Outcome
Installing a package the repo already declares (`npm i vitest` when the committed package.json lists vitest) no longer asks. Protects, freeze, rules and gate-switch asks are unchanged. `jig observe` prints what observe.jsonl holds: counts by gate and decision, the date range and the top reasons, so the owner can decide on enforcement.
Done when:
- `node --test test/declared-installs.test.mjs` passes, and each behaviour's test failed before its code
- `npm test` passes, with no existing test edited

## Decisions
- "Declared" means declared at the commit the session started from (recorded by the SessionStart hook), not the working copy or the live HEAD. Reason: an agent can edit package.json, or edit and commit it, and then install; that new name is exactly the decision the ask is for. Rejected: the working copy, and HEAD (the security review of ac95c2e showed an agent commit vouches for itself). A session with no recorded start commit asks.
- The skip also needs: only allowlisted flags, no env assignment, no registry/index/config wording in the command, and no uncommitted change to registry config, lockfiles or manifests. Reason: each of those can redirect a declared name to other code. Rejected: a denylist of registry flags, which the review bypassed with `--@scope:registry` and `NPM_CONFIG_REGISTRY`.
- The rule applies in every permission mode, so the hook doesn't read `permission_mode`. Reason: a name the repo already declares is no decision in any mode, and one rule is less to test. Rejected: skipping only in auto mode.
- Only plain names count: npm `name` or `name@<version range>`, pip `name`, `name[extra]` or `name<specifier>`. An alias (`x@npm:y`), URL, git ref, path or tarball asks even when its name is declared. Reason: `lodash@npm:evil` installs evil under a declared name.
- Files read: the nearest package.json (dependencies, devDependencies, optionalDependencies, peerDependencies) for npm, pnpm, yarn and bun; for pip, uv and poetry, the requirements*.txt files and pyproject.toml in the nearest directory that has any of them ([project] dependencies and optional-dependencies, [dependency-groups], [tool.poetry.*dependencies] keys). "Nearest" walks up from the hook's cwd to the repo root. A file that can't be read or parsed declares nothing, so the install asks. Reason: these are the files the spec names, read locally, with no network request.
- Other ecosystems (cargo, go, gem, composer) keep asking. Reason: no transcript asks came from them.
- `jig observe` groups reasons after replacing hex ids of 7+ characters with `<id>`. Reason: one gate's asks at different trees are one reason, not many. Plain text only.

## Out of scope
- Bare `npm install` after an edit to package.json already installs a new name without asking (lockfile installs add no names). Unchanged here; noted for the owner.

## Questions
- None.

## Assumptions
- The owner's spec covers names declared in any of the four package.json fields, including peerDependencies.

## Slices

### S1: Declared installs don't ask [done]
Goal: an install whose every package is declared at HEAD returns nothing; one undeclared or non-plain package still asks and names only those.
Touch: `cli/lib/hooks.mjs`, `test/declared-installs.test.mjs (new)`
Checks: `node --test test/declared-installs.test.mjs`
- Risk: a parsing shortcut counts something that isn't a dependency (pyproject's `name = "x"`, a `python` key). Detect: tests with those decoys. Fallback: narrow to the arrays and tables named in Decisions.

### S2: jig observe, and release 2.4.3 [done]
Goal: `jig observe` summarises .git/jig/observe.jsonl; version 2.4.3 everywhere; CHANGELOG and README say what changed.
Touch: `cli/jig.mjs`, `cli/lib/hooks.mjs`, `cli/lib/observe.mjs (new)`, `test/declared-installs.test.mjs (new)`, `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `CHANGELOG.md`, `README.md`
Checks: `node --test test/declared-installs.test.mjs`, `npm test`

## Log
- 2026-11-26: Plan started at 7c0e77f.
- 2026-11-26: Approved by agent; no gate applied (brief tier, no one-way doors, no open questions).
- 2026-11-26: S1 done. declared-installs 13/13 (the four declared-name tests and the other-registry test failed before their code), `npm test` 369/369, eslint clean, no existing test edited. An install skips the ask only when every name is plain and declared in the nearest committed manifest; a flag or env var that points at another registry or index (`--registry`, `-i`, `--index-url`, `--find-links`, `--source`, `npm_config_*`, `PIP_INDEX_URL`) asks, since a declared name from elsewhere is a new package. Added to the Decisions' list of what asks: other registries.
- 2026-11-26: The background security review of ac95c2e found three gaps, all real: the registry check was a denylist (`--@scope:registry`, `NPM_CONFIG_REGISTRY` got past it), a modified .npmrc, lockfile or package.json `overrides` could redirect a declared name, and the agent could commit its own manifest change. Fixed in S2 (hooks.mjs added to Touch) with a test for each: flag allowlist, no env assignments or config wording, no uncommitted resolver files, and names read at the session's start commit. An existing quiet-asks test caught a regression in my first fix (`npm i -F x` hid x again); fixed the code.
- 2026-11-26: S2 done. `jig observe` prints events, date range, counts by gate and decision, and the top five reasons with tree ids grouped. declared-installs 18/18 (each new test failed before its code), `npm test` 374/374, eslint clean, no existing test edited. Version 2.4.3. This repo's observe.jsonl is empty, since the plugin here was 2.0.1 until today.
- 2026-11-26: The background security review of 193a5e2 found three more gaps, all real: a .npmrc committed mid-session passed the HEAD-only status check, a gitignored .npmrc never shows in status, and `export HOME=...;` or `cd /elsewhere &&` before the install redirects config. Fixed with a test each: resolver files are compared with the session start commit as well as the working copy, ignored registry config files count, and a segment that sets a variable, sources a file or cds outside the repo disqualifies the skip (`cd web &&` inside the repo is followed to web/'s manifest). Changed one of this PR's own new assertions: a manifest committed mid-session now makes every install ask for the rest of the session, since it can carry overrides. Not fixed: user-level config (~/.npmrc, ~/.config/pip) outside the repo; jig doesn't read files outside it. declared-installs 20/20, `npm test` 376/376, eslint clean.
- 2026-11-26: A separate review agent's report on ac95c2e listed 16 bypasses (abbreviated flags such as `--reg=` and `--ind=`, `--userconfig`, `--@scope:registry`, YARN_/BUN_/PIP_/UV_ config env vars, `pip config set`, uv `--overrides` and `-c`, an `.npmrc` written in the same command, and a manifest committed without a plan). Rerun against 96cb7d9: every one asks. Left quiet by choice: `npm i lodash@latest`, the declared package from the default registry at a tag. Pre-existing and unchanged: `pip install -r new.txt`, `pip install -e git+...` and `npm i $PKG`. CI green on 96cb7d9 (Test 20/22/24, Secret scan).
