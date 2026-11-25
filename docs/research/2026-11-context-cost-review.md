# Review: "cut LLM costs 50% with context management and prompt caching"

Reviewed 2026-11-25. The source is a LinkedIn post the owner shared. Facts below come from Anthropic's current prompt-caching and agent-design guidance, read through the bundled claude-api reference (cached 2026-11-03).

## Verdict

The direction's right, but two of its claims need correcting. Agent loops send far more input than output, so cache reads are where the money goes. Reads now cost 0.05x base input on Claude Opus 5.5 and Sonnet 5.5, and 0.025x on Fable 5.2. Cleaner context also helps accuracy (Chroma, "Context Rot", 2025). But the post presents its two levers as complementary — they conflict unless you design for both. The 50% figure has no baseline, workload or method, so it can't be checked.

## The claims, checked

| Claim | Holds? | What's missing |
|---|---|---|
| Agents carry full histories, stale tool output and step-specific instructions on every turn | Yes | Nothing |
| Decide what the model needs at each step; drop or summarise the rest | Partly | **Dropping or editing earlier turns is a history edit.** Caching is a prefix match: a change at position N invalidates everything after N. On Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.x, editing history also fails the preserved-thinking check and drops later thinking blocks. Pruning every turn can cost more than it saves. Summarising is lossy too: details the summary dropped get re-fetched (more cost) or guessed (worse quality). |
| Static first, dynamic last, then caching pays off | Yes | The silent invalidators that defeat it: a timestamp or user name in the system prompt, unsorted JSON in tools, adding or removing tools mid-session, switching models (caches are per model), and changing thinking or effort settings (invalidates the messages cache). You can verify with `usage.cache_read_input_tokens` instead of assuming. |
| System prompt and tools no longer billed at full price | Yes, with conditions | Writes cost 1.25x (5-minute TTL) or 2x (1-hour TTL). The minimum cacheable prefix is 512 to 4096 tokens depending on the model, and shorter prefixes silently don't cache. Traffic with gaps longer than the TTL pays the write again. |
| Cost and quality aren't always a trade-off | Partly | True at the start, false at the margin. Cutting context the next step needs lowers quality. Judge cost per **completed task**, not per request: a cheaper request that needs more turns or retries isn't cheaper. |
| Look at context before the model | Reasonable first step | Other levers it skips, cheapest first: effort level (lower effort on a newer model often matches higher effort on an older one), output length, smaller tool results at the source, fewer and consolidated tool calls, batch processing (50% off, for anything not latency-bound), and subagents on a cheaper model for reading-heavy sub-tasks. |

## How the two levers fit together

- **Fresh context beats pruning when the work has a natural boundary.** Anthropic's guidance prefers starting a new session that rediscovers state from the filesystem over compacting a long one. A new session pays one cache write for the system prompt and starts with a clean history.
- **Within a session, edit rarely and in large blocks.** Context editing that clears old tool results should clear enough at once to repay the cache miss it causes. Compaction should run at a threshold, not every turn.
- **Inject dynamic content by appending, never by editing.** A message added at turn 5 invalidates nothing before turn 5.
- **Move investigation into subagents.** Their reading stays out of the main context entirely — and they can run on a cheaper model without invalidating the main loop's cache.

## What goes into jig

jig runs inside Claude Code, so it doesn't control cache breakpoints. It does control how much it adds to context, and whether it causes invalidations.

1. **Never set `effort` or `model` in skill frontmatter.** Both change settings mid-session. An effort change invalidates the messages cache, and a model change invalidates all of it. The plan skill already omits both, and the design now records why.
2. **Hooks append and stay short.** SessionStart output lands once at session start. The out-of-scope edit warning fires at most once per file per session — a run of edits doesn't add the same paragraph each time.
3. **Tool output is bounded at the source.** `jig verify` prints one line per check plus the deciding line on failure, and `jig status` caps its output. Logs never get dumped into context.
4. **One slice per session is also the cost strategy.** The plan file and its `Now:` line are the memory, so a fresh session resumes cheaply instead of carrying a long history.
5. **The reviewer gets paths, not pasted content.** It reads what it needs in its own context, and runs only at the full and program tiers.
6. **Plans for LLM features get a fundamentals section:** context budget per step, cache-stable ordering, silent invalidators, and cost per completed task as a `perf` check. It's in `references/fundamentals.md`.
7. **The eval report states cost the same way:** total cost, cache-read and cache-write tokens, and turns per completed task for each arm, taken from `claude -p --output-format json` usage fields. Tier-0 overhead is reported in those units.
