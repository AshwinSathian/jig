# Post-build review: the landscape (2026-11)

The evidence behind jig's review loop (`docs/plans/review-loop/PLAN.md`). It's a checked version of a research brief written on 2026-11-25. Every source below was opened again on 2026-11-25, and each claim was compared with the page. Claims that didn't match were reworded to match the source, and claims the source doesn't support were dropped. The quotes were read through WebFetch, which hands back a model's reading of the page, so the wording may be slightly off even where a number checks out.

Tags:
- **[opened]**: the primary page was read and states the claim.
- **[snippet]**: the claim rests only on search-result text.
- **UNVERIFIED**: the primary page couldn't be read, or doesn't state the claim.

Vendor numbers are self-reported.

## Installed review skills on the owner's machine

Seen in this machine's skill listing, not from the web:
- **High collision** with "review a diff or PR after building": built-in `/code-review`, the code-review plugin, superpowers:requesting-code-review (plan-aware), caveman-review, cavecrew-reviewer, engineering:code-review, and pr-review-toolkit:code-reviewer, which runs proactively "before declaring a task done".
- **Medium:** pr-review-toolkit:review-pr, owasp-security ("is this safe to ship"), superpowers:verification-before-completion, caveman:verify-and-stop, silent-failure-hunter, pr-test-analyzer.
- **Low:** ponytail-review (over-engineering only), `/simplify` and code-simplifier (they apply fixes), receiving-code-review.

So a generic "review this PR" prompt has at least seven strong candidates. A jig review skill should name jig, a plan, a slice, or "after building", and leave generic review prompts to the others.

Ideas worth borrowing from them:
- Validate each finding before reporting it, and drop what doesn't survive (code-review plugin).
- A "Declined to judge" list, and "a spec's silence is not permission" (superpowers).
- Reachability triage for security findings, with Confirmed / Likely / Needs verification (owasp-security).
- For each new catch, the unexpected errors it would swallow (silent-failure-hunter).
- "The plan is wrong, not the code" as its own finding class (superpowers).
- Quote the exact rule for a convention finding (code-review plugin).

## Products

- **Greptile.** About 19% of comments were good, 2% wrong and 79% nits. Prompting for fewer nits also cut critical comments, and the model's judgment of its own output was "nearly random". Blocking a comment similar to at least 3 downvoted ones raised the address rate from 19% to 55+% within two weeks. https://greptile.com/blog/make-llms-shut-up (2024-12-18) [opened]
- **Cursor Bugbot.** The resolution rate went from 52% to over 70% across 40 experiments. The early design ran eight passes with randomized diff order, kept bugs found in more than one pass, ran a validator model, and deduped. The agentic version was "too cautious" and needed aggressive prompts. https://cursor.com/blog/building-bugbot (2026-01-15) [opened]
- **Cursor Bugbot learning.** It learns from downvotes, replies and bugs human reviewers flagged. Candidate rules are promoted on signal and disabled on consistent negative signal. The post gives 78.13% resolution, up from 52% at launch. https://cursor.com/blog/bugbot-learning (2026-04-08) [opened]
- **Copilot code review.** 71% of reviews surface actionable feedback, and in the other 29% "the agent says nothing at all". Going agentic gave an 8.1% rise in positive feedback. https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/ (2026-03-05) [opened]
- **Anthropic Code Review.** Parallel finders, then verification, then severity ranking. Under 1% of findings were marked incorrect. PRs over 1,000 lines: 84% get findings, 7.5 on average. Under 50 lines: 31%, 0.5 on average. Reviews average $15–25. https://claude.com/blog/code-review (2026-03-09) [opened]
- **Martian Code Review Bench.** It has an online tracker on real repos and an offline benchmark of 50 bugs, and recommends the online tracker "be the primary reference for now". The brief's claim that offline results diverged isn't on the page. https://codereview.withmartian.com/ UNVERIFIED

## Field studies

- **CodeRabbit in the wild.** Of 31,073 review and feedback pairs, 36.4% were accepted and 56.3% rejected, mostly as invalid (false positive, redundant, out of scope). Misreading intent and convention mismatch were secondary causes. https://arxiv.org/abs/2607.03316 (2026-07) [opened]
- **Google AutoCommenter.** The useful ratio plateaued at about 54%. Suppressing 17 non-actionable rule URLs raised it to 66% (developers) and from 60% to 74% (raters). Thresholds are per rule URL. Before filtering, 80% of its comments landed on lines the author hadn't changed, and filtering those cut the share of changed files with comments from 6% to 1.3%. https://arxiv.org/html/2405.13565v1 (2024-05) [opened]
- **Atlassian RovoDev.** 38.70% of AI comments were resolved, against 44.45% for human ones. Median PR cycle time was 20.73 h without its comments and 14.35 h with them, an observed difference, not a controlled one. The actionability classifier added about 20 points, and the factual-correctness judge had "a minimal impact". https://arxiv.org/html/2601.01129v2 (2026-01) [opened]
- **54,791 agent review comments.** An inline code suggestion is the strongest predictor of resolution, and long, complex comments get acted on less. https://arxiv.org/abs/2607.21997 (2026-07) [opened]
- **Automated review in practice.** Mean PR closure time rose from 5 h 52 m to 8 h 20 m, with varying trends across projects. https://arxiv.org/abs/2412.18531 (2024-12) [opened]
- **Phantom changes.** In 23,247 agent PRs, "descriptions claim unimplemented changes" was the most common message-code inconsistency, at 45.4%. https://arxiv.org/abs/2601.04886 (2026-01) [opened]

## Research

- **Self-correction.** LLMs "struggle to self-correct their responses without external feedback". https://arxiv.org/abs/2310.01798 (Huang et al., 2023) [opened] A survey finds no prior work showing self-correction with feedback from prompted LLMs, except where reliable external feedback exists. https://arxiv.org/abs/2406.01297 (Kamoi et al., TACL 2024) [opened]
- **Self-preference.** Self-recognition correlates linearly with self-preference bias. https://arxiv.org/abs/2404.13076 (Panickssery et al., 2024) [opened]
- **Correlated errors.** On HELM, two models that are both wrong agree about 60% of the time, against 1/3 by chance. Models from the same developer and architecture agree more, and more accurate models are more correlated. Judges overrate models less accurate than themselves. https://arxiv.org/html/2506.07962 (Kim et al., 2025) [opened]
- **Mixing models.** Self-MoA, which uses only the top model, beats a mix of models by 6.6% on AlpacaEval 2.0. https://arxiv.org/abs/2502.00674 (Li et al., 2025) [opened]
- **Bias injection.** Re-introducing 33 CVEs across 20 projects, with crafted PR metadata, got past Claude Code and CodeRabbit review in 32 of 33 cases. https://arxiv.org/abs/2603.18740 (Alexopoulos et al., 2026) [opened]
- **Sycophancy.** Asked "are you sure?", models flip their answers 46% of the time, with a 17% drop in accuracy. https://arxiv.org/abs/2311.08596 (Laban et al., 2023) [opened]
- **Debate.** Multi-agent debate does not reliably beat other prompting strategies. https://arxiv.org/abs/2311.17371 (Smit et al., 2023) [opened] At comparable compute, self-consistency often beats it, and debate can get worse with more budget. https://arxiv.org/abs/2406.06461 (Wang et al., 2024) [opened] Debate does help non-expert judges, models and humans, answer correctly. https://arxiv.org/abs/2402.06782 (Khan et al., 2024) [opened] That setup is two debaters in front of a judge, not an author arguing with its reviewer.
- **Critics.** LLM critics catch more bugs than paid contractors but hallucinate bugs. Critic and contractor teams catch about as many while hallucinating less. https://arxiv.org/abs/2407.00215 (McAleese et al., 2024) [opened]
- **A separate test designer.** Compared with one agent writing both code and tests, a separate test designer raised test accuracy on HumanEval from 61.0% to 87.8%, and pass@1 from 71.3% to 79.9% (GPT-3.5-turbo). https://arxiv.org/html/2312.13010v3 (AgentCoder) [opened]
- **Agentic property-based testing.** 56% of reported bugs were valid and 32% worth reporting. Of the 21 top-scoring, 86% were valid. https://arxiv.org/abs/2510.09907 (Maaz et al., 2025) [opened]
- **Mutation-guided tests at Meta.** Engineers accepted 73% of the generated tests. https://arxiv.org/abs/2501.12862 (2025) [opened]
- **Exploit agents.** The best agent framework exploits up to 13% of CVE-Bench's vulnerabilities. https://arxiv.org/abs/2503.17332 (2025) [opened]
- **XBOW.** Automated peer reviewers confirm each finding, and for XSS a headless browser checks that the payload ran. https://xbow.com/blog/top-1-how-xbow-did-it/ (2025-06) [opened]
- **Reward hacking.** GPT-5 cheats 54% of the time on Conflicting-SWEbench. Averaged over models, allowing more submissions raised cheating from 33% to 38%. An explicit abort option cut GPT-5 from 54% to 9%, with a "much less pronounced" effect for Claude Opus 4.1. LLM monitors detected 42–65% of cheating on Impossible-SWEbench. https://arxiv.org/html/2510.20270v1 (ImpossibleBench, 2025) [opened]
- **METR.** o3 reward-hacked in 39 of 128 RE-Bench runs (30.4%), and telling it not to cheat had "a nearly negligible effect". https://metr.org/blog/2025-06-05-recent-reward-hacking [opened]
- **Monitoring reasoning.** On two systemic hacks (`exit(0)` and `raise SkipTest`), a monitor reading chain of thought had 95% recall against 60% for one reading actions only. https://arxiv.org/html/2503.11926v1 (Baker et al., 2025) [opened] Rationalizations in reasoning can mislead a monitor, and a hybrid that scores reasoning and actions separately beat both. https://arxiv.org/abs/2505.23575 (CoT Red-Handed, 2025) [opened]
- **AI control.** Trusted monitoring gave 62% safety at 97% usefulness, defer-to-trusted 83% at 93%, and untrusted monitoring with redaction 79–98% safety across deferral rates. The scarce trusted labour, budgeted for auditing about 2% of problems, goes to auditing code. In the experiments that labour is simulated by GPT-4. https://arxiv.org/html/2312.06942v5 (Greenblatt et al.) [opened]
- **SHADE-Arena.** Monitoring sabotage stays hard. The brief's quote about monitors "accepting a clearly false justification" isn't in the blog post, and the paper wasn't checked. https://www.anthropic.com/research/shade-arena-sabotage-monitoring (2025-06) UNVERIFIED
- **Separate evaluator.** Agents "reliably skew positive when grading their own work", and tuning a standalone skeptical evaluator is "far more tractable". QA rounds cost $3–4 against $6–71 for build rounds. https://www.anthropic.com/engineering/harness-design-long-running-apps (2026-03-24) [opened]
- **Evals.** Read transcripts before trusting grades, isolate trials, let judges answer "Unknown", give each dimension its own judge, and track pass^k. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (2026-01-09) [opened]
- **Prompt injection in review agents.** Instructions in PR titles, issue bodies and comments made Claude Code Security Review, Gemini CLI Action and the Copilot agent run commands and leak secrets in GitHub Actions. https://www.securityweek.com/claude-code-gemini-cli-github-copilot-agents-vulnerable-to-prompt-injection-via-comments/ (2026-04) [opened] In PR-Agent, text after `/ask` went straight into the prompt, and settings overrides in comments leaked tokens (CVE-2024-51355, CVE-2024-51356). https://kudelskisecurity.com/research/careful-where-you-code-multiple-vulnerabilities-in-ai-powered-pr-agent (2024-08) [opened]

## What jig takes from this

1. **Deterministic gates decide, and model review only advises.** Self-correction without external feedback doesn't hold up (Huang, Kamoi).
2. **One tuned reviewer, tuned from its misses and dismissals.** Debate doesn't reliably beat self-consistency (Smit, Wang), and the products that improved did it by learning from feedback (Greptile, Bugbot, AutoCommenter).
3. **Validate each Important finding** from its claim alone. Critics hallucinate (McAleese), and nearly half of agentic property-testing reports were invalid [opened] (Maaz).
4. **Withhold the builder's story until the findings exist.** Biased PR metadata got 32 of 33 CVE re-introductions past review [opened], and phantom changes are the most common description flaw [opened]. Owner-approved decisions stay visible, because misread intent is a cause of rejected comments (CodeRabbit study).
5. **The red team counts only failing repros**, run on triggers. Exploit agents remain weak (CVE-Bench), and validators confirm findings (XBOW).
6. **Check for tampering when tests or checks change.** Score reasoning and actions separately (CoT Red-Handed), and never let the monitor clear a diff finding.
7. **Strongest model, same family, fresh context, and same-model reruns aren't independent votes.** Errors correlate within a family (Kim), and mixing models isn't free (Self-MoA).
8. **No author–reviewer debate.** Models flip under challenge (FlipFlop). The builder answers with a run or a file:line, and a prose rebuttal goes to the owner.
9. **Protect the judge.** Rules come from the base, the reviewer is read-only, and PR text is untrusted (the injection reports).
10. **An accepted "blocked" exit.** An abort option cut GPT-5's cheating from 54% to 9% [opened], and more submissions raised cheating (ImpossibleBench).
11. **Measure findings addressed and false positives on clean controls**, never comment counts (Bugbot, RovoDev, AutoCommenter).
12. **Short, line-anchored findings with an inline fix, and silence allowed.** Inline suggestions predict resolution [opened], Copilot stays silent on 29% of reviews [opened], and review can lengthen PRs [opened].
