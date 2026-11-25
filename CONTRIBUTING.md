# Contributing to jig

Most useful contributions start as an issue, and these are the ones that help us most:

- **A plan jig got wrong.** It picked the wrong tier, missed a one-way door, asked a question the repo could answer, or padded the plan. Use the [bad plan form](https://github.com/AshwinSathian/jig/issues/new?template=bad-plan.yml) and paste the plan, or the part that's wrong.
- **A hook that fired when it shouldn't, or didn't when it should.** Use the [hook form](https://github.com/AshwinSathian/jig/issues/new?template=hook.yml) with the tool call and the hook's output.
- **A source that has moved on.** A reference file cites research or docs that now say something different. Open a [bug](https://github.com/AshwinSathian/jig/issues/new?template=bug.yml) with the current link.

Questions go to [Discussions](https://github.com/AshwinSathian/jig/discussions). Security problems go through [private vulnerability reporting](https://github.com/AshwinSathian/jig/security/advisories/new), as described in [SECURITY.md](SECURITY.md).

## What we won't take

Some limits are deliberate, and we'll close a pull request that crosses them:

- **Time or effort estimates in plans.** Agents and planners both estimate badly. The evidence is in `docs/research/2026-11-adversarial-review.md`.
- **A hook that returns `allow`, or that runs commands from the repo.** The first skips the user's permission prompts. The second makes `checks.json` an execution vector.
- **Anything that writes the user's settings files.** `jig doctor` and the guard skill propose; the user applies.
- **Mandatory sections or minimum counts** ("at least 2 risks"). Quotas produce filler.
- **Runtime dependencies in the CLI.** It stays plain Node 20+.

## Setting up

```bash
git clone https://github.com/AshwinSathian/jig.git
cd jig
npm test
npx eslint
```

There's nothing to install: `npm test` runs `node --test` over `test/`. To try your copy in Claude Code, run `claude --plugin-dir /path/to/jig`.

## Changing a skill, agent or reference

These files are what the model reads, so even a small change in wording can move its behaviour.

1. **Give every rule its reason.** Current Claude models follow explained instructions better than emphatic ones. Avoid ALL CAPS and "non-negotiable".
2. **Cite the source** when a rule rests on research, and keep figures exactly as the source states them.
3. **Run the evals the change could move,** with and without it, and put both results in the pull request. At minimum:
   ```bash
   node evals/triggers/run.mjs --arms jig
   node evals/run.mjs --arms none,jig --tasks <the tasks your change touches>
   ```
   These spend money on your own account — a run is about $0.05 to $0.15. Report what moved, including what got worse.
4. **Keep `skills/*/SKILL.md` under about 200 lines.** Detail that only one step needs belongs in `references/`.

## Changing the plan format

`references/plan-format.md` and `cli/lib/lint.mjs` change together. Every new lint rule needs a mutation case in `test/lint.test.mjs`: a good fixture plan broken one way, which the linter must report with the rule's ID.

## Pull requests

- Branch from `main`. `main` takes changes only through pull requests, and CI has to pass.
- Commit messages follow the `type: summary` form (`fix:`, `feat:`, `docs:`, `chore:`), with a body that says why.
- Add a line to [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

By contributing you agree that your work is released under the [MIT license](LICENSE), and that you'll follow the [Code of Conduct](CODE_OF_CONDUCT.md).
