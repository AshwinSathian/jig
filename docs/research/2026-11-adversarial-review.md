# Adversarial review of plan-engineering v1.0

Reviewed 2026-11-25 against the skill as imported in commit `16c5eb7` (files dated 2026-07-06). Evidence comes from three places: research and vendor guidance published up to November 2026, the current Claude Code skill docs, and the 25 PLAN files this skill and its neighbours have produced across `~/Documents/Personal`.

## Verdict

v1.0 is a human-team RFC generator attached to a coding agent. It was built for a reader who no longer exists in this workflow: a mid-level engineer who gets a kickoff-free handoff, owners per open question, and day estimates. The reader that actually runs the plan is an agent with the repo already in reach, and the reader who reviews it is one person with limited attention. Most of the template either pays for content that reader cannot use or asks the model to grade its own work.

The core idea holds up and should be kept: plan before building when the work is ambiguous or multi-step, ground the plan in real code, and make "done" checkable. Nearly everything around that idea needs to change.

Findings are ordered by how much they hurt outcomes, not by where they appear in the file.

## 1. The plan is a static document, but the work treats it as live state

The skill writes the plan, prints a summary and stops. Nothing says how execution uses the plan, when it gets updated, or how a new session resumes from it.

Your own plans show the gap. The ones that succeeded grew sections the template lacks:

- `wayfarer/PLAN-airtight-remediation.md` opens with "0. Where the plan stands (2026-10-15, end of session 10 ...)" and carries a change log, a traceability matrix (audit finding to tasks), an adversarial review log and a measurements appendix "filled during execution".
- `weir/PLAN-weir.md` records release state in its Status line and added "v1.1: Hardening after the adversarial review".
- `wayfarer` and `humanize-writing-skill` use a `LOCKED vN` status with rules for post-lock changes. `brnr` uses a Decision Log.

The template's only status is `PROPOSED` (or `OPEN FOR REVIEW`). `booklet/PLAN-product-roadmap.md` still says `OPEN FOR REVIEW` with 21 of 79 boxes ticked, a month after work started.

The research points the same way. Anthropic's long-running harness has every session read a progress file and the git log, then run a smoke test before doing anything ("Effective harnesses for long-running agents", Anthropic Engineering, 26 Nov 2025). Liu et al. found that periodic plan reminders cut plan violations across 21,120 SWE-agent trajectories ("From Plan to Action", arXiv 2604.12147).

What v2 needs: a status block at the top that execution keeps current, a lifecycle (draft, approved, in progress, shipped, abandoned), a decision log for post-approval changes, the commit the plan was baselined against, and a resume procedure a fresh session can follow.

## 2. The self-check is graded by the model that wrote the plan

Step 5 asks the author to tick 10 boxes and fix whatever fails. Without external feedback, models do not reliably correct their own reasoning and sometimes get worse (Huang et al., ICLR 2024; Kamoi et al., TACL 2024). Models also prefer text they recognise as their own (Panickssery et al., NeurIPS 2024). Anthropic's harness post says "agents reliably skew positive when grading their own work", and the Fable 5 prompting guide says fresh-context verifier subagents tend to beat self-critique.

Several of the 10 items can't fail in practice. "Open questions section exists (even if empty)" passes as soon as the heading is there. "A mid-level engineer could start Phase 1" is a judgment the author will always make in its own favour.

What v2 needs: split the checks. Mechanical items (sections present, no banned vague words, every task has an AC, every cited path exists in the repo) belong in a script that returns pass or fail. Judgment items belong to a fresh-context reviewer subagent that gets the plan and the repo, not the drafting conversation. Run the reviewer only at the larger scales, because a reviewer asked to find problems always finds some (Claude Code best practices).

## 3. Acceptance criteria are prose, and nothing protects them

"AC: unit test passes for 1k row fixture" is a sentence the executing agent interprets. Nothing stops it from editing the test, loosening the fixture, or deciding the criterion was met. Reward hacking by test tampering is documented and hard to prompt away. METR found o3 hacked in 30.4% of RE-Bench runs and "please do not cheat" had a "nearly negligible" effect (METR, 5 Jun 2025). ImpossibleBench shows test modification and monkey-patching as the main routes (Zhong, Raghunathan, Carlini, arXiv 2510.20270).

Anthropic's harness stores features as JSON whose only editable field is `passes`, and tells the agent "It is unacceptable to remove or edit tests."

What v2 needs: each AC written as a command or test with its expected result. For Standard and up, a machine-readable checklist beside the prose. A rule that acceptance tests are fixed before implementation, may not be edited without a logged decision the human sees, and that a conflict between spec and test stops work and gets reported.

## 4. Sizing in human hours is unsupported, and the "choose larger" rule inflates it

The tiers are defined in hours and days, the plans carry day estimates, and the summary reports "phases with time estimates".

- Weir's plan estimated about 30 weeks for Phases 0 to 3 (1 + 14 + 5 + 3 + 3 + 4). The plan is dated 2026-09-27, and v1.0.0 and v1.1.0 shipped on 2026-10-12 and 2026-10-13. The estimate was off by more than 10x.
- Agents misjudge their own runtimes by a typical factor of 2.9x (Ofengenden & Andriushchenko, "AgentTime", arXiv 2610.09944, preprint). The researcher found no study of LLM estimates of human-team effort against actuals, so these numbers are unvalidated.
- METR's time-horizon work measures task difficulty in human time and states it is not how long an agent runs (metr.org/time-horizons, last updated 8 Sep 2026).

"When uncertain, choose the larger" makes this worse. `pinfall`, `swish` and `clover` each label an 80-line plan for a small static game "Epic (new product, about 15 files ...)". The tier ends up describing the template that was used, not the size of the work.

File count is a better signal. Agent success falls sharply as patches span more files (SWE-bench-Live and SWE-EVO results; the file-count figures were seen only in search excerpts and are not fully verified).

What v2 needs: size by what has to be checked (how many independently verifiable slices, files touched, whether the change is reversible, whether it touches data or public contracts). Drop day estimates, or mark any that remain as guesses. Size slices to what one session can finish and verify, which is the unit Anthropic's harness uses. Retire "choose larger"; when unsure, start small and escalate.

## 5. The template is long, and long plans don't get reviewed

There is no size budget. `wayfarer/PLAN-airtight-remediation.md` is 750,845 bytes and 1,651 lines, with 72 lines over 2,000 characters; `wayfarer/PLAN-design.md` is 293 KB. At about four bytes a token, the airtight plan is roughly 190k tokens, so a resuming agent can't even read it whole in a normal context, never mind a person reviewing it.

The practitioner literature has turned against heavy plans. Böckeler tested Kiro, spec-kit and Tessl and found the markdown "very verbose and tedious to review"; Kiro turned a small bug into 4 user stories and 16 acceptance criteria (martinfowler.com, 15 Oct 2025). Thoughtworks Radar Vol. 35 keeps spec-driven development at Assess. Dex Horthy's March 2026 retraction of his own research-plan-implement method reportedly says a 1,000-line plan produces about 1,000 lines of code and saves no review effort, and moves the reviewed artifact to a short design discussion plus a signatures-only outline. That source was seen only in secondary summaries, so treat the details as reported.

Liu et al. add the sharper point: a subpar plan hurts more than no plan, and extra early phases can hurt when they clash with the model's own approach.

What v2 needs: two layers. A short human layer (about one screen: goal, done-when, decisions with reasons, what is out of scope, the questions only the human can answer) is the thing the person approves. An agent layer (slices, checks, file pointers) can be longer and is never the review surface. Give each scale a hard length budget. When a plan outgrows it, split it or archive finished phases instead of appending.

## 6. Quotas produce filler

"Non-goals (≥ 2)", "At least 1 risk", "≥ 2 real alternatives", "Open questions (even if empty)" all set minimum counts. A model under a quota fills it. The second non-goal is often invented to meet the count, and the risk matrix gets a risk because one is required, not because one was found.

The L×M risk matrix makes it worse. Risk matrices correctly rank under 10% of random hazard pairs and can do worse than random when frequency and severity are negatively correlated (Cox, Risk Analysis 28(2), 2008). An LLM's ordinal guesses multiplied into a score of 6 add precision that isn't there. The `epic-migration` eval even requires data loss to be scored exactly 9.

The alternatives section never asks for the subtractive option. People overlook fixes that remove something (Adams et al., Nature 2021), and GPT-4 does so more than people (Uhler et al., 2026, cited in your no-slop rules).

What v2 needs: replace counts with conditions ("list a non-goal when a reader would otherwise assume it is in scope"). Risks become a short list, each with how you'd notice it and the fallback, with no score. Alternatives must include "don't build it" or "change something that exists" whenever either is plausible.

## 7. Questions come at the wrong time, and in the wrong number

Step 1.5 allows exactly one question, and only when one ambiguity would make the plan "materially wrong". Open questions are otherwise collected at the end of the plan with an owner and a date.

Asking matters: interaction gave up to 74% gains on underspecified SWE-bench issues, but models struggle to tell well-specified tasks from underspecified ones (Vijayvargiya et al., "Ambig-SWE", ICLR 2026). A scaffold that checks for underspecification as a separate step reached 69.4% on underspecified SWE-bench Verified, against 70.8% with full specs, and asked fewer questions on simple tasks (Edwards & Schuster, "Ask or Assume?", EMNLP 2026).

What v2 needs: an explicit ambiguity check before any drafting. Ask the questions whose answers would change the plan, batched in one AskUserQuestion call, with a recommended default for each. State and log everything else as an assumption. Owners and dates on questions only make sense when the plan has more than one person behind it.

## 8. Prompting style is pre-Claude-4.5 and will over-fire

- "Execute every step in order. Do not skip.", "Non-negotiable", and a fixed six-step procedure are the patterns current guidance says to remove. Anthropic's prompting guide says Opus 4.5 and 4.6 "might now overtrigger" on aggressive language. Claude Code best practices say piled-on emphasis makes Claude over-apply a rule, and a rule that can't bend should be a hook. The Fable 5 guide says skills written for prior models "are often too prescriptive ... and can degrade output quality", and recommends general instructions over hand-written step lists.
- No rule carries a reason. The Fable 5 guide says "give the reason, not only the request."
- The trigger list includes "build", "implement", "design", "let's work on" and "integrate with". With the memory note telling every session "Do NOT skip the planner", nearly every coding request routes through a planning step. That overlaps `superpowers:brainstorming`, `superpowers:writing-plans` (which produced `booklet/PLAN-typeset-redesign-pr1.md`) and built-in plan mode, and the skill says nothing about how it relates to any of them.
- Step 3 tells the agent to "Look for prior decisions" and Step 1 to "Read every file in the codebase that relates". Restating the repo in the plan is the content Gloaguen et al. found added over 20% cost with no success gain ("Evaluating AGENTS.md", arXiv 2602.11988). The plan should record what the repo doesn't already say.

What v2 needs: plain instructions with reasons, critical rules first, a narrow description that fires on multi-step or ambiguous work, and an explicit position on plan mode and the superpowers planning skills (defer to them, replace them, or hand off to them).

## 9. Defects in the skill file itself

These are bugs, independent of the design questions above.

- **Quick-plan mode contradicts itself.** Line 17 says "Skip Steps 3–5 and go straight to Step 4". Step 4 is inside the skipped range.
- **Step order is wrong.** Scale is assessed and the file named in Step 2, before the codebase is explored in Step 3. Step 1.2 already says to read every related file, so Step 3 repeats it.
- **The injected "Existing Plans" `find` has no prune and no depth limit.** It walks `node_modules`, `.venv` and build output on every invocation. The structure listing above it prunes those; this one doesn't. `git status --short` is also unbounded, so a dirty repo with thousands of changes dumps all of them into context.
- **`allowed-tools: Read Bash Glob Grep` doesn't do what it looks like.** Per the current docs it pre-approves those tools for the invoking turn and restricts nothing. Bare `Bash` pre-approves every shell command for that turn, including destructive ones, which is broader than a planning skill needs. It also leaves out `Write`, which Step 4 requires, so writing the plan prompts anyway. Scope it to the commands the skill runs, for example `Bash(git log:*)`.
- **No `name` field.** Claude Code falls back to the directory name. The Agent Skills spec (agentskills.io) requires `name`, so the skill is not portable as written.
- **`ultrathink` plus `effort: high` conflict.** The current model-config docs say `ultrathink` raises the turn to `xhigh` in the terminal, VS Code and the desktop app, so the frontmatter's `high` is overridden on those surfaces. Pick one.
- **Plans go to the project root.** Your later projects moved them to `docs/PLAN.md`. The root fills up (wayfarer has three PLAN files there, booklet five).
- **Examples invent facts.** "Enterprise deal #4312", "@eng-lead", "MIT license, actively maintained" and the "Finance users export data manually" background are made up. A model calibrating on them learns to fill Background with plausible invention, which your no-slop rule forbids.
- **The Epic template uses emoji section headers and on-call, alerting and "3 months from now" prompts.** For a solo developer running agents these produce boilerplate.

## 10. The evals can't tell whether the skill helps

`evals/evals.json` lists expected behaviours as prose with no grader, runner or baseline. Several are contested by the research above: `ambiguous-goal` requires exactly one question, and `epic-migration` requires a fixed risk score. The pass-rate target is 1.0 on prose criteria nobody runs. The trigger-negative cases say they "depend on Claude's skill selection, not skill execution", which is exactly what a trigger eval is for.

The most important missing comparison is against no skill. Fan et al. found planning mostly helps weaker models and, for stronger ones, mainly cuts cost with little accuracy change ("An Empirical Study of Harness Design for Coding Agents", arXiv 2609.20804; abstract only). Anthropic dropped sprint decomposition from its own harness for Opus 4.6. If plain Opus 5.5 in plan mode matches the skill on a task set, the skill isn't earning its tokens at that scale.

What v2 needs: a runnable eval suite (`claude plugin eval` or skill-creator's format; the two don't read each other's files), with a no-skill and a plan-mode baseline, trigger evals that include near-misses, graders that check the plan file mechanically, and at least one execution eval where a fresh agent carries out the plan and the checks decide the outcome.

## What to keep

- Grounding in real paths and symbols, with "to be created" for new code.
- Binary acceptance criteria as the unit of "done".
- Non-goals as a concept, without the count.
- "Wrong is better than vague", restated as "state the assumption".
- Writing the plan to disk instead of only into chat.
- A short summary in chat that points to the file.

## Decisions for the owner before v2

1. **Primary reader.** A solo developer driving agents (the field evidence), or teams too. This decides whether owners, dates and the RFC tier survive.
2. **Relation to plan mode and superpowers.** Replace, wrap, or defer to `superpowers:writing-plans` and built-in plan mode.
3. **Trigger breadth.** Auto-trigger on multi-step work, or run only when invoked (`disable-model-invocation: true`) and let your memory note decide.
4. **Autonomy mode.** Lightkeeper's plan says "owner asked for zero intervention; every decision below is made, not proposed". Should v2 support approval-gated and autonomous modes explicitly?
5. **Name and packaging.** Keep `plan-engineering`, or rename before publishing. Ship as a Claude Code plugin, through `npx skills add` like loupe, or both.

## Evidence that was not fully verified

These were seen only in secondary sources or excerpts and should be checked before any public claim rests on them: the specifics of Horthy's March 2026 retraction, METR doubling times and per-model horizons, ImpossibleBench rate figures, SWE-bench-Live file-count figures, and Fan et al. beyond the abstract. No controlled study compares a full-template plan with a minimal plan on frontier agents. The case against heavy templates rests on one ablation, one plan-quality study and consistent vendor and practitioner reports.

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
