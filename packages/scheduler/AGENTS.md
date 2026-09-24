# AGENTS.md — Scheduler packages

These rules supplement the repository and package instructions for `packages/scheduler/*` and its Client surface `packages/client/ui-scheduler`.

- The plugin owns no durable schedule state. The Sessions a run creates are the only durable record, so a task that came due while the process was not running is skipped rather than replayed; do not add a catch-up queue, a missed-occurrence log, or a persisted last-fired marker.
- Occurrence arithmetic stays pure and deterministic: `nextOccurrence` reads no clock and accepts `now` from its caller. Production supplies `Date.now()`; tests supply explicit instants.
- Every wake re-reads the wall clock and re-derives the target. Do not cache a target across a wake, and do not widen a timer beyond `MAX_TIMER_DELAY_MS`.
- A task's references are resolved when it is armed, never at write time. `validateTaskStructure` covers only what cannot change (id, time, zone, weekdays); the workspace directory, permission preset, and agent preset roster are resolved per re-arm so one unusable reference skips one task instead of failing the mount.
- A scheduled run must use a permission preset whose approval policy is `never`. Nobody is present to answer an approval request, so an asking preset is refused at arm time rather than allowed to park a run.
- The run deadline (`RUN_DEADLINE_MS`) exists so a stalled Agent cannot retire a task's recurrence by holding its single in-flight slot forever. Keep cancellation ahead of disposal, and keep disposal outside the rollback path once the prompt was admitted.
- The settings entry is this plugin's Loader entry id (`scheduler`), and `Config` is its settings form: `Config.tasks` is declared `.volatile()`, which is what makes the task list editable without remounting the plugin. One `taskSchema` describes the task fields; do not restate them in a second schema layer.
- The Client page submits the whole task list as one atomic mutation, fenced by the revision the draft began from. Do not implement per-field writes: the settings wire replaces an array wholesale.
