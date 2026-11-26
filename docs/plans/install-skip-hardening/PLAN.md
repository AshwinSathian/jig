# Close the 2.4.3 review's gaps in the declared-install skip

Status: shipped · Tier: brief · Baseline: 7bc2a5a · Updated: 2026-11-26
Now: shipped as 2.4.4 (PR #11).

## Outcome
The four gaps the security review of 96cb7d9 found in 2.4.3's declared-install skip ask again, and plain declared installs stay quiet.
Done when:
- `node --test test/install-skip-hardening.test.mjs` passes, and each test failed before its code
- `npm test` passes, with no existing test edited

## Decisions
- Non-install segments fail closed: a variable assignment, `export`/`source`/`eval`-style builtin or `sudo` anywhere in one disqualifies the skip, not only at its start. Reason: `then export HOME=x` hid behind a keyword. Rejected: stripping a list of shell keywords, which misses the next one.
- Each install segment is judged in the directory in effect at that point, following `cd` targets resolved with realpath and kept inside the repo; `popd`, a subshell around a `cd`, or a missing target asks. Reason: one directory per command judged two installs in the wrong place, and a symlinked directory could leave the repo.
- User-level registry config (~/.npmrc, ~/.yarnrc*, ~/.bunfig.toml, pip and uv user config, node's global npmrc) is fingerprinted at SessionStart; a change since then, or no fingerprint, asks. Reason: those files redirect installs and sit outside the repo. Rejected: reading their contents, which would mean parsing four formats.

## Out of scope
- `pip install -r`, `pip install -e <url>` and `npm i $PKG`, which were quiet before 2.4.3 too.

## Questions
- None.

## Assumptions
- The owner's "a 2.4.4" for findings from this review covers the PR; merging and releasing still wait for their yes.

## Slices

### S1: Fail closed on shell state, per-segment directories, user config [done]
Goal: the Outcome.
Touch: `cli/lib/hooks.mjs`, `test/install-skip-hardening.test.mjs (new)`, `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `cli/jig.mjs`, `CHANGELOG.md`
Checks: `node --test test/install-skip-hardening.test.mjs`, `npm test`

## Log
- 2026-11-26: Plan started at 7bc2a5a.
- 2026-11-26: Approved by agent; no gate applied (brief tier, no one-way doors). Tests written first: 5 of 6 failed before the fix; the cwd-outside-repo test already passed.
- 2026-11-26: S1 done. install-skip-hardening 10/10, `npm test` 386/386, eslint clean, no existing test edited. An install segment's own prefix now uses the same shell-state check, so `sudo npm i x` asks. Version 2.4.4.
- 2026-11-26: Shipped. PR #11 merged and v2.4.4 released by the agent on the owner's yes; npm lists 2.4.4 with a verified registry signature and attestation. The review of 2.4.4 found four more gaps, fixed in 2.4.5 (docs/plans/install-skip-allowlist).
