# Declared-install skip from an allowlist

Status: shipped · Tier: brief · Baseline: 005fd92 · Updated: 2026-11-26
Now: S1 done; PR open, merge and release wait for the owner's yes.

## Outcome
The four gaps the security review of 2.4.4 found ask, and so does any future spelling of shell state, because the skip applies only to commands made of plain installs, plain `cd` and output filters.
Done when:
- `node --test test/install-skip-allowlist.test.mjs` passes, and each failing case failed before the fix
- `npm test` passes, with no existing test edited

## Decisions
- Allowlist the segments around a declared install instead of denylisting shell features. Reason: three reviews in a row (2.4.3, 2.4.4 and its successor) each found a spelling the denylist missed. Rejected: adding `read`, `printf -v`, `mapfile` and `let` to the list, as the review suggested at minimum, since the next one would be missed the same way.
- Extend the config fingerprint (XDG, pnpm, /etc, VIRTUAL_ENV, parent `uv.toml`, registry env vars) rather than parse each tool's config search path. Reason: a hash of fixed paths is a few lines and fails closed on any change.

## Out of scope
- `pip install -r`, `pip install -e <url>` and `npm i $PKG`, which were quiet before 2.4.3 too.

## Questions
- None.

## Assumptions
- The owner's earlier answer (fix review findings in a follow-up PR, then ask before merging) covers this PR.

## Slices

### S1: Allowlist and wider fingerprint [done]
Goal: the Outcome.
Touch: `cli/lib/hooks.mjs`, `test/install-skip-allowlist.test.mjs (new)`, `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `cli/jig.mjs`, `CHANGELOG.md`
Checks: `node --test test/install-skip-allowlist.test.mjs`, `npm test`

## Log
- 2026-11-26: Plan started at 005fd92. Approved by agent; no gate applied (brief tier, no one-way doors).
- 2026-11-26: Tests first: the allowlist and fingerprint tests failed before the fix (`read HOME <<< ...` and an XDG pip.conf were quiet); the plain cases already passed. S1 done: install-skip-allowlist 3/3 (7 subtests counted with the shared repo file), `npm test` 393/393, eslint clean, no existing test edited. The SETS denylist is deleted. Version 2.4.5.
