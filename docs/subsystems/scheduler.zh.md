# Scheduler

[English](scheduler.md) | 中文

由 [`@deepseek-ai/dsh-scheduler`](../../packages/scheduler/scheduler/README.zh.md) 拥有的每日挂钟时间任务词汇。该包为每个已配置任务挂载一个运行时，并在每次到点时启动一个普通根 Session；配套的 [`@deepseek-ai/dsh-client-ui-scheduler`](../../packages/client/ui-scheduler/README.zh.md) 负责在浏览器中编写这份任务列表。配置与运行事务见 [Host 包 README](../../packages/scheduler/scheduler/README.zh.md)。

Source: [`packages/scheduler/scheduler/src/types.ts`](../../packages/scheduler/scheduler/src/types.ts)

## `SchedulerTask` — 一个已声明任务

```ts type-equiv
/**
 * One daily wall-clock task. Structure is validated wherever the task is
 * authored; the references it names are resolved when it is armed.
 */
interface SchedulerTask {
  /** Stable task id naming this task in diagnostics, its Session title, and message provenance. */
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
  readonly weekdays?: number[]
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

## `ResolvedSchedulerTask` — 一个已可挂载的任务

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

## `DailySchedule` — 一个已校验的重复规则

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

## 结构与引用

任务的结构——其 id、挂钟时间、时区与星期——在进程运行期间不会改变，因此不可能成立的结构会在编写处被拒绝。任务引用的所有东西——工作区目录、权限预设与 Agent 预设名单——都可能改变，因此不可用的引用只会让该任务不进入挂载集合，而其余调度继续运行。若在写入时解析引用，一个被删除的目录就会让整个挂载在下一次启动时被拒绝。

## 挂载、到点与释放

`TaskRuntime` 朝着下一次到点挂载一段有上限的 `setTimeout`，并在每次唤醒时重读挂钟时间，因此系统时钟调整或夏令时切换都无法留下过期的目标。目标始终严格位于未来，这正是进程未运行时错过的时间被跳过而不是被补上的原因。若某个运行在自身下一次到点到达时仍在进行，该次到点即为逾期，并以同样方式被跳过。

一次到点会在任务的工作区中创建一个根 Session，应用权限预设与标题，把提示词作为携带 `kind: "scheduler"` 来源信息的普通用户角色消息送入，在一小时期限等待该轮次结束，然后释放 Agent。提示词被接收之前的失败会解除工作区绑定并释放 Agent；接收之后的失败是该运行自身的持久结果，不会被回滚。
