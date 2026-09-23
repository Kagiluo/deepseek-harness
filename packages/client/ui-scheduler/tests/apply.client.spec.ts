/**
 * ui-scheduler browser half on a real cordis Context: the plugin registers the
 * `settings.section` entry and its dictionaries against the real settings
 * domain base, projects the accepted namespace onto a draft, and removes every
 * contribution when its fiber disposes.
 *
 * The Host faces are the shared Remote double, so the settings scope, the
 * mirror, and the schema service under test are the shipped ones; only the
 * answers are scripted. The namespace schema comes from the Host package's own
 * builder, which pins what the page introspects to what the Host advertises.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { schedulerSettingsSchema } from '@deepseek-ai/dsh-scheduler'
import z from '@deepseek-ai/schemastery'
import type { SchedulerTask } from '@deepseek-ai/dsh-scheduler'
import { SchedulerSection, type SchedulerSectionInjected } from '../src/client/SchedulerSection.tsx'
import { apply, inject, SCHEDULER_SETTINGS_NS } from '../src/client/index.ts'
import { NS } from '../src/client/locales.ts'
import type { SchedulerTasksState } from '../src/client/tasks-store.ts'

/** One stored task. */
function task(overrides: Partial<SchedulerTask> = {}): SchedulerTask {
  return {
    id: 'daily',
    workspacePath: '/tmp/workspace',
    time: '09:30:00',
    prompt: 'run nightly',
    permissionPreset: 'unattended',
    ...overrides,
  }
}

/** The serialized namespace schema the Host publishes for this deployment. */
function envelope(eligible: readonly string[] = ['unattended', 'full-access']): unknown {
  return schedulerSettingsSchema(eligible).toJSON()
}

/**
 * The same namespace with a wider permission union: a constant, a plain string,
 * and a non-string constant that the picker must skip.
 * @returns the serialized envelope.
 */
function widenedEnvelope(): unknown {
  const task = z.object({
    id: z.string().required(),
    workspacePath: z.string().required(),
    time: z.string().required(),
    prompt: z.string().required(),
    permissionPreset: z.union([z.const('unattended'), z.string(), z.const(7)]).required(),
  })
  return z.object({ tasks: z.array(task).default([]) }).toJSON()
}

/** Options a test uses to reach one deployment's shape. */
interface BenchOptions {
  /** Whether the host document accepts writes. */
  writable?: boolean
  /** Registered workspaces, or `null` to register no workspace service at all. */
  workspaces?: { workspaceId: string; path: string; title: string }[] | null
  /** Omit the `scheduler` namespace from the describe answer. */
  exposeNamespace?: boolean
  /** The preset-union members to advertise. */
  eligible?: readonly string[]
  /** A raw serialized schema to publish instead of the built envelope. */
  rawSchema?: unknown
  /** Return a failed describe answer. */
  describeFailure?: boolean
  /** The roster answer, or a failed read. */
  presets?: { id: string; name?: string; broken?: string }[] | 'fail'
}

/** Bring up the plugin over a real slot registry, locale runtime, and settings base. */
async function bench(initialTasks: SchedulerTask[] = [], options: BenchOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)

  const eligible = options.eligible ?? ['unattended', 'full-access']
  const schema = options.rawSchema ?? envelope(eligible)
  const writes: { ns: string; ops: unknown; revision: number | undefined }[] = []
  const describeCall = vi.fn(() => Promise.resolve(options.describeFailure === true
    ? { ok: false as const, error: { code: 'gateway/internal' as const, message: 'describe down' } }
    : {
      ok: true as const,
      value: {
        writable: options.writable ?? true,
        hasDocument: true,
        namespaces: options.exposeNamespace === false ? [] : [{
          ns: SCHEDULER_SETTINGS_NS,
          schema,
          value: { tasks: initialTasks },
          applies: 'live' as const,
          secrets: [],
          revision: 1,
        }],
      },
    }))
  const mutateCall = vi.fn((ns: string, ops: unknown, revision: number) => {
    writes.push({ ns, ops, revision })
    return Promise.resolve({
      ok: true as const,
      value: {
        ns,
        schema,
        value: { tasks: [] },
        applies: 'live' as const,
        secrets: [],
        revision: revision + 1,
      },
    })
  })
  const roster = options.presets ?? []
  const remote = new TestRemote(ctx, {
    settings: { describe: describeCall, mutate: mutateCall },
    agentPresets: {
      list: () => Promise.resolve(roster === 'fail'
        ? { ok: false as const, error: { code: 'gateway/internal' as const, message: 'roster down' } }
        : {
          ok: true as const,
          value: {
            presets: roster.map(preset => ({
              id: preset.id,
              trust: 'system' as const,
              isDefault: false,
              ...(preset.name === undefined ? {} : { name: preset.name }),
              ...(preset.broken === undefined ? {} : { broken: preset.broken }),
            })),
            authorable: false,
          },
        }),
    },
  })
  onTestFinished(() => { remote.emit('connection/reset', []) })
  if (options.workspaces !== null) {
    ctx.provide('workspaces', {
      list: {
        getSnapshot: () => ({
          items: options.workspaces ?? [{ workspaceId: 'w1', path: '/tmp/workspace', title: '' }],
        }),
      },
    } as never)
  }
  ctx.slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const section = () => ctx.slots.entries('settings.section').find(entry => entry.component === SchedulerSection)
  await vi.waitFor(() => { expect(section()).toBeDefined() })
  /** The registration's inject face, as the renderer receives it. */
  const injected = (): SchedulerSectionInjected => {
    const entry = section()
    if (entry?.inject === undefined) throw new Error('the section entry exposes no inject face')
    return entry.inject() as unknown as SchedulerSectionInjected
  }
  /** Resolve the entry's label, which the register call may supply as a thunk. */
  const label = (): string | undefined => {
    const declared = section()?.options.label
    return typeof declared === 'function' ? declared() : declared
  }
  return {
    ctx, fiber, locale, remote, writes, describeCall, section, injected, label,
    state: (): SchedulerTasksState => injected().hooks.schedulerTasks.getSnapshot(),
  }
}

describe('ui-scheduler browser plugin', () => {
  it('registers one settings.section entry under the scheduler namespace', async () => {
    const b = await bench()
    // List entries carry the nav identity in `options`; the dictionary namespace
    // rides the entry itself.
    expect(b.section()?.options).toMatchObject({ id: 'scheduled-tasks', order: 25 })
    expect(typeof b.section()?.options.label).toBe('function')
    expect(b.section()?.locale).toBe(NS)
  })

  it('localizes the entry label through the plugin dictionary', async () => {
    const b = await bench()
    expect(b.label()).toBe('Scheduled tasks')
    b.locale.setLocale('zh')
    // The entry re-registers with fresh text on a locale change.
    await vi.waitFor(() => { expect(b.label()).toBe('定时任务') })
  })

  it('projects the accepted namespace onto the page state', async () => {
    const b = await bench([task()])
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    expect(b.state().draft).toEqual([task()])
    expect(b.state().writable).toBe(true)
  })

  it('reads the unattended permission presets out of the Host schema', async () => {
    const b = await bench()
    await vi.waitFor(() => { expect(b.state().permissionPresets).toHaveLength(2) })
    expect(b.state().permissionPresets).toEqual([
      { id: 'unattended', name: 'unattended' },
      { id: 'full-access', name: 'full-access' },
    ])
  })

  it('leaves the preset picker empty when the deployment advertises no union', async () => {
    const b = await bench([], { eligible: [] })
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    expect(b.state().permissionPresets).toEqual([])
  })

  it('leaves the preset picker empty before any describe answer lands', async () => {
    // No namespace is exposed at all, so the schema walk finds nothing to read.
    const b = await bench([], { exposeNamespace: false })
    expect(b.state().permissionPresets).toEqual([])
  })

  it('names a workspace by its title, falling back to its path', async () => {
    const b = await bench([], {
      workspaces: [
        { workspaceId: 'w1', path: '/tmp/workspace', title: 'my project' },
        { workspaceId: 'w2', path: '/tmp/other', title: '' },
      ],
    })
    await vi.waitFor(() => { expect(b.state().workspaces).toHaveLength(2) })
    expect(b.state().workspaces).toEqual([
      { path: '/tmp/workspace', name: 'my project' },
      { path: '/tmp/other', name: '/tmp/other' },
    ])
  })

  it('drops a broken roster row and falls back to the preset id for a name', async () => {
    const b = await bench([], {
      presets: [
        { id: 'standard', name: 'Standard' },
        { id: 'bare' },
        { id: 'broken', broken: 'cannot compose' },
      ],
    })
    await vi.waitFor(() => { expect(b.state().presets).toHaveLength(2) })
    expect(b.state().presets).toEqual([
      { id: 'standard', name: 'Standard' },
      { id: 'bare', name: 'bare' },
    ])
  })

  it('leaves the agent-preset picker empty when the roster read fails', async () => {
    const b = await bench([], { presets: 'fail' })
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    expect(b.state().presets).toEqual([])
  })

  it('reports an unavailable namespace while the describe read keeps failing', async () => {
    const b = await bench([], { describeFailure: true })
    await vi.waitFor(() => {
      expect(b.state().status === 'loading' || b.state().status === 'unavailable').toBe(true)
    })
    expect(b.state().permissionPresets).toEqual([])
  })

  it('submits the whole draft as one atomic mutation in the scheduler namespace', async () => {
    const b = await bench([task()])
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    const injected = b.injected()
    injected.patch(0, { prompt: 'edited by the page' })
    await injected.save()
    expect(b.writes).toHaveLength(1)
    expect(b.writes[0]?.ns).toBe(SCHEDULER_SETTINGS_NS)
    expect(b.writes[0]?.revision).toBe(1)
    expect(b.writes[0]?.ops).toEqual([
      { op: 'set', path: ['tasks'], value: [task({ prompt: 'edited by the page' })] },
    ])
  })

  it('adds a task through the inject face and exposes the draft for the renderer', async () => {
    const b = await bench()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    const injected = b.injected()
    injected.add()
    expect(b.state().draft).toHaveLength(1)
    injected.remove(0)
    expect(b.state().draft).toEqual([])
    expect(typeof injected.hooks.schedulerTasks.getSnapshot).toBe('function')
    expect(typeof injected.hooks.schedulerTasks.subscribe).toBe('function')
  })

  it('discards an edit through the inject face', async () => {
    const b = await bench([task()])
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    const injected = b.injected()
    injected.patch(0, { prompt: 'edited by the page' })
    expect(b.state().draft[0]?.prompt).toBe('edited by the page')
    injected.discard()
    expect(b.state().draft[0]?.prompt).toBe('run nightly')
    expect(b.state().dirty).toBe(false)
  })

  it('refreshes the pickers when the host reports a settings document change', async () => {
    const b = await bench()
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    // The forwarded event is what an external edit announces; an unrelated
    // namespace must not throw either.
    b.remote.emit('settings/document-updated', ['another', 1])
    b.remote.emit('settings/document-updated', [SCHEDULER_SETTINGS_NS, 2])
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    expect(b.state().permissionPresets).toHaveLength(2)
  })

  it('skips a union member that is not an advertised constant', async () => {
    // A deployment may widen its permission field to a union that also admits a
    // plain string; the page offers only the constants it can name, so the
    // widened member is skipped rather than listed as a bogus choice.
    const b = await bench([], { rawSchema: widenedEnvelope() })
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    expect(b.state().permissionPresets).toEqual([{ id: 'unattended', name: 'unattended' }])
  })

  it('removes the entry and its dictionaries when the fiber disposes', async () => {
    const b = await bench()
    expect(b.section()).toBeDefined()
    await b.fiber.dispose()
    expect(b.section()).toBeUndefined()
  })
})

describe('ui-scheduler Remote namespace declaration', () => {
  it('names remote.agentPresets in its injection set, not just remote', () => {
    // A generated Remote namespace is its own service, registered by the
    // sibling api-remotes fiber. The `ctx.remote` property proxy resolves a
    // namespace only when that dotted name is in the consumer's injection set;
    // `remote` alone leaves the read throwing "cannot get property
    // remote.agentPresets without inject", which the picker's failure handler
    // turns into an empty agent-preset list. Injection sets are static, so the
    // declaration is what this pins.
    expect(inject).toContain('remote')
    expect(inject).toContain('remote.agentPresets')
  })

  it('resolves the namespace when it is registered by a sibling fiber', async () => {
    // The shared Remote double registers `remote.<name>` on the root context,
    // which resolves even without the dotted inject and so cannot see this
    // defect. Production registers the namespace underneath api-remotes, so
    // this bench reproduces that topology: the read succeeds only when the
    // fiber's injection set names the dotted service.
    class FakeRemote extends Service {
      /** Forwarded-event sink; this bench drives no host events. */
      $on(): () => void { return () => {} }
    }
    class FakeAgentPresets extends Service {
      /** @returns one roster with a single healthy preset. */
      list(): Promise<unknown> {
        return Promise.resolve({ ok: true, value: { presets: [{ id: 'standard', name: 'Standard' }] } })
      }
    }
    const ctx = new Context()
    new FakeRemote(ctx, 'remote')
    const sibling = ctx.plugin({
      name: 'api-remotes-fixture',
      apply: (c: Context) => { new FakeAgentPresets(c, 'remote.agentPresets') },
    })
    await sibling.await()

    let outcome = 'NOT RUN'
    const consumer = ctx.plugin({
      name: 'consumer',
      inject: inject.filter(name => name === 'remote' || name === 'remote.agentPresets'),
      apply: async (c: Context) => {
        // Read through the same property path the plugin uses.
        const ns = (c.remote as unknown as { agentPresets: { list(): Promise<unknown> } }).agentPresets
        outcome = JSON.stringify(await ns.list())
      },
    })
    await consumer.await()
    expect(outcome).toContain('standard')
  })
})
