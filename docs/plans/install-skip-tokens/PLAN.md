# Declared-install skip: allowlisted tokens

Status: building · Tier: brief · Baseline: 9132f31 · Updated: 2026-11-26
Now: S1 done. Next: owner merge and the 2.4.6 release.

## Outcome
The gaps the security review of ce7ef3a found ask. A declared install skips the ask only when every word after the installer is on an allowlist: a known flag, a plain name or version with no shell expansion, or a fixed redirect. A segment that spans lines, a global install, a pnpmfile and an ignored lockfile also make the install ask.
Done when:
- `node --test test/install-skip-tokens.test.mjs` passes, and each failing case failed before the fix
- `npm test` passes, with no existing test edited

## Decisions
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
Touch: `cli/lib/hooks.mjs`, `test/install-skip-tokens.test.mjs (new)`, `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `cli/jig.mjs`, `CHANGELOG.md`
Checks: C1, R1

## Log
- 2026-11-26: Plan started at 9132f31. Approved by the owner's request (fix confirmed gaps as 2.4.6). A fresh-context security review of the install skip on main confirmed 10 bypasses with `pre-bash` in a temp repo, plus `-g`: `>$(...)`, `<(...)`, `>/dev/null&cmd`, `"requests;$(...)"`, a here-string read as a heredoc, a heredoc opened inside quotes, a glob `react@*`, a bracket glob `requests[2]`, `.pnpmfile.cjs`, and an ignored lockfile. I re-ran the 8 command-shaped ones and `-g` here, and each was quiet.
- 2026-11-26: Tests first: three of the four tests in install-skip-tokens.test.mjs failed before the fix, each because a bypass was quiet. The fourth, plain spellings, guards against an over-tight allowlist, and it passed before and after. The install segment's words now come from an allowlist (WORD, QUOTED, REDIRECT and TARGET in hooks.mjs). A segment spanning lines ends the skip, a changed dot path counts as config, and ignored lockfiles are checked. `-g` is no longer plain. `npm test` 404/404 and eslint 10.15.0 are clean, and no existing test was edited. A brief-tier checks.json was added so the commit carries a `jig verify` trailer.
- 2026-11-26 17:37: jig verify: C1 pass; R1 pass. checks changed since the last record: R1 (timeout_s)
