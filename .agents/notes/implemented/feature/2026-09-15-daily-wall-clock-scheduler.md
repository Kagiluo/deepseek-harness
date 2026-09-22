# Agent Note: Daily wall-clock tasks that start a Session unattended

Status: implemented

English | [中文](2026-09-15-daily-wall-clock-scheduler.zh.md)

## Problem

Nothing in the harness starts work on its own at a time of day. A person who wants a morning triage run, a nightly dependency check, or a weekly report has to be at the machine to type the prompt, and the transcript of that work is only as durable as their memory to start it. The [harness-level loop decision](2026-07-16-harness-level-loop.md) named this gap explicitly and left time-based execution to "a scheduler rather than either goal family"; the [Session-local Schedule](2026-08-05-durable-web-schedule.md) package covers the adjacent case — a reminder delivered into one live conversation — but it deliberately never creates a Session of its own, so it cannot begin unattended work.

Two constraints shape the answer. A scheduled run has nobody watching it, so an approval request would park it forever, and a stalled Agent would hold its Session for the life of the process. And the work must be visible: a user configuring it needs to see the time, the workspace, the prompt, and the composition the Session will run, which means a configuration surface rather than a file edit.

## Decision

`@deepseek-ai/dsh-scheduler` arms one runtime per configured daily task and, at each occurrence, creates an ordinary root Session in the task's workspace, admits the task's prompt as its first message, and disposes the Agent when the turn settles. Tasks come from two layers: the plugin's `Config`, which a deployment or headless run ships, and the `scheduler` user-settings namespace, which the Web page writes and whose committed value replaces the shipped list.

The plugin owns no durable schedule state. There is no catch-up queue, no missed-occurrence log, and no persisted last-fired marker, so nothing can drift from the sessions a run actually created. `nextOccurrence` resolves strictly after the caller's `now`, which is what implements the no-catch-up policy: a process that starts after a due time arms the next occurrence instead of replaying the one it slept through. The resolver reads no clock — `TaskRuntime` passes `Date.now()` on every wake and re-derives the target — so a clock adjustment or a daylight-saving transition cannot leave a stale target armed.

Task validation splits by what can change while the process runs. A task's structure — its id, wall-clock time, zone, and weekdays — cannot change, so `validateTaskStructure` refuses an impossible one where it is authored, and the settings write path reuses that same check. Everything a task references — its workspace directory, permission preset, and agent preset roster — can change, so `resolveArmedTasks` resolves them per re-arm and keeps a per-task failure instead of failing the whole set. Resolving references at write time would let a deleted directory refuse the entire mount on the next boot, so the split is load-bearing rather than stylistic.

A scheduled run must use a permission preset whose approval policy is `never`. Nobody is present to answer a request, so an asking preset is refused at arm time rather than allowed to park the run indefinitely. This is the one place the scheduler constrains configuration rather than merely validating it.

`RUN_DEADLINE_MS` bounds a run at one hour. Because overlap is already prevented per task, an Agent held forever would silently retire that task's recurrence rather than merely delay it, so the deadline exists to release the single in-flight slot. A failure before the prompt is admitted rolls the partial Session back — workspace detach and Agent disposal; a failure after admission is the run's own durable outcome and is not rolled back, because the transcript is what a reader inspects.

`@deepseek-ai/dsh-client-ui-scheduler` is the settings page. It edits a local draft and submits the whole task list as one atomic mutation, because the settings wire replaces an array wholesale and a per-keystroke write would publish half-typed tasks. Each save carries the revision the draft began from, so a concurrent commit from another surface is refused rather than silently overwritten; a refused save keeps the edit and adopts the newer revision so a retry can land. The permission-preset picker reads the eligible names out of the host's own namespace schema, which is a union of the constants the host declares, so no approval policy is restated client side.

The host row lives in the Web bundle rather than the base layer. A scheduled occurrence creates a root Session from the plugin's own context, so it needs `agents`, `workspaceRegistry`, `sessionTitle`, and `permissionPresets`; `workspaceRegistry` is a Web-layer row, and the base layer serves the TUI, which has no workspace registry to inject. The shipped Web row configures an empty task list, so a fresh deployment schedules nothing until a user adds a task.

## Alternatives considered

**A durable scheduler with catch-up.** Storing last-fired state and replaying occurrences missed while the process was down could make the schedule survive a restart. It requires a second identity, persistence, and recovery protocol beside the Sessions themselves, and it reintroduces the question of whether a stale task should still run hours later. The Sessions a run creates are already the record, so the shipped design keeps that single source of truth and skips what it missed.

**A cron expression instead of a daily time plus weekdays.** An expression is more expressive and familiar. It also needs a parser, a validation vocabulary, and a configuration UI for a grammar, for a feature whose stated use is a daily or weekday run. A daily `HH:MM:SS` plus `weekdays` covers that case with arithmetic that stays pure and testable, and a recurrence expression remains an extension of the same resolver.

**Extending the Schedule package rather than adding one.** Schedule already owns durable records, replay, and delivery into a live Session. Making it create Sessions would put two different delivery models behind one durable stream and one set of management tools, and its fork and cold-session semantics are about a reminder belonging to a conversation, not about starting new work.

**An out-of-process cron entry or OS scheduler.** A host crontab entry could start work with the deployment down. It moves configuration out of the product, gives the run no transcript in the deployment's own store, and cannot apply a permission or agent preset from the composition. The in-process scheduler keeps every fact of a run inside the Session log.

**Arming from a persisted last-fired marker instead of re-deriving.** A stored target survives a restart without recomputation. It also becomes wrong the moment the clock or the zone shifts, and it needs its own durability and recovery. Re-deriving from the wall clock on every wake is cheaper and cannot be stale.

## Consequences

A scheduled time arrives only while the deployment is live, and a missed time is gone; a task needing every occurrence must be scheduled from something that owns durable queue state. Runs are in-process only, so the plugin cannot start work with the deployment down.

The plugin is unusable with interactive permission presets, which is a real reduction in what a task can do: a scheduled run cannot ask, so a workflow that needs a person's answer at any step cannot be scheduled at all. The one-hour deadline is fixed rather than per task, and a run that stalls is cancelled rather than reported.

Nothing notifies anyone that a task ran or failed. Outcomes reach the process log and the created Session, so a deployment that needs alerting has to read those rather than wait for a report.

## Testing

`tests/time.spec.ts` pins occurrence resolution: same-day and next-day targets, strictness against an exact due instant, zone interpretation, a daylight-saving offset change between occurrences, the earlier instant of an overlap, a spring-forward gap being skipped, weekday selection, and the refusals for a malformed time, an empty weekday list, an out-of-range weekday, and a non-integral clock reading. `tests/config.spec.ts` pins the structure/reference split: every structural refusal, a missing workspace directory and a file in its place, an asking permission preset, the required and refused agent preset per roster presence, the paused task that is neither armed nor reported, and kept arm order. `tests/runtime.spec.ts` drives the real `TaskRuntime` with fake timers and a replaced session transaction: one run per occurrence stamped with that occurrence, the terminal outcome log, a contained start failure that stays armed, an occurrence skipped while the previous run is in flight, a due time that passed while the process was down never replayed, weekday arming, disposal quiescence, and a clock that cannot resolve. `tests/session.spec.ts` covers the transaction against fixture services: the ordered create/attach/configure/prompt/release path, rollback of the workspace and Agent before admission, no detach when attachment never happened, no rollback after admission, an already-aborted signal, and `raceSettlement` settling as completed, timeout, or aborted. `tests/settings.spec.ts` pins the namespace schema, the every-day default, the eligible-preset union, the no-eligible-preset fallback, and the required fields. `tests/loader-composition.spec.ts` boots the real Loader from a `cordis.yml`, proves the function-plugin namespace arrives intact, observes the settings section install and its stored-list validation, and pins the `Config` default and the absence of a default export.

On the client, `tests/locales.client.spec.ts` pins the dictionary pair and the namespace spelling against the host declaration, `tests/tasks-store.client.spec.ts` covers the draft actions including optional-field omission, `tests/controller.client.spec.ts` covers mirroring, the revision fence, refused saves, and retry, `tests/section.client.spec.tsx` renders the page and asserts validation, the missing-workspace marker, and the removal confirmation, and `tests/apply.client.spec.ts` mounts the browser half over the real settings domain base and the Remote double, asserting the registration, the schema-derived preset picker, the atomic write, and contribution removal on disposal.

## Related

- [Harness-level loop](2026-07-16-harness-level-loop.md) — the decision that left time-based execution to a scheduler.
- [Durable Web Schedule](2026-08-05-durable-web-schedule.md) — the adjacent session-local reminder model and why it does not create Sessions.
- [`@deepseek-ai/dsh-scheduler` README](../../../../packages/scheduler/scheduler/README.md) — the package contract.
- [`@deepseek-ai/dsh-client-ui-scheduler` README](../../../../packages/client/ui-scheduler/README.md) — the settings page contract.
- [Fire-and-forget webhook sessions](2026-08-22-fire-and-forget-webhook-sessions.md) — the Session-creation transaction this one follows.
