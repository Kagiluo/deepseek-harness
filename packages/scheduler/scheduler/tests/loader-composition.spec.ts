/**
 * Real Loader composition: the function plugin's `name`/`inject`/`Config`/`apply`
 * namespace arrives intact through the shipped composition path, the plugin
 * opts out of the generated settings form, and a volatile task-list update
 * re-arms one runtime per resolvable task while leaving the rest of the
 * schedule running.
 *
 * Nothing here is a hand-built `ctx.plugin(...)` call: the plugin is loaded by
 * the Loader from a cordis.yml, with its session-creation dependencies provided
 * as fixtures, so the function-plugin export form, the volatile config commit,
 * and the `loader/volatile-update` notification are exercised as shipped.
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
import { validateTaskStructure, type Config } from '../src/index.ts'
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

/** The fixture's observations and the way it drives the live task list. */
interface Fixture {
  readonly warnings: string[]
  readonly created: string[]
  /** Absolute workspace directory the fixture registry resolves and tasks name. */
  readonly workspace: string
  /** The generated-form policy the plugin registered, or undefined before it lands. */
  auto: boolean | undefined
  /** Replace the scheduler entry's live volatile task list through the Loader. */
  setTasks: (tasks: SchedulerTask[]) => Promise<void>
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
    '- id: scheduler',
    "  name: '@deepseek-ai/dsh-scheduler'",
    '  config:',
    '    tasks: []',
    '',
  ].join('\n'))

  const configured = Promise.withResolvers<undefined>()
  const fixture: Fixture = {
    warnings: [], created: [], workspace, auto: undefined,
    setTasks: async () => { throw new Error('the scheduler entry was not loaded') },
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
      // The optional settings provider: the plugin injects it only to declare
      // that this entry ships its own page instead of a generated form.
      ctx.provide('settings', {
        configure: (presentation: { auto?: boolean }) => {
          fixture.auto = presentation.auto
          configured.resolve(undefined)
          return () => {}
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
  await configured.promise
  const entry = [...context.loader.entries()].find(candidate => candidate.options.id === 'scheduler')
  if (entry === undefined) throw new Error('the scheduler entry was not loaded')
  // A volatile-only config change commits into the running references and
  // notifies the owning fiber, which is exactly the settings write path.
  fixture.setTasks = async (tasks) => { await entry.update({ config: { tasks } }) }
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
  it('loads the function-plugin namespace and opts out of the generated form', { timeout: 60_000 }, async () => {
    const fixture = await boot()
    expect([...context!.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    // `configure({ auto: false })` is what removes the Loader-generated form for
    // this entry now that its own `Config` is the settings schema.
    expect(fixture.auto).toBe(false)
  })

  it('arms one runtime per resolvable task and reports the skipped ones', { timeout: 60_000 }, async () => {
    const fixture = await boot()
    // Publish a stored list: one resolvable task, one whose preset is not
    // admissible, and one paused by its author.
    await fixture.setTasks([
      task(fixture.workspace, 'good'),
      task(fixture.workspace, 'asking', { permissionPreset: 'never' }),
      task(fixture.workspace, 'paused', { enabled: false }),
    ])
    await vi.waitFor(() => { expect(fixture.warnings.some(line => line.includes('is not armed'))).toBe(true) })
    // The eligible preset is the only one the fixture resolves; a task naming
    // anything else is skipped with a warning that names it.
    expect(fixture.warnings.some(line => line.includes('"asking"') && line.includes('is not armed'))).toBe(true)
    // The paused task is neither armed nor reported.
    expect(fixture.warnings.some(line => line.includes('"paused"'))).toBe(false)
  })

  it('logs a re-arm failure for a stored task whose structure is impossible', { timeout: 60_000 }, async () => {
    const fixture = await boot()
    // The schema admits both records; only the structural check can refuse the
    // duplicate id, and that check now runs on every re-arm rather than at write.
    await fixture.setTasks([
      task(fixture.workspace, 'duplicate'),
      task(fixture.workspace, 'duplicate', { prompt: 'second' }),
    ])
    await vi.waitFor(() => { expect(fixture.warnings.some(line => line.includes('re-arm failed'))).toBe(true) })
    expect(fixture.warnings.some(line => line.includes('duplicate scheduler task id'))).toBe(true)
    await vi.advanceTimersByTimeAsync(90 * 60 * 1000 + 1)
    expect(fixture.created).toEqual([])
  })

  it('disposes the previous arm set when a later task list replaces it', { timeout: 60_000 }, async () => {
    const fixture = await boot()
    await fixture.setTasks([task(fixture.workspace, 'first')])
    // Let the first resolution settle so it actually armed a runtime.
    await vi.advanceTimersByTimeAsync(0)
    await fixture.setTasks([task(fixture.workspace, 'second')])
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
    const first = fixture.setTasks([task(fixture.workspace, 'stale')])
    const second = fixture.setTasks([task(fixture.workspace, 'current')])
    await Promise.all([first, second])
    await vi.advanceTimersByTimeAsync(90 * 60 * 1000 + 1)
    await vi.waitFor(() => { expect(fixture.created.length).toBeGreaterThan(0) })
    // Only the second generation's task ran; the superseded one discarded its
    // own result rather than arming a schedule nobody asked for.
    expect(fixture.created.every(id => id.includes('current'))).toBe(true)
  })

  it('arms a task that actually comes due and releases it on unload', { timeout: 60_000 }, async () => {
    const fixture = await boot()
    await fixture.setTasks([task(fixture.workspace, 'good')])
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
    const resolved = (Scheduler.Config as unknown as (data: unknown) => Config)({})
    expect(resolved.tasks.get()).toEqual([])
  })

  it('refuses a structurally impossible deployment task at load', () => {
    expect(() => (Scheduler.Config as unknown as (data: unknown) => Config)({ tasks: [{ id: 'x' }] })).toThrow()
  })

  it('exports the structure check the settings page mirrors', () => {
    expect(Scheduler.validateTaskStructure).toBe(validateTaskStructure)
  })
})
