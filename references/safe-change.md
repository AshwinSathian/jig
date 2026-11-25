# Changing something people already use

Read this when a slice changes behaviour in a running product: a migration, a changed API, new infrastructure, or a feature reaching users. Skip it for new code nobody runs yet.

## Rollout and rollback
- **How does this ship?** Behind a feature flag, as a canary, or all at once? All at once is fine for a reversible change with a fast rollback, and a decision with a reason otherwise.
- **How is it undone?** Write the rollback as a command or a flag flip in the slice, and test it when you can. "Revert the commit" is no rollback once data has changed.
- **Mark the one-way doors.** Destructive migrations, partition keys, public API removals and auth model changes can't be rolled back by a deploy. They get `[one-way]` in Decisions and a human decision.

## Migrations: expand and contract
Run old and new code against the same data at every step:
1. **Expand:** add new columns, tables or fields without removing anything. Old code ignores them.
2. **Dual write**, or backfill, and verify with a check that compares counts or checksums.
3. **Switch reads** to the new shape, behind a flag.
4. **Contract:** remove the old shape in a later slice, after the switch has run cleanly for a stated period.

Each step is its own slice with its own check. Step 4 is a one-way door.

## Observability
You can't debug what you can't see, and neither can an agent.
- **What tells you it works in production?** A metric, a log line or a trace span (OpenTelemetry), named in the slice.
- **What tells you it broke?** An alert or SLO that would fire, or a stated reason you don't need one.
- **Use structured logs** with the request or job ID, and no secrets or personal data.

## Incidents
After an incident caused by a planned change, write a blameless postmortem and record whether AI wrote the code involved. Turn each cause into a test, hook or gate with the guard skill. Then add a Log line to the plan that caused it.
