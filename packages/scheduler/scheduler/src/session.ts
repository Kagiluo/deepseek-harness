/**
 * The creation transaction for one scheduled occurrence: bind a workspace,
 * create an Agent bound to it, apply the configured permission preset and
 * title, admit the prompt, and release the Agent once its turn settles.
 *
 * The transaction mirrors the Webhook Session creation every step of the way —
 * validate before the first await, roll back to a clean state on failure — and
 * differs in what it does after the prompt is admitted: a scheduled run owns
 * its Agent for the duration of the turn and disposes it afterwards, because a
 * daily recurrence would otherwise accumulate live Agents for the life of the
 * process.
 * @module @deepseek-ai/dsh-scheduler/session
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { boundContextSummary, createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import type { ResolvedSchedulerTask } from './types.ts'

/**
 * How long one run may stay live before the scheduler cancels it.
 *
 * A scheduled occurrence has no person watching it, so an Agent that stalls —
 * a provider that stops streaming, a tool that never returns — would hold its
 * Agent and Session forever. Overlap is already prevented per task, so a stall
 * would silently retire that task's schedule rather than merely delay it.
 */
export const RUN_DEADLINE_MS = 3_600_000

/** One run's terminal outcome, reported to the process log. */
export interface RunOutcome {
  /** The created Session's identity, for cross-referencing the durable log. */
  readonly sessionId: SessionId
  /**
   * `completed` when the turn settled inside the deadline, `timeout` when the
   * deadline cancelled it, and `failed` when quiescence itself rejected. A
   * created Session always reports here; only creation failure throws.
   */
  readonly status: 'completed' | 'timeout' | 'failed'
}

/** Log a rollback failure without replacing the operation's original failure. */
function reportRollbackFailure(ctx: Context, subject: string, error: unknown): void {
  ctx.logger.warn(`scheduler: ${subject} rollback failed: ${errorChain(error)}`)
}

/**
 * Await `settled` while watching both bounds a scheduled run has: the run
 * deadline and the registration's own lifetime. The losing await is left
 * pending for the caller to settle by cancelling the Agent.
 * @param settled - The run's quiescence wait.
 * @param signal - Registration lifetime; aborts during the run when the plugin unloads.
 * @param deadlineMs - Milliseconds the run may stay live.
 * @returns Which bound ended the wait.
 */
export async function raceSettlement(
  settled: Promise<void>,
  signal: AbortSignal,
  deadlineMs: number,
): Promise<'settled' | 'timeout' | 'aborted'> {
  const bound = Promise.withResolvers<'timeout' | 'aborted'>()
  const timer = setTimeout(() => { bound.resolve('timeout') }, deadlineMs)
  const onAbort = (): void => { bound.resolve('aborted') }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([settled.then(() => 'settled' as const), bound.promise])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

/** Drain one created Session's durability and release its Agent. */
async function releaseRun(
  ctx: Context,
  session: Session,
  handle: { dispose(): Promise<void> },
): Promise<void> {
  try {
    await ctx.sessions.flush(session)
  } catch (error: unknown) {
    ctx.logger.warn(`scheduler: Session "${session.id}" durability flush failed: ${errorChain(error)}`)
  }
  try {
    await handle.dispose()
  } catch (error: unknown) {
    ctx.logger.warn(`scheduler: Session "${session.id}" disposal failed: ${errorChain(error)}`)
  }
}

/**
 * Create, attach, configure, prompt, drain, and release one scheduled Session.
 *
 * Failures before the prompt is admitted roll the partial Session back: the
 * workspace attachment is removed and the Agent is disposed, so a refused
 * occurrence leaves no half-configured Session behind. A failure after
 * admission is the run's own outcome and is logged, not rolled back — the
 * turn's transcript is durable and is what a reader inspects.
 * @param ctx - Runtime context that owns the created Agent.
 * @param task - The validated task this occurrence belongs to.
 * @param occurrenceAt - RFC 3339 UTC instant the occurrence was armed for, recorded as provenance.
 * @param signal - Registration lifetime cancellation; aborts creation and the run.
 * @returns The run's terminal outcome.
 */
export async function runScheduledTask(
  ctx: Context,
  task: ResolvedSchedulerTask,
  occurrenceAt: string,
  signal: AbortSignal,
): Promise<RunOutcome> {
  const selection = ctx.agentDefaultModel.currentSelection()
  const sessionId = brandString<SessionId>(`scheduler-${task.schedule.taskId}-${randomUUID()}`)
  ctx.permissionPresets.resolve(task.permissionPreset)
  const presets = ctx.get('agentPresets')
  signal.throwIfAborted()

  const workspace = await ctx.workspaceRegistry.create(task.workspacePath)
  signal.throwIfAborted()
  const handle = await ctx.agents.create({
    sessionId,
    signal,
    meta: {
      cwd: workspace.path,
      ...(task.agentPreset === undefined ? {} : { agentPreset: task.agentPreset }),
    },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      if (task.agentPreset !== undefined) {
        if (presets === undefined) {
          throw new Error(
            `scheduler: task "${task.schedule.taskId}" declares agentPreset "${task.agentPreset}"`
            + ' but no agent preset roster is mounted',
          )
        }
        await presets.mount(agentCtx, task.agentPreset)
      }
      installModelSelection(agentCtx, { current: selection, assembled: undefined })
    },
  })

  let attached = false
  try {
    signal.throwIfAborted()
    await workspace.attachSession(sessionId)
    attached = true
    signal.throwIfAborted()
    ctx.permissionPresets.set(handle.agent.session, task.permissionPreset)
    ctx.sessionTitle.rename(handle.agent.session, task.title)
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: task.prompt }],
      source: {
        kind: 'scheduler',
        taskId: task.schedule.taskId,
        occurrenceAt,
        form: 'notice',
        summary: boundContextSummary(`scheduled task ${task.schedule.taskId} ran for ${occurrenceAt}`),
      },
    }))
  } catch (error: unknown) {
    if (attached) {
      try {
        await workspace.detachSession(sessionId)
      } catch (rollbackError: unknown) {
        reportRollbackFailure(ctx, `Workspace detach for Session "${sessionId}"`, rollbackError)
      }
    }
    try {
      await handle.dispose()
    } catch (rollbackError: unknown) {
      reportRollbackFailure(ctx, `Agent disposal for Session "${sessionId}"`, rollbackError)
    }
    throw error
  }

  const session = handle.agent.session
  let status: RunOutcome['status'] = 'completed'
  try {
    const ended = await raceSettlement(handle.agent.whenIdle(), signal, RUN_DEADLINE_MS)
    if (ended !== 'settled') {
      status = ended === 'timeout' ? 'timeout' : 'failed'
      ctx.logger.warn(ended === 'timeout'
        ? `scheduler: Session "${session.id}" exceeded its ${String(RUN_DEADLINE_MS)}ms deadline; cancelling the run`
        : `scheduler: Session "${session.id}" was cancelled because the scheduler unloaded`)
      handle.agent.cancel({
        kind: 'hook',
        reason: ended === 'timeout'
          ? `scheduler task "${task.schedule.taskId}" exceeded its run deadline`
          : `scheduler unloaded while task "${task.schedule.taskId}" ran`,
      })
      await handle.agent.whenIdle()
    }
  } catch (error: unknown) {
    ctx.logger.warn(`scheduler: Session "${session.id}" run failed: ${errorChain(error)}`)
    status = 'failed'
  } finally {
    await releaseRun(ctx, session, handle)
  }
  return { sessionId: session.id, status }
}
