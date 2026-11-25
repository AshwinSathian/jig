# Plans with more than one person

Use this when `git shortlog -sn --since=90.days` shows more than one active author, when the owner says others will work on the plan, or when several agents will run in parallel.

## What changes in the plan

- **Decisions:** add `Owner:` to a decision that someone other than the plan's author has to make. One-way decisions record who decided in `Decided: <who> <date>`.
- **Questions:** each question names who answers it: `- <question> Owner: <name>`.
- **Slices:** add `Owner:` when different people or agents take different slices.
- **ADRs:** at the program tier, each one-way decision gets a short ADR in the repo's ADR folder (or `docs/adr/NNNN-<slug>.md`) covering context, decision and consequences. Link it from Decisions. ADRs outlive plans, and they are the system model agents read before changing a boundary.

## Parallel work

- **One agent per git worktree**, so agents don't overwrite each other's files.
- **Split slices along module boundaries**, so parallel slices don't touch the same files. Overlapping `Touch:` lists mean a likely merge conflict, so sequence those slices instead.
- **Contracts first.** The slice that defines a shared interface or schema lands before the slices that build on it.
- **Each worktree runs `jig verify` for its own slice.** Merge only green slices.

## Review

- **One reviewer per slice**, with their depth set by risk: auth paths, migrations and public contracts get a line-by-line human read; the rest get the jig-reviewer diff pass plus a skim.
- **The PR description explains the change** in two or three sentences, links the plan and slice, and gives the evidence line from the Log. Required explanations, and a named owner for each module, keep the team's understanding of the code level with the code itself.
