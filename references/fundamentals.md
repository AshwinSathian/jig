# Engineering fundamentals, by what the change touches

Read only the sections for areas the slice touches. Each question either has an answer you can write into the plan (a decision, a check, or a risk with Detect and Fallback), or it doesn't apply. Don't paste these questions into the plan.

## Algorithms and data structures
- What is n today, and what is it in a year? Is any loop over n inside another loop over n?
- Is the structure right for the access pattern: a map for lookups, a set for membership, a heap for top-k?
- Where are the boundaries: empty input, one element, the maximum, off-by-one at page or window edges?

## Concurrency and async
- What happens if this runs twice at once? If it runs twice in a row (idempotency)?
- Is concurrency bounded: pool sizes, `Promise.all` over user-sized lists, goroutines per request?
- What shared state is there, and what guards it? Is every await or lock released on the error path?
- Can a retry or a timeout leave work half-done?

## Databases
- Which queries does the change add, and which index serves each one? Run `EXPLAIN` on anything new against realistic data.
- Is there a query inside a loop? Batch it or join.
- Key design for NoSQL stores (Mongo, Dynamo): what is the partition key, does traffic spread across it, and can a hot tenant create a hot partition? This is a one-way door.
- Migrations: is it reversible, does it lock a large table, and can old and new code run against it at the same time (expand and contract)? See `safe-change.md`.

## Networking and the OS
- Does every outbound call have a timeout, and is the retry bounded and backed off with jitter?
- Are connections pooled and released? What about file descriptors under load?
- TLS verification, DNS caching, proxy settings: does the change assume any of them?

## Performance
- Which path is hot? Measure before and after with a command that goes in checks.json as a `perf` check with a threshold.
- What does the change allocate per request? What grows without bound (caches, queues, logs)?

## Distributed systems
- What happens on partial failure: the write succeeds and the ack is lost, or one of two services is down?
- Is there an "exactly once" assumption? The usual answer is at-least-once delivery plus idempotent handling.
- Can a retry storm happen: clients retrying in lockstep, or retries multiplying through layers?
- Is ordering assumed anywhere it isn't guaranteed?

## Software design
- Does the change deepen an existing module or add a shallow one: a wrapper that passes calls through, or an interface with one implementation?
- Agents optimize locally. Does the change respect the boundaries and invariants the repo already has? Look for ADRs and module owners.
- Could this be done by deleting or changing something that exists instead of adding?

## LLM and agent features
- What does each step actually need in context? Name what gets dropped, cleared or moved into a subagent, and at what point.
- Is the prompt ordered static first, dynamic last (tools, then system, then messages)? Caching is a prefix match, so a change at any position invalidates everything after it.
- Silent cache invalidators:
  - a timestamp, user name or request ID in the system prompt
  - unsorted JSON in tool definitions
  - tools added or removed mid-session
  - a model switch
  - a change to thinking or effort settings

  Add a check that reads `usage.cache_read_input_tokens` across two identical-prefix requests and fails at zero.
- Do history edits conflict with caching? Pruning or rewriting earlier turns invalidates the cache from that point, and on current Claude models it drops later thinking blocks. Clear in large batches at a threshold, or start a fresh context at a natural boundary.
- What is the cost and latency per **completed task**, not per request? Add a `perf` check with a threshold on a fixed task set, and re-run it before changing model, effort or prompt.
- Untrusted text reaches the model (user input, documents, web pages, tool output). Read `security.md`, starting with the lethal trifecta.

## Security
Read `security.md`.
