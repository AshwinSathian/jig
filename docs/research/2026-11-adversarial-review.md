# Adversarial review of plan-engineering v1.0

Reviewed 2026-11-25 against the skill as imported in commit `16c5eb7` (files dated 2026-07-06). Evidence comes from three places: research and vendor guidance published up to November 2026, the current Claude Code skill docs, and the 25 PLAN files this skill and its neighbours have produced across `~/Documents/Personal`.

## Verdict

v1.0 is a human-team RFC generator attached to a coding agent. It was built for a reader who no longer exists in this workflow: a mid-level engineer who gets a kickoff-free handoff, owners per open question, and day estimates. The reader that actually runs the plan is an agent with the repo already in reach, and the reader who reviews it is one person with limited attention. Most of the template either pays for content that reader can't use or asks the model to grade its own work.

The core idea holds up, and we should keep it — plan before building when the work is ambiguous or multi-step, ground the plan in real code, and make "done" checkable. Nearly everything around that idea needs to change.

We've ordered the findings by how much they hurt outcomes, not by where they appear in the file.

## 1. The plan is a static document, but the work treats it as live state

The skill writes the plan, prints a summary and stops. Nothing says how execution uses the plan, when it gets updated, or how a new session resumes from it.

Your own plans show the gap. The ones that succeeded grew sections the template lacks:

- `wayfarer/PLAN-airtight-remediation.md` opens with "0. Where the plan stands (2026-10-15, end of session 10 ...)" and carries a change log, a traceability matrix (audit finding to tasks), an adversarial review log and a measurements appendix "filled during execution".
- `weir/PLAN-weir.md` records release state in its Status line and added "v1.1: Hardening after the adversarial review".
- `wayfarer` and `humanize-writing-skill` use a `LOCKED vN` status with rules for post-lock changes. `brnr` uses a Decision Log.

The template's only status is `PROPOSED` (or `OPEN FOR REVIEW`). `booklet/PLAN-product-roadmap.md` still says `OPEN FOR REVIEW` with 21 of 79 boxes ticked — a month after work started.

The research points the same way. Anthropic's long-running harness has every session read a progress file and the git log, then run a smoke test before doing anything ("Effective harnesses for long-running agents", Anthropic Engineering, 26 Nov 2025). Liu et al. found that periodic plan reminders cut plan violations across 21,120 SWE-agent trajectories ("From Plan to Action", arXiv 2604.12147).

What v2 needs: a status block at the top that execution keeps current, a lifecycle (draft, approved, in progress, shipped, abandoned), a decision log for post-approval changes, the commit the plan was baselined against, and a resume procedure a fresh session can follow.

## 2. The self-check is graded by the model that wrote the plan

Step 5 asks the author to tick 10 boxes and fix whatever fails. Without external feedback, models do not reliably correct their own reasoning and sometimes get worse (Huang et al., ICLR 2024; Kamoi et al., TACL 2024). Models also prefer text they recognise as their own (Panickssery et al., NeurIPS 2024). Anthropic's harness post says "agents reliably skew positive when grading their own work", and the Fable 5 prompting guide says fresh-context verifier subagents tend to beat self-critique.

Several of the 10 items can't fail in practice. "Open questions section exists (even if empty)" passes as soon as the heading is there. "A mid-level engineer could start Phase 1" is a judgment the author will always make in its own favour.

What v2 needs: split the checks. Mechanical items (sections present, no banned vague words, every task has an AC, every cited path exists in the repo) belong in a script that returns pass or fail. Judgment items belong to a fresh-context reviewer subagent that gets the plan and the repo, not the drafting conversation. Run the reviewer only at the larger scales — a reviewer asked to find problems always finds some (Claude Code best practices).

## 3. Acceptance criteria are prose, and nothing protects them

"AC: unit test passes for 1k row fixture" is a sentence the executing agent interprets. Nothing stops it from editing the test, loosening the fixture, or deciding the criterion was met. Reward hacking by test tampering is documented, and it's hard to prompt away. METR found o3 hacked in 30.4% of RE-Bench runs and "please do not cheat" had a "nearly negligible" effect (METR, 5 Jun 2025). ImpossibleBench shows test modification and monkey-patching as the main routes (Zhong, Raghunathan, Carlini, arXiv 2510.20270).

Anthropic's harness stores features as JSON whose only editable field is `passes`, and tells the agent "It is unacceptable to remove or edit tests."

What v2 needs: each AC written as a command or test with its expected result. For Standard and up, a machine-readable checklist beside the prose. A rule that acceptance tests are fixed before implementation, may not be edited without a logged decision the human sees, and that a conflict between spec and test stops work and gets reported.

## 4. Sizing in human hours is unsupported, and the "choose larger" rule inflates it

The tiers are defined in hours and days, the plans carry day estimates, and the summary reports "phases with time estimates".

- Weir's plan estimated about 30 weeks for Phases 0 to 3 (1 + 14 + 5 + 3 + 3 + 4). The plan is dated 2026-09-27, and v1.0.0 and v1.1.0 shipped on 2026-10-12 and 2026-10-13. The estimate was off by more than 10x.
- Agents misjudge their own runtimes by a typical factor of 2.9x (Ofengenden & Andriushchenko, "AgentTime", arXiv 2610.09944, preprint). The researcher found no study of LLM estimates of human-team effort against actuals — so these numbers are unvalidated.
- METR's time-horizon work measures task difficulty in human time and states it is not how long an agent runs (metr.org/time-horizons, last updated 8 Sep 2026).

"When uncertain, choose the larger" makes this worse. `pinfall`, `swish` and `clover` each label an 80-line plan for a small static game "Epic (new product, about 15 files ...)". The tier ends up describing the template that was used — not the size of the work.

File count is a better signal. Agent success falls sharply as patches span more files (SWE-bench-Live and SWE-EVO results; the file-count figures were seen only in search excerpts and are not fully verified).

What v2 needs: size by what has to be checked (how many independently verifiable slices, files touched, whether the change is reversible, whether it touches data or public contracts). Drop day estimates, or mark any that remain as guesses. Size slices to what one session can finish and verify, which is the unit Anthropic's harness uses. Retire "choose larger" — when you're unsure, start small and escalate.

## 5. The template is long, and long plans don't get reviewed

There is no size budget. `wayfarer/PLAN-airtight-remediation.md` is 750,845 bytes and 1,651 lines, with 72 lines over 2,000 characters; `wayfarer/PLAN-design.md` is 293 KB. At about four bytes a token, the airtight plan is roughly 190k tokens, so a resuming agent can't even read it whole in a normal context — never mind a person reviewing it.

The practitioner literature has turned against heavy plans. Böckeler tested Kiro, spec-kit and Tessl and found the markdown "very verbose and tedious to review"; Kiro turned a small bug into 4 user stories and 16 acceptance criteria (martinfowler.com, 15 Oct 2025). Thoughtworks Radar Vol. 35 keeps spec-driven development at Assess. Dex Horthy's March 2026 retraction of his own research-plan-implement method reportedly says a 1,000-line plan produces about 1,000 lines of code and saves no review effort, and moves the reviewed artifact to a short design discussion plus a signatures-only outline. That source was seen only in secondary summaries, so treat the details as reported.

Liu et al. add the sharper point: a subpar plan hurts more than no plan, and extra early phases can hurt when they clash with the model's own approach.

What v2 needs: two layers. A short human layer (about one screen: goal, done-when, decisions with reasons, what is out of scope, the questions only the human can answer) is the thing the person approves. An agent layer (slices, checks, file pointers) can be longer, and it's never the review surface. Give each scale a hard length budget. When a plan outgrows it, split it or archive finished phases instead of appending.

## 6. Quotas produce filler

"Non-goals (≥ 2)", "At least 1 risk", "≥ 2 real alternatives", "Open questions (even if empty)" all set minimum counts. A model under a quota fills it. The second non-goal is often invented to meet the count, and the risk matrix gets a risk because one is required — not because one was found.

The L×M risk matrix makes it worse. Risk matrices correctly rank under 10% of random hazard pairs and can do worse than random when frequency and severity are negatively correlated (Cox, Risk Analysis 28(2), 2008). An LLM's ordinal guesses multiplied into a score of 6 add precision that isn't there. The `epic-migration` eval even requires data loss to be scored exactly 9.

The alternatives section never asks for the subtractive option. People overlook fixes that remove something (Adams et al., Nature 2021), and GPT-4 does so more than people (Uhler et al., 2026, cited in your no-slop rules).

What v2 needs: replace counts with conditions ("list a non-goal when a reader would otherwise assume it is in scope"). Risks become a short list — each with how you'd notice it and the fallback, and no score. Alternatives must include "don't build it" or "change something that exists" whenever either is plausible.

## 7. Questions come at the wrong time, and in the wrong number

Step 1.5 allows exactly one question, and only when one ambiguity would make the plan "materially wrong". Open questions are otherwise collected at the end of the plan with an owner and a date.

Asking matters: interaction gave up to 74% gains on underspecified SWE-bench issues — but models struggle to tell well-specified tasks from underspecified ones (Vijayvargiya et al., "Ambig-SWE", ICLR 2026). A scaffold that checks for underspecification as a separate step reached 69.4% on underspecified SWE-bench Verified, against 70.8% with full specs, and asked fewer questions on simple tasks (Edwards & Schuster, "Ask or Assume?", EMNLP 2026).

What v2 needs: an explicit ambiguity check before any drafting. Ask the questions whose answers would change the plan — batched in one AskUserQuestion call, with a recommended default for each. State and log everything else as an assumption. Owners and dates on questions only make sense when the plan has more than one person behind it.

## 8. Prompting style is pre-Claude-4.5 and will over-fire

- "Execute every step in order. Do not skip.", "Non-negotiable", and a fixed six-step procedure are the patterns current guidance says to remove. Anthropic's prompting guide says Opus 4.5 and 4.6 "might now overtrigger" on aggressive language. Claude Code best practices say piled-on emphasis makes Claude over-apply a rule, and a rule that can't bend should be a hook. The Fable 5 guide says skills written for prior models "are often too prescriptive ... and can degrade output quality", and recommends general instructions over hand-written step lists.
- No rule carries a reason. The Fable 5 guide says "give the reason, not only the request."
- The trigger list includes "build", "implement", "design", "let's work on" and "integrate with". With the memory note telling every session "Do NOT skip the planner", nearly every coding request routes through a planning step. That overlaps `superpowers:brainstorming`, `superpowers:writing-plans` (which produced `booklet/PLAN-typeset-redesign-pr1.md`) and built-in plan mode — and the skill says nothing about how it relates to any of them.
- Step 3 tells the agent to "Look for prior decisions" and Step 1 to "Read every file in the codebase that relates". Restating the repo in the plan is the content Gloaguen et al. found added 20–23% cost with no significant success change ("Evaluating AGENTS.md", arXiv 2602.11988). The plan should record what the repo doesn't already say.

What v2 needs: plain instructions with reasons, critical rules first, a narrow description that fires on multi-step or ambiguous work, and an explicit position on plan mode and the superpowers planning skills (defer to them, replace them, or hand off to them).

## 9. Defects in the skill file itself

These are bugs, independent of the design questions above.

- **Quick-plan mode contradicts itself.** Line 17 says "Skip Steps 3–5 and go straight to Step 4". Step 4 is inside the skipped range.
- **Step order is wrong.** Scale is assessed and the file named in Step 2, before the codebase is explored in Step 3. Step 1.2 already says to read every related file, so Step 3 repeats it.
- **The injected "Existing Plans" `find` has no prune and no depth limit.** It walks `node_modules`, `.venv` and build output on every invocation. The structure listing above it prunes those — this one doesn't. `git status --short` is also unbounded, so a dirty repo with thousands of changes dumps all of them into context.
- **`allowed-tools: Read Bash Glob Grep` doesn't do what it looks like.** Per the current docs it pre-approves those tools for the invoking turn and restricts nothing. Bare `Bash` pre-approves every shell command for that turn, including destructive ones, which is broader than a planning skill needs. It also leaves out `Write` — which Step 4 requires — so writing the plan prompts anyway. Scope it to the commands the skill runs, for example `Bash(git log:*)`.
- **No `name` field.** Claude Code falls back to the directory name. The Agent Skills spec (agentskills.io) requires `name`, so the skill is not portable as written.
- **`ultrathink` plus `effort: high` conflict.** The current model-config docs say `ultrathink` raises the turn to `xhigh` in the terminal, VS Code and the desktop app, so the frontmatter's `high` is overridden on those surfaces. Pick one.
- **Plans go to the project root.** Your later projects moved them to `docs/PLAN.md`. The root fills up (wayfarer has three PLAN files there, booklet five).
- **Examples invent facts.** "Enterprise deal #4312", "@eng-lead", "MIT license, actively maintained" and the "Finance users export data manually" background are made up. A model calibrating on them learns to fill Background with plausible invention, which your no-slop rule forbids.
- **The Epic template uses emoji section headers and on-call, alerting and "3 months from now" prompts.** For a solo developer running agents these produce boilerplate.

## 10. The evals can't tell whether the skill helps

`evals/evals.json` lists expected behaviours as prose with no grader, runner or baseline. Several are contested by the research above: `ambiguous-goal` requires exactly one question, and `epic-migration` requires a fixed risk score. The pass-rate target is 1.0 on prose criteria nobody runs. The trigger-negative cases say they "depend on Claude's skill selection, not skill execution" — which is exactly what a trigger eval is for.

The most important missing comparison is against no skill. Fan et al. found planning mostly helps weaker models and, for stronger ones, mainly cuts cost with little accuracy change ("An Empirical Study of Harness Design for Coding Agents", arXiv 2609.20804; abstract only). Anthropic dropped sprint decomposition from its own harness for Opus 4.6. If plain Opus 5.5 in plan mode matches the skill on a task set, the skill isn't earning its tokens at that scale.

What v2 needs: a runnable eval suite (`claude plugin eval` or skill-creator's format; the two don't read each other's files), with a no-skill and a plan-mode baseline, trigger evals that include near-misses, graders that check the plan file mechanically, and at least one execution eval where a fresh agent carries out the plan and the checks decide the outcome.

## What to keep

- Grounding in real paths and symbols, with "to be created" for new code.
- Binary acceptance criteria as the unit of "done".
- Non-goals as a concept, without the count.
- "Wrong is better than vague", restated as "state the assumption".
- Writing the plan to disk instead of only into chat.
- A short summary in chat that points to the file.

## 11. The plan stops at planning, but most AI code failures happen after it

This section adds the owner's earlier research on AI-native engineering, and we checked each figure against its primary source on 2026-11-25. v1.0 has a "Testing Strategy" heading and nothing else downstream. It has no view of how AI-written code fails, so the plan can't aim its checks at those failures.

### How AI-written code fails, and where a plan can catch it

| Failure | Evidence | Where v2 catches it |
|---|---|---|
| Tests that mirror the code | Owner's research; consistent with ImpossibleBench | Acceptance examples written from the spec before code; mutation testing (Stryker) on the slice's code at tier 2; edits to protected tests ask first |
| Swallowed errors | GitClear, "The Maintainability Gap" (2026, 623M changes): error-masking constructs +47%, meaning catch blocks, safe navigation and stubbed methods that hide unexpected input | Doctor checks for an empty-catch lint rule; the diff reviewer reads every catch block |
| Duplication over reuse | GitClear, same report: code block duplication +81%, within-commit copy/paste +41% | The survey step lists existing helpers before drafting; the plan names what it reuses; the reviewer flags new helpers with near-duplicates |
| Invented packages and APIs | Spracklen et al., USENIX Security 2025: 43% of hallucinated package names repeated in all 10 re-runs, 58% repeated more than once | New dependencies are a one-way door that needs a gate; the Bash hook asks on installs; lockfile diffs are checked |
| Plausible wrong logic | CodeRabbit, 17 Dec 2025 (470 PRs): logic and correctness issues 75% more common in AI PRs | Worked examples in the spec; property-based tests (fast-check) where a rule has invariants |
| Insecure defaults | Owner's research | Security prompts in the fundamentals reference; SAST in doctor's CI check; auth paths flagged for a human to read |
| Performance blind spots | CodeRabbit: excessive I/O about 8x more common in AI PRs (the report doesn't break out N+1 queries) | Perf checks with thresholds when a slice touches a hot path; agents don't measure unless a check makes them |
| Scope creep | Owner's research; Böckeler | Each slice lists the files it may touch; the Edit hook warns outside them; diff-size limits per slice |
| False completion claims | Replit/SaaStr, July 2025 (The Register, 21 Jul 2025): the agent said rollback was impossible, and it wasn't | Check evidence (command, exit code, output line) goes in the Log; the Stop hook runs the fast checks |
| Context rot | Chroma "Context Rot" 2025; Anthropic harness posts | One slice per session; the plan is the external memory; a SessionStart status line |
| Destructive action in the wrong environment | Same Replit incident: the agent deleted a production database during a freeze it had been told about | Production and infrastructure changes are one-way doors; doctor reports agent-readable credentials. A freeze is enforced by permissions, and jig never claims a prompt enforces it. |

### Engineering fundamentals as triggered prompts

The owner's list covers algorithms, concurrency, databases, networking and OS, performance, distributed systems, software design and security. v1.0 has none of it. v2 shouldn't add it as a fixed checklist either — a checklist of eight areas on every plan is the quota problem from finding 6 again. Each area becomes a short set of questions in `references/fundamentals.md`, loaded only when the slice touches that area. For example, a slice that adds a queue consumer loads the concurrency and distributed-systems questions: idempotency, unbounded concurrency, retry storms, partial failure, and "exactly-once" assumptions.

### Need to mechanism

The owner's table maps each need to one mechanism: a rule that must always hold goes to a deny rule or hook, a convention to a short CLAUDE.md, a procedure to a skill, isolated investigation to a subagent, and outside access to an MCP server. Current Claude Code guidance says the same: a rule that can't bend should be a hook. v1.0 puts everything in prose. v2 has a `guard` skill that applies this table when the same correction comes up twice, and the plan skill uses it to decide whether a requirement becomes a check, a hook or a sentence.

### Security that belongs in the plan

- **Lethal trifecta.** Private data, untrusted content and a way to send data out (Willison, 16 Jun 2025). A coding agent has all three by default. Plans that bring in untrusted input (issues, web pages, MCP output) should say which leg the session breaks.
- **Repo config is an execution vector.** Check Point (25 Feb 2026) disclosed CVE-2025-59536 (MCP servers started before the trust dialog could be read; patched 22 Sep 2025) and CVE-2026-21852 (API key exfiltration through `ANTHROPIC_BASE_URL` in `.claude/settings.json`; patched 28 Dec 2025). OSV and NVD list CVE-2026-33068 (permission mode read from settings before the trust prompt; fixed in 2.1.53) and CVE-2026-40068 (worktree `commondir` not validated, 2.1.63 through 2.1.83; fixed in 2.1.84). `jig doctor` reports `.claude/settings.json` and `.mcp.json` in a repo so the owner reads them first. It never edits them.
- **Supply chain and blast radius.** New packages are gated, as the slopsquatting row above describes. Doctor reports credentials and `.env` files readable without a deny rule. Production access is a one-way door.

### Operating model

Anthropic's trends post (21 Jan 2026) reports developers using AI in about 60% of their work but fully delegating only 0–20% of tasks. jig is designed for supervised work: the human reviews the short layer and the one-way doors, and machines check the rest. The owner's seven-step loop (outcome and checks, plan and review, small batch, machine verification, diff review, small commits, a guardrail when a failure repeats) is the order the plan and build skills follow. DORA's AI Capabilities Model (Sep 2025) lists strong version control, working in small batches and quality internal platforms among its seven capabilities. `jig doctor` checks the parts of a repo that support them, such as a one-command verify and fast tests.

### Production judgment

Irreversible decisions get human design: schema, partition keys, public APIs and the auth model are the one-way doors in the gate list. Safe-change patterns (feature flags, canaries, expand-and-contract migrations, rollback) are loaded when a slice changes something users run. Comprehension debt (Osmani, 14 Mar 2026) is the gap between code that exists and code anyone understands. That's why each finished slice ends with a two- or three-line explanation in the Log. At tier 2 and up, the human gets a short "explain this change" summary to check against the diff.

### Verification status of the owner's excerpts

We checked these against primary sources on 2026-11-25.

| Claim | Status | Correction |
|---|---|---|
| GitClear error-masking +47% | Verified through GitClear's own text in search results and LeadDev. GitClear blocks automated fetches. | Open the page once by hand before citing it publicly |
| CodeRabbit logic issues +75% | Verified | None |
| CodeRabbit performance 8x | Differs | The 8x is for excessive I/O only. The report doesn't mention N+1. |
| Replit incident | Verified (The Register) | None |
| Check Point CVEs | Verified | The article gives patch dates, not version numbers |
| CVE-2026-33068 and CVE-2026-40068 | Verified (OSV, NVD) | 40068 is fixed in 2.1.84 |
| Anthropic 60% use, 0–20% delegation | Verified in the blog post | The PDF report wasn't text-extractable |
| Gloaguen et al. | Differs | Cost +20–23%. Developer-written files +2.4% is also not significant (p = 21%). |
| Lethal trifecta, DORA, comprehension debt, slopsquatting, Stryker, fast-check | Verified | None |

## Owner decisions (2026-11-25)

1. **Primary reader.** Solo first. Some plans will involve a team or more than one engineer.
2. **Plan mode and superpowers.** Left to the reviewer. Resolved in the v2 plan: work inside plan mode, coexist with superpowers without depending on it.
3. **Trigger breadth.** Automatic, whenever an engineering task of any size is being planned.
4. **Autonomy.** By context, decided case by case.
5. **Name and packaging.** Rename. Ship a plugin with whatever hooks, skills and agents the work needs, and use loupe and humanizing-writing where they help.

The resulting design is in [docs/plans/jig-v2/PLAN.md](../plans/jig-v2/PLAN.md).

## Evidence that was not fully verified

These were seen only in secondary sources or excerpts and you should check them before any public claim rests on them: the specifics of Horthy's March 2026 retraction, METR doubling times and per-model horizons, ImpossibleBench rate figures, SWE-bench-Live file-count figures, and Fan et al. beyond the abstract. No controlled study compares a full-template plan with a minimal plan on frontier agents. The case against heavy templates rests on one ablation, one plan-quality study and consistent vendor and practitioner reports.

## Sources

- Anthropic, "Effective harnesses for long-running agents", 26 Nov 2025. https://anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Rajasekaran, "Harness design for long-running application development", Anthropic, 24 Mar 2026. https://anthropic.com/engineering/harness-design-long-running-apps
- Anthropic, "Prompting Claude Fable 5" and "Prompting Claude Fable 5.2". https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/
- Anthropic, Claude prompting best practices; Agent Skills best practices. https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Claude Code docs: skills, model-config, best-practices, plugin-evals, permission-modes. https://code.claude.com/docs/en/
- Agent Skills specification. https://agentskills.io/specification.md
- Liu, Dehghan, Ganhotra, Hirzel, Jabbarvand, "From Plan to Action: How Well Do Agents Follow the Plan?", arXiv 2604.12147.
- Fan et al., "An Empirical Study of Harness Design for Coding Agents", arXiv 2609.20804.
- Böckeler, "Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl", martinfowler.com, 15 Oct 2025.
- Thoughtworks Technology Radar Vol. 35, "Spec-driven development", Nov 2025.
- METR, "Time horizons" (updated 8 Sep 2026); "Recent frontier models are reward hacking", 5 Jun 2025; Becker et al., early-2025 developer RCT, 10 Jul 2025.
- Huang et al., "Large Language Models Cannot Self-Correct Reasoning Yet", ICLR 2024.
- Kamoi et al., "When Can LLMs Actually Correct Their Own Mistakes?", TACL 2024.
- Panickssery, Bowman, Feng, "LLM Evaluators Recognize and Favor Their Own Generations", NeurIPS 2024.
- Zhong, Raghunathan, Carlini, "ImpossibleBench", arXiv 2510.20270.
- Ofengenden & Andriushchenko, "AgentTime", arXiv 2610.09944.
- Cox, "What's Wrong with Risk Matrices?", Risk Analysis 28(2):497–512, 2008.
- Gloaguen et al., "Evaluating AGENTS.md", arXiv 2602.11988.
- Jaroslawicz et al., "How Many Instructions Can LLMs Follow at Once?", arXiv 2507.11538.
- Vijayvargiya et al., "Ambig-SWE", arXiv 2502.13069, ICLR 2026.
- Edwards & Schuster, "Ask or Assume?", arXiv 2603.26233, EMNLP 2026.
- Horthy, "Advanced Context Engineering for Coding Agents", HumanLayer, 29 Aug 2025.
- Adams et al., "People systematically overlook subtractive changes", Nature 2021.
- GitClear, "The Maintainability Gap: AI Code Quality in 2026". https://gitclear.com/the_ai_code_quality_maintainability_gap
- CodeRabbit, "State of AI vs human code generation", 17 Dec 2025. https://coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report
- The Register, Replit and SaaStr incident, 21 Jul 2025. https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/
- Check Point Research, CVE-2025-59536 and CVE-2026-21852, 25 Feb 2026. https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/
- NVD, CVE-2026-33068 and CVE-2026-40068. https://nvd.nist.gov/vuln/detail/CVE-2026-33068 · https://nvd.nist.gov/vuln/detail/CVE-2026-40068
- Anthropic, "Eight trends defining how software gets built in 2026", 21 Jan 2026. https://claude.com/blog/eight-trends-defining-how-software-gets-built-in-2026
- Willison, "The lethal trifecta for AI agents", 16 Jun 2025. https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- DORA AI Capabilities Model, Sep 2025. https://dora.dev/ai/capabilities-model
- Osmani, "Comprehension Debt", 14 Mar 2026. https://addyosmani.com/blog/comprehension-debt/
- Spracklen et al., "We Have a Package for You!", USENIX Security 2025. https://arxiv.org/abs/2406.10279
