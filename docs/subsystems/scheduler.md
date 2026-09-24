# Scheduler

English | [中文](scheduler.zh.md)

The daily wall-clock task vocabulary owned by [`@deepseek-ai/dsh-scheduler`](../../packages/scheduler/scheduler/README.md). The package arms one runtime per configured task and starts an ordinary root Session at each occurrence; the companion [`@deepseek-ai/dsh-client-ui-scheduler`](../../packages/client/ui-scheduler/README.md) authors that task list from the browser. Configuration and the run transaction are on the [host package README](../../packages/scheduler/scheduler/README.md).

Source: [`packages/scheduler/scheduler/src/types.ts`](../../packages/scheduler/scheduler/src/types.ts)

## `SchedulerTask` — one declared task

```ts type-equiv
/**
 * One daily wall-clock task. Its structure — id, time, zone, and weekdays — is
 * validated when the plugin loads and on every re-arm; the references it names
 * are resolved when it is armed.
 */
interface SchedulerTask {
  /** Stable task id naming this task in diagnostics, its Session title, and the scheduler metadata on the messages it admits. */
  readonly id: string
  /**
   * Whether this task is armed. Omission means enabled; `false` pauses the task
   * without deleting it, and a paused task's unusable references are not
   * reported, because pausing is the author's decision rather than a problem.
   */
  readonly enabled?: boolean
  /** Absolute path of an existing directory the created Session runs in. */
  readonly workspacePath: string
  /** Local wall-clock time of day, `HH:MM:SS` in 24-hour form. */
  readonly time: string
  /** IANA zone `time` is interpreted in; omission uses the process zone. */
  readonly timeZone?: string
  /**
   * Weekdays this task runs on, `0` (Sunday) through `6` (Saturday). Omission
   * runs it every day. An empty list is refused, because it never runs.
   */
  readonly weekdays?: readonly number[]
  /** Prompt text admitted as the created Session's first turn. */
  readonly prompt: string
  /**
   * Agent preset id the created Session joins. Omission joins the roster
   * default when the deployment configures a roster; declaring one where no
   * roster is configured is refused at load.
   */
  readonly agentPreset?: string
  /**
   * Permission preset applied to the created Session before its prompt. The
   * preset's approval policy must be `never`: no person is present to answer a
   * request, so a preset that asks would park the run indefinitely.
   */
  readonly permissionPreset: string
  /** Session title applied before the prompt; omission uses this task's `id`. */
  readonly title?: string
}
```

## `ResolvedSchedulerTask` — one task ready to arm

```ts type-equiv
/** One configured task after load-time validation, ready to arm. */
interface ResolvedSchedulerTask {
  /** The validated daily recurrence, carrying the task id. */
  readonly schedule: DailySchedule
  /** Absolute workspace directory the run creates its Session in. */
  readonly workspacePath: string
  /** Session title applied before the prompt. */
  readonly title: string
  /** Prompt text admitted as the first turn. */
  readonly prompt: string
  /** Agent preset id joined, or `undefined` when the task declares none. */
  readonly agentPreset: string | undefined
  /** Permission preset applied before the prompt. */
  readonly permissionPreset: string
}
```

## `DailySchedule` — one validated recurrence

```ts type-equiv
/** One validated daily recurrence, independent of any timer. */
interface DailySchedule {
  /** Configured task id, carried into diagnostics. */
  readonly taskId: string
  /** Validated local hour, 0–23. */
  readonly hour: number
  /** Validated local minute, 0–59. */
  readonly minute: number
  /** Validated local second, 0–59. */
  readonly second: number
  /** Selected weekdays in ascending order, or `undefined` for every day. */
  readonly weekdays: readonly number[] | undefined
  /** Canonical IANA zone the three local fields are interpreted in. */
  readonly timeZone: string
}
```

## Structure versus references

A task's structure — its id, wall-clock time, zone, and weekdays — is validated when the plugin loads and again on every re-arm, because a stored task list can also be edited outside the page that authored it. Everything a task references — its workspace directory, its permission preset, and its agent preset roster — is resolved on that same re-arm, so an unusable reference keeps that one task out of the arm set and leaves the rest of the schedule running. Resolving a reference at write time would let a deleted directory refuse the whole mount on the next boot.

## Arming, occurrence, and release

`TaskRuntime` arms one bounded `setTimeout` segment toward the next occurrence and re-reads the wall clock on every wake, so a system clock adjustment or a daylight-saving transition cannot leave a stale target armed. The target is always strictly in the future, which is what makes a time missed while the process was down skipped rather than replayed. A run still in flight when its own next occurrence arrives makes that occurrence overdue, and it is skipped the same way.

One occurrence creates one root Session in the task's workspace, applies the permission preset and title, admits the prompt as an ordinary user-role message carrying `kind: "scheduler"`, waits for the turn to settle inside a one-hour deadline, and disposes the Agent. A failure before the prompt is admitted detaches the workspace and disposes the Agent; a failure after admission is the run's own durable outcome and is not rolled back.
