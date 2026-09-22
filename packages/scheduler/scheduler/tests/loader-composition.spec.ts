/**
 * Real Loader composition: the function plugin's `name`/`inject`/`Config`/`apply`
 * namespace arrives intact through the shipped composition path, its settings
 * namespace registers, and a committed task list arms one runtime per resolvable
 * task while leaving the rest of the schedule running.
 *
 * Nothing here is a hand-built `ctx.plugin(...)` call: the plugin is loaded by
 * the Loader from a cordis.yml, with its session-creation dependencies provided
 * as fixtures, so the function-plugin export form is exercised as shipped.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Scheduler from '../src/index.ts'
import { SCHEDULER_SETTINGS_NAMESPACE, validateTaskStructure, type Config } from '../src/index.ts'
import type { SchedulerTask } from '../src/types.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** One declared task and the settings hooks the fixture captures. */
interface Fixture {
  readonly events: string[]
  readonly warnings: string[]
  readonly created: string[]
  /** Absolute workspace directory the fixture registry resolves and tasks name. */
  readonly workspace: string
  /** The stored task list the fixture reports as the resolved section. */
  tasks: SchedulerTask[]
  /** The stored validation the settings section installs. */
  validate: ((value: { tasks: unknown[] }) => void) | undefined
  /** Notify the plugin that the stored list changed. */
  onChange: (() => void) | undefined
  /** Resolves once the section has installed. */
  installed: PromiseWithResolvers<undefined>
}

/**
 * Boot the real Loader with the plugin loaded from a cordis.yml.
 * @returns the fixture the test drives.
 */
async function boot(): Promise<Fixture> {
  root = await mkdtemp(join(tmpdir(), 'dsh-scheduler-loader-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- name: fixture-dependencies',
    "- name: '@deepseek-ai/dsh-scheduler'",
    '  config:',
    '    tasks: []',
    '',
  ].join('\n'))

  const installed = Promise.withResolvers<undefined>()
  const fixture: Fixture = {
    events: [], warnings: [], created: [], workspace,
    tasks: [], validate: undefined, onChange: undefined, installed,
  }

  const dependencies = {
    name: 'fixture-dependencies',
    apply(ctx: Context) {
      // `ctx.logger` is a real service on every Context, so diagnostics are
      // observed by spying rather than by providing a replacement.
      vi.spyOn(ctx.logger as unknown as { warn: (message: string) => void }, 'warn')
        .mockImplementation((message: string) => { fixture.warnings.push(message) })
      ctx.provide('agents', {
        create: async (options: { sessionId: string }) => {
          fixture.created.push(options.sessionId)
          return {
            agent: {
              session: { id: options.sessionId },
              followup: () => {},
              whenIdle: () => Promise.resolve(),
              cancel: () => {},
            },
            dispose: async () => {},
          }
        },
      } as never)
      ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
      ctx.provide('sessions', { flush: async () => true } as never)
      ctx.provide('sessionTitle', { rename: () => {} } as never)
      ctx.provide('workspaceRegistry', {
        create: async () => ({
          path: workspace,
          attachSession: async () => {},
          detachSession: async () => {},
        }),
      } as never)
      ctx.provide('permissionPresets', {
        names: ['unattended'],
        // Resolving is name-addressed, as the real permission table is: only the
        // advertised preset exists, and an unknown name is refused.
        resolve: (name: string) => {
          if (name !== 'unattended') throw new Error(`unknown preset "${name}"`)
          return { approval: 'never' }
        },
      } as never)
      // The optional settings provider: `installSection` is the seam the Web
      // profile supplies and a bare profile omits.
      ctx.provide('settings', {
        installSection: (
          _owner: Context,
          ns: string,
          schema: unknown,
          entry: unknown,
          hooks: {
            validate?: (value: { tasks: unknown[] }) => void
            setSource: (current: () => { tasks: SchedulerTask[] }) => void
            onChange: () => void
          },
        ) => {
          fixture.events.push(`section:${ns}`)
          expect(schema).toBeDefined()
          expect(entry).toEqual({ tasks: [] })
          fixture.validate = hooks.validate
          fixture.onChange = hooks.onChange
          // `installSection` hands out `setSource` so the consumer can learn
          // where the resolved section comes from; the fixture supplies its own
          // reader, which is what a real settings provider does.
          hooks.setSource(() => ({ tasks: fixture.tasks }))
          installed.resolve(undefined)
        },
      } as never)
    },
  }

  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-15T08:00:00Z'))
  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['fixture-dependencies', dependencies],
    ['@deepseek-ai/dsh-scheduler', Scheduler],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  await installed.promise
  return fixture
}

/** One task in the fixture's own workspace. */
function task(workspace: string, id: string, overrides: Partial<SchedulerTask> = {}): SchedulerTask {
  return {
    id,
    workspacePath: workspace,
    time: '09:30:00',
    timeZone: 'UTC',
    prompt: `run ${id}`,
    permissionPreset: 'unattended',
    ...overrides,
  }
}

describe('real Loader composition', () => {
  it('loads the function-plugin namespace and registers its settings section', { timeout: 60_000 }, async () => {
    const fixture = await boot()
    expect([...context!.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    expect(fixture.events).toContain(`section:${SCHEDULER_SETTINGS_NAMESPACE}`)
    // The section revalidates what a write path stores, so a task that could
    // never run is refused at the write instead of being armed and ignored.
    expect(fixture.validate).toBeDefined()
    expect(() => fixture.validate?.({ tasks: [task(fixture.workspace, 'x', { time: 'nope' })] })).toThrow()
    expect(() => fixture.validate?.({ tasks: [task(fixture.workspace, 'x')] })).not.toThrow()
  })

  it('arms one runtime per resolvable task and reports the skipped ones', { timeout: 60_000 }, async () => {
    const fixture = await boot()
    // Publish a stored list: one resolvable task, one whose preset is not
    // admissible, and one paused by its author.
    fixture.tasks = [
      task(fixture.workspace, 'good'),
      task(fixture.workspace, 'asking', { permissionPreset: 'never' }),
      task(fixture.workspace, 'paused', { enabled: false }),
    ]
    fixture.onChange?.()
    await vi.waitFor(() => { expect(fixture.warnings.some(line => line.includes('is not armed'))).toBe(true) })
    // The eligible preset is the only one the fixture resolves; a task naming
    // anything else is skipped with a warning that names it.
    expect(fixture.warnings.some(line => line.includes('"asking"') && line.includes('is not armed'))).toBe(true)
    // The paused task is neither armed nor reported.
    expect(fixture.warnings.some(line => line.includes('"paused"'))).toBe(false)
  })

  it('disposes the previous arm set when a later task list replaces it', { timeout: 60_000 }, async () => {
    const fixture = await boot()
    fixture.tasks = [task(fixture.workspace, 'first')]
    fixture.onChange?.()
    // Let the first resolution settle so it actually armed a runtime.
    await vi.advanceTimersByTimeAsync(0)
    fixture.tasks = [task(fixture.workspace, 'second')]
    fixture.onChange?.()
    await vi.advanceTimersByTimeAsync(0)
    // Reach the occurrence: only the replacement task runs, because the first
    // runtime was disposed by the swap.
    await vi.advanceTimersByTimeAsync(90 * 60 * 1000 + 1)
    await vi.waitFor(() => { expect(fixture.created.length).toBeGreaterThan(0) })
    expect(fixture.created.every(id => id.includes('second'))).toBe(true)
  })

  it('discards a superseded resolution instead of resurrecting a stale schedule', { timeout: 60_000 }, async () => {
    const fixture = await boot()
    // Two changes in one tick: the first resolution is superseded by the
    // second, and only the newer task list may end up armed.
    fixture.tasks = [task(fixture.workspace, 'stale')]
    fixture.onChange?.()
    fixture.tasks = [task(fixture.workspace, 'current')]
    fixture.onChange?.()
    await vi.advanceTimersByTimeAsync(90 * 60 * 1000 + 1)
    await vi.waitFor(() => { expect(fixture.created.length).toBeGreaterThan(0) })
    // Only the second generation's task ran; the superseded one discarded its
    // own result rather than arming a schedule nobody asked for.
    expect(fixture.created.every(id => id.includes('current'))).toBe(true)
  })

  it('arms a task that actually comes due and releases it on unload', { timeout: 60_000 }, async () => {
    const fixture = await boot()
    fixture.tasks = [task(fixture.workspace, 'good')]
    fixture.onChange?.()
    // Reach 09:30 UTC; the run creates one Session through the fixture registry.
    await vi.advanceTimersByTimeAsync(90 * 60 * 1000 + 1)
    await vi.waitFor(() => { expect(fixture.created).toHaveLength(1) })
    expect(fixture.created[0]).toMatch(/^scheduler-good-/)
    // Unloading the plugin aborts the registration and drains the runtimes.
    await context!.fiber.dispose()
    expect(fixture.created).toHaveLength(1)
  })

  it('keeps the exported plugin namespace complete for the Loader', () => {
    // A default export alongside these named exports would make the Loader
    // discard the namespace (see packages/AGENTS.md).
    expect(Scheduler.name).toBe('scheduler')
    expect(Scheduler.inject).toEqual([
      'agents', 'agentDefaultModel', 'permissionPresets', 'sessions', 'sessionTitle', 'workspaceRegistry',
    ])
    expect(Scheduler.Config).toBeDefined()
    expect(typeof Scheduler.apply).toBe('function')
    expect('default' in Scheduler).toBe(false)
  })

  it('defaults the deployment task layer to an empty list', () => {
    // The schema's call signature takes the resolved value; a real caller feeds
    // it raw cordis.yml data, so this exercises that boundary.
    expect((Scheduler.Config as unknown as (data: unknown) => Config)({})).toEqual({ tasks: [] })
  })

  it('refuses a structurally impossible deployment task at load', () => {
    expect(() => (Scheduler.Config as unknown as (data: unknown) => Config)({ tasks: [{ id: 'x' }] })).toThrow()
  })

  it('exports the structure check the settings write path reuses', () => {
    expect(Scheduler.validateTaskStructure).toBe(validateTaskStructure)
  })
})
