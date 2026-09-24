---
description: "Daily wall-clock tasks that start a Session in a configured workspace and run a preset prompt unattended; for users scheduling recurring agent work and maintainers of the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-scheduler

English | [中文](README.zh.md)

## Summary

Run a prompt by itself at a time you choose — every day at 09:30, or only on weekdays — in a workspace you name. At that time the plugin starts a Session there, applies your permission and agent presets, and sends your prompt as its first message; you read the transcript afterwards like any other Session. Author tasks in the Web GUI's Scheduled tasks page or ship them in a composition. A time that passed while the process was down is skipped, and a scheduled run has nobody to answer an approval request, so it needs an unattended preset.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a composition, then either ship tasks in its `config` or author them in the GUI. The shipped Web bundle mounts it with an empty task list, so a fresh deployment schedules nothing until you add a task.

```yaml
- id: scheduler
  name: '@deepseek-ai/dsh-scheduler'
  config:
    tasks:
      - id: nightly-report
        time: '09:30:00'
        timeZone: Asia/Shanghai
        workspacePath: /home/me/project
        prompt: Summarize yesterday's commits and open issues.
        permissionPreset: unattended
        agentPreset: standard
```

Success looks like this: at the next occurrence the plugin logs `scheduler: task "nightly-report" Session "scheduler-nightly-report-…" completed for <instant>`, and a Session titled `nightly-report` exists in that workspace holding your prompt and the model's answer.

### When to choose it

Choose Scheduler for work that must start on its own at a wall-clock time and leave a transcript: a morning triage run, a nightly dependency check, a weekly report. Avoid it when the task must run *while a specific conversation is open* — the [Schedule](../../schedule/schedule/README.md) package delivers reminders into one live Session and survives restarts, but it never starts a Session of its own. Scheduler owns no durable schedule state, so it does not catch up on missed times and cannot guarantee a run happened: if the process was down at 09:30, that day is skipped.

### Task fields

| Field | Default | Meaning |
|---|---|---|
| `id` | `required` | Stable id; unique across tasks, names the Session title, and travels as the prompt message's scheduler metadata |
| `workspacePath` | `required` | Absolute path of an existing directory the Session runs in |
| `time` | `required` | Local wall-clock time of day, `HH:MM:SS` in 24-hour form |
| `prompt` | `required` | Text admitted as the created Session's first message |
| `permissionPreset` | `required` | Preset applied before the prompt; its approval policy must be `never` |
| `enabled` | `true` | `false` pauses the task without deleting it |
| `timeZone` | process zone | IANA zone `time` is read in, such as `Europe/Berlin` |
| `weekdays` | every day | Days to run, `0` (Sunday) through `6` (Saturday); an empty list is refused |
| `agentPreset` | roster default | Agent preset the Session joins; required when the deployment configures a roster, refused when it does not |
| `title` | the task `id` | Session title applied before the prompt |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-scheduler) is the exhaustive source for every accepted field.

### Authoring tasks in the GUI

The companion package [`@deepseek-ai/dsh-client-ui-scheduler`](../../client/ui-scheduler/README.md) adds a **Scheduled tasks** page to Settings. It edits a local draft and submits the whole task list as one write, so a half-typed task is never stored. The page reports the structural rules it can check before writing, but the settings wire accepts only the field schema: `validateTaskStructure` runs when the plugin loads and on every re-arm, so a structurally impossible list that reaches storage leaves the previous arm set running and is reported in the process log instead of being refused at the write. Its permission-preset picker offers every preset the deployment advertises, and a preset whose approval policy is not `never` is refused when the task is armed.

A deployment with no Web surface can set tasks from `Config` alone: the plugin injects the settings service conditionally only to opt out of the loader's generated form, so a headless composition schedules without one.

### When a task misses its time

An occurrence that came due while the process was not running is skipped, because the next target is always strictly in the future. A run still in flight when its own next occurrence arrives makes that occurrence overdue, and it is skipped the same way rather than queued. Nothing accumulates: the schedule advances to the next future occurrence.

### When a run ends

A scheduled run owns its Agent for the turn and disposes it afterwards, so a daily recurrence does not accumulate live Sessions. A run that stalls — a provider that stops streaming, a tool that never returns — is cancelled after one hour, because nobody is watching and an Agent held forever would silently retire that task's schedule. The transcript stays durable either way; only creation failure rolls back.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the plugin and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Scope and composition

The plugin declares `inject = ['agents', 'agentDefaultModel', 'permissionPresets', 'sessions', 'sessionTitle', 'workspaceRegistry']`, so a missing session-creation service is a composition error. `agentPresets` is deliberately absent: a deployment may configure no roster, and the plugin reads that optional service through `ctx.get`. `settings` is absent too, and injected conditionally only to opt out of the loader's generated settings form, because this package ships its own page.

### Design philosophy

The package rests on one separation and three commitments:

- **No durable schedule state.** The Sessions a run creates are the only durable record. There is no catch-up queue, no missed-occurrence log, and no persisted last-fired marker, so the plugin cannot drift from its own history. The recorded message source is attribution only: a reader without this plugin keeps the `scheduler` kind and its metadata and needs no validation, replay, or authority from it.
- **Pure occurrence arithmetic.** `nextOccurrence` reads no clock: callers pass `now`, so every wake re-derives from the wall clock and a system adjustment or daylight-saving transition cannot leave a stale target armed.
- **Structure validated at load and on every re-arm, references resolved at arming.** A task's id, time, zone, and weekdays are checked whenever the plugin arms the list, including a list edited outside the settings page. Its workspace directory, permission preset, and agent preset roster are resolved on the same pass, so an unusable reference skips that one task and leaves the rest running.
- **Unattended by construction.** A scheduled run has nobody to answer an approval request, so a preset whose policy is not `never` is refused at arm time rather than allowed to park a run indefinitely.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`inject`/`Config`/`apply`, arming, and re-arming on a committed settings change |
| [`src/types.ts`](src/types.ts) | `SchedulerTask`, `ResolvedSchedulerTask`, and the prompt's `MessageSourceMap` declaration |
| [`src/time.ts`](src/time.ts) | `HH:MM:SS` and zone validation, calendar normalization, and next-occurrence resolution |
| [`src/config.ts`](src/config.ts) | The structure/reference split, `SchedulerConfigError`, and the arm set |
| [`src/settings.ts`](src/settings.ts) | The task field schema shared with the settings form, and the unattended-preset selection |
| [`src/session.ts`](src/session.ts) | The per-occurrence Session transaction: create, attach, configure, prompt, drain, release |
| [`src/runtime.ts`](src/runtime.ts) | `TaskRuntime`: the bounded, re-segmented timer and the single in-flight run |

### Arming and re-arming

`apply` validates the configured structure, then resolves the current task list and swaps the armed set. The swap is ordered so no occurrence can be missed or double-armed: the new runtimes are constructed first, the old ones are disposed, and only then does the new set start. A generation counter makes a superseded resolution — one whose `resolve` settled after a later change arrived — discard its own result instead of resurrecting a stale schedule.

`Config.tasks` is volatile, so the `scheduler` loader entry carries the settings section as well as the composition base: a user's saved list replaces the shipped one, and the Loader commits a volatile-only change into the running config and announces it, which re-arms every task without a restart. This package ships its own page, so it opts out of the loader's generated form. Both the initial load and every re-arm call `validateTaskStructure`, so a stored list that cannot denote runnable occurrences is reported in the process log and the previous arm set keeps running.

### Time resolution

`nextOccurrence` projects `now` into the configured zone, walks forward day by day, and returns the first selected occurrence strictly after `now`. A local time removed by a spring-forward gap is skipped for that day, because no instant in that zone projects back to it; an overlap chooses its first, earlier instant. The search is bounded to 14 days, which covers every weekday selection plus the remainder that absorbs consecutive non-existent local times at a transition.

### Live owner

`TaskRuntime` arms one bounded `setTimeout` segment toward the target, capped at Node's `MAX_TIMER_DELAY_MS` because a longer delay would be clamped and fire immediately. Every wake re-reads the wall clock and re-derives the next occurrence, so an event-loop stall or a clock adjustment cannot leave a stale target armed. A due time starts exactly one run and re-arms immediately; a run still in flight makes the next occurrence overdue, which is skipped exactly like one that passed while the process was down.

Agent or plugin disposal cancels the timer and awaits the in-flight run to reach quiescence. The run's own cancellation rides the registration signal, so unloading the plugin stops a run without corrupting its durable transcript.

### Agent defaults

A scheduled Session is composed from the deployment's current default model selection, captured when the occurrence starts, so a run follows a default changed since the task was authored. The selection is installed through the ordinary Agent-scoped seam, which means the model choice is recorded on the Session like any other.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Scheduled tasks settings page](../../client/ui-scheduler/README.md) — the GUI that authors the task list this plugin arms.
- [Session-local Schedule](../../schedule/schedule/README.md) — the sibling package for reminders delivered into one live conversation rather than a new Session.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-scheduler) — the complete `tasks` schema this plugin receives.
- [Agent presets](../../preset/agent-preset-registry/README.md) — the roster a task's `agentPreset` names.
- [Permission presets](../../interaction/permission-presets/README.md) — the presets whose approval policy decides which tasks can run unattended.
- [Workspace registry](../../workspace/workspace/README.md) — the directories a task's `workspacePath` resolves against.
- [Scheduler subsystem](../../../docs/subsystems/scheduler.md) — the shared types and the arming-to-release timing contract.

-----

<a id="model-experience"></a>
## Model Experience

### The scheduled task prompt

#### What the model sees

For each occurrence, the Session's first message is exactly the non-empty `prompt` the task author wrote. The plugin adds no private framing around it; the text itself is admitted verbatim as an ordinary user-role message.

#### Token effect

One data-dependent user-role message is retained in the new Session and contributes tokens until ordinary compaction removes or replaces that history.

#### KV Cache effect

The prompt begins a new Session, so it establishes rather than invalidates that Session's reusable request prefix.

### Deployment default model selection

#### What the model sees

The created Agent requests the provider and model pair of the deployment's current default selection, sampled when the occurrence starts. Nothing about the task's configuration reaches the model beyond that pair.

#### Token effect

Zero direct tokens. The pair selects which model answers; it adds no message, tool schema, or prompt section.

#### KV Cache effect

The selection is fixed when the Session begins, so it does not invalidate a prefix within a Session. Changing the deployment default affects only Sessions started afterwards.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe when Scheduler does not fit your use case or needs special operational care. They are current package constraints, not a general task-runner comparison or a task backlog.

**Runtime invariant:** No companion is published. This package owns no durable package-local event stream — the Sessions a run creates are the record — and the occurrence arithmetic that could drift is pure, deterministic, and covered by `tests/time.spec.ts`.

- **No catch-up** — an occurrence that came due while the process was not running is skipped, never replayed; a task needing every occurrence must be scheduled from something that owns durable queue state.
- **Process must be running** — a scheduled time arrives only while the deployment is live. A stopped machine, or a deployment that mounts the plugin later, misses every time in the gap.
- **In-process only** — the plugin starts a Session inside the running process; it never launches a separate process, service, or scheduler daemon, and it cannot run a task with the deployment down.
- **Unattended permission presets only** — a preset whose approval policy is not `never` is refused at arm time, so a task cannot use the interactive presets a person would answer.
- **One run per task at a time** — a run still in flight when its own next occurrence arrives makes that occurrence overdue, and it is skipped rather than queued.
- **Fixed one-hour run deadline** — a run that stalls is cancelled after one hour; the deadline is not configurable per task.
- **No run history or failure notification** — outcomes go to the process log and the Session transcript. Nothing retries a refused run, and no report says a task ran.
- **Task structure is fixed once stored** — id, time, zone, and weekdays cannot be invalidated by the world changing, but editing any of them means saving a new task record.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

A cron-style recurrence (an expression rather than a daily time plus weekdays) remains a possible extension of the same pure resolver; the shipped scope is a daily wall-clock time. A per-task run deadline, a run history, and a failure notification channel are all plausible follow-ups with no design owner. Pausing across restarts is the author's choice today: `enabled: false` is stored, and nothing pauses a task on its own after a failure.

</details>
