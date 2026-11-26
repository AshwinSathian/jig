# Installs always ask (2.4.6)

Status: shipped · Tier: brief · Baseline: 9132f31 · Updated: 2026-11-26
Now: shipped as 2.4.6 (PR #14).

## Outcome
Every install that names a package asks, declared or not, and installer spellings that skipped the ask are read. Owner's call on 2026-11-26, after the review of efe8015 found five more gaps in the token allowlist that this plan first built.
Done when:
- `node --test test/installs-ask.test.mjs` passes, and each failing case failed before the fix
- `npm test` passes, with no existing test edited

## Decisions
- [one-way] Drop the declared-install skip, and every install that names a package asks. Reason: each of the seven security reviews of the skip, 2.4.1 to 2.4.6, found a way past it. Rejected: patching the five gaps found in efe8015. Decided: owner 2026-11-26
- The token-allowlist decisions below describe efe8015, kept in history. Reason: they're superseded by the line above.
- Allowlist the words of an install segment instead of denylisting `$(`, `<(` and `&`. Reason: gate-skips-use-allowlists. 2.4.1 to 2.4.4 each shipped a word list, and every review found a spelling it missed.
- An unquoted word may contain only `[\w@./^~=,:+!<>-]`, and it can't start with `~`. Reason: that rules out globs, braces, `$`, backticks, `&` and process substitution. `<` and `>` stay for the `uv add pydantic>=2` form a merged test keeps quiet. In bash that word redirects to a file named `=2`, so a redirect target may only be digits, dots and word characters, with a digit or `=` first, so it can't name `.npmrc` or an absolute path. Double-quoted words take the same characters plus `*` and `[]`. Single-quoted words are literal.
- A changed path with any dot segment (`.pnpmfile.cjs`, `.yarn/`, `.npmrc`) counts as changing resolution. Reason: package-manager config is almost always a dotfile, so a list of names is the denylist again. Ignored files can't use that rule, because `.env` is ignored in most repos, so the ignored check uses the config files plus the lockfiles, outside `node_modules`.
- `-g` and `--global` leave the plain flags. Reason: a global install isn't the project's declared package.

## Out of scope
- The commit gate's reading of `<<<` as a heredoc. The commit gate is observed only, and this plan covers the install skip.

## Questions
- None.

## Assumptions
- The owner's request to fix confirmed gaps as 2.4.6 on its own branch and PR covers this plan.

## Slices

### S1: Token allowlist [done]
Goal: the Outcome.
Touch: `cli/lib/hooks.mjs`, `test/installs-ask.test.mjs (new)`, `README.md`, `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `cli/jig.mjs`, `CHANGELOG.md`
Checks: C1, R1

## Log
- 2026-11-26: Plan started at 9132f31. Approved by the owner's request (fix confirmed gaps as 2.4.6). A fresh-context security review of the install skip on main confirmed 10 bypasses with `pre-bash` in a temp repo, plus `-g`: `>$(...)`, `<(...)`, `>/dev/null&cmd`, `"requests;$(...)"`, a here-string read as a heredoc, a heredoc opened inside quotes, a glob `react@*`, a bracket glob `requests[2]`, `.pnpmfile.cjs`, and an ignored lockfile. I re-ran the 8 command-shaped ones and `-g` here, and each was quiet.
- 2026-11-26: Tests first: three of the four tests in install-skip-tokens.test.mjs failed before the fix, each because a bypass was quiet. The fourth, plain spellings, guards against an over-tight allowlist, and it passed before and after. The install segment's words now come from an allowlist (WORD, QUOTED, REDIRECT and TARGET in hooks.mjs). A segment spanning lines ends the skip, a changed dot path counts as config, and ignored lockfiles are checked. `-g` is no longer plain. `npm test` 404/404 and eslint 10.15.0 are clean, and no existing test was edited. A brief-tier checks.json was added so the commit carries a `jig verify` trailer.
- 2026-11-26 17:37: jig verify: C1 pass; R1 pass. checks changed since the last record: R1 (timeout_s)
- 2026-11-26: The background security review of efe8015 found five more gaps, and I reproduced four of them on efe8015. Config in an ignored directory (`node_modules/x/.npmrc`, `build/pyproject.toml`) or in a parent directory wasn't seen. npm's builtin npmrc wasn't hashed. `2>0001_initial.py` overwrites a repo file. And `npm in`, `npm -g i`, `npm --registry=... i`, `yarn global add`, `npx` and others never asked at all. Asked to choose, the owner dropped the skip: every install that names a package asks, and detection is wider. With that yes, the four skip test files (declared-installs, install-skip-hardening, install-skip-allowlist and install-skip-tokens, all asserting that declared installs stay quiet) are deleted (outside Touch, so they're named here). test/installs-ask.test.mjs replaces them, and it failed on efe8015's code (`npm i react` was quiet, `npm in leftpad-xyz` found nothing). C1 now runs that file. SessionStart still records `startHead` (the review's transcript check reads it) but no longer fingerprints user config. README's `install` gate line and the 2.4.6 CHANGELOG entry are rewritten. `npm test` 362/362 and eslint clean.
- 2026-11-26 19:00: jig verify: C1 pass; R1 pass. checks changed since the last record: C1 (cmd, protects -test/install-skip-tokens.test.mjs)
- 2026-11-26: Shipped. The owner merged PR #14 (4e9ff58). v2.4.6 was released by the agent on the owner's yes. publish.yml passed, `npm view jig-plan versions` listed 2.4.6 after about 270 s, and `npm audit signatures` after `npm i jig-plan@2.4.6` reports 1 verified attestation. The background security review of ad6d777, the final commit, didn't report before the merge.
