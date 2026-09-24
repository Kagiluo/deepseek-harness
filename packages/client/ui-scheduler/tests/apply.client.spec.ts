/**
 * ui-scheduler browser half on a real cordis Context: the plugin registers the
 * `settings.section` entry and its dictionaries against the real settings
 * domain base, projects the accepted `scheduler` configuration form onto a
 * draft, and removes every contribution when its fiber disposes.
 *
 * The Host faces are the shared Remote double, so the configuration forms, the
 * describe mirror, and the schema service under test are the shipped ones; only
 * the answers are scripted. The namespace schema is the Host package's own
 * `Config`, which is what the Host publishes as this entry's settings form.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Config } from '@deepseek-ai/dsh-scheduler'
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

/** One advertised permission preset as the Remote catalog reports it. */
interface CatalogOption {
  value: string
  name: string
  description?: string
}

/** Options a test uses to reach one deployment's shape. */
interface BenchOptions {
  /** Whether the host document accepts writes. */
  writable?: boolean
  /** Registered workspaces, or `null` to register no workspace service at all. */
  workspaces?: { workspaceId: string; path: string; title: string }[] | null
  /** Omit the `scheduler` namespace from the describe answer. */
  exposeNamespace?: boolean
  /** Return a failed describe answer. */
  describeFailure?: boolean
  /** The roster answer, or a failed read. */
  presets?: { id: string; name?: string; broken?: string }[] | 'fail'
  /** The permission catalog options, or a failed read. */
  permissionPresets?: CatalogOption[] | 'fail'
}

/** Bring up the plugin over a real slot registry, locale runtime, and settings base. */
async function bench(initialTasks: SchedulerTask[] = [], options: BenchOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)

  // The Host publishes this entry's settings form as its volatile-stripped
  // Config schema; the shipped `Config` is the same declaration.
  const schema = Config.toJSON()
  const writes: { ns: string; ops: unknown; revision: number | undefined }[] = []
  const describeCall = vi.fn(() => Promise.resolve(options.describeFailure === true
    ? { ok: false as const, error: { code: 'gateway/internal' as const, message: 'describe down' } }
    : {
      ok: true as const,
      value: {
        writable: options.writable ?? true,
        hasDocument: true,
        namespaces: options.exposeNamespace === false ? [] : [{
          autoGenerate: false,
          ns: SCHEDULER_SETTINGS_NS,
          schema,
          value: { tasks: initialTasks },
          base: { tasks: [] },
          user: undefined,
          applies: 'live' as const,
          secrets: [],
          revision: 1,
        }],
      },
    }))
  const mutateCall = vi.fn((ns: string, ops: { op: string; path: string[]; value?: unknown }[], revision: number | undefined) => {
    writes.push({ ns, ops, revision })
    // The settings wire replaces the addressed field's value, so the answered
    // section carries what the page submitted.
    const set = ops.find(op => op.op === 'set' && op.path.length === 1 && op.path[0] === 'tasks')
    const tasks = set?.value ?? []
    return Promise.resolve({
      ok: true as const,
      value: {
        autoGenerate: false,
        ns,
        schema,
        value: { tasks },
        base: { tasks: [] },
        user: { tasks },
        applies: 'live' as const,
        secrets: [],
        revision: (revision ?? 0) + 1,
      },
    })
  })
  const catalog = options.permissionPresets ?? [
    { value: 'unattended', name: 'unattended' },
    { value: 'full-access', name: 'full-access' },
  ]
  const catalogCall = vi.fn(() => Promise.resolve(catalog === 'fail'
    ? { ok: false as const, error: { code: 'gateway/internal' as const, message: 'catalog down' } }
    : {
      ok: true as const,
      value: { options: catalog, defaultOptions: catalog, defaultPreset: 'unattended' },
    }))
  const roster = options.presets ?? []
  const remote = new TestRemote(ctx, {
    settings: { describe: describeCall, mutate: mutateCall },
    permissionPresets: { catalog: catalogCall },
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
    ctx, fiber, locale, remote, writes, describeCall, catalogCall, section, injected, label,
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

  it('offers the permission presets the host advertises', async () => {
    const b = await bench()
    await vi.waitFor(() => { expect(b.state().permissionPresets).toHaveLength(2) })
    expect(b.state().permissionPresets).toEqual([
      { id: 'unattended', name: 'unattended' },
      { id: 'full-access', name: 'full-access' },
    ])
  })

  it('leaves the permission picker empty when the host advertises none', async () => {
    const b = await bench([], { permissionPresets: [] })
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
    expect(b.state().permissionPresets).toEqual([])
  })

  it('leaves the permission picker empty when the catalog read fails', async () => {
    const b = await bench([], { permissionPresets: 'fail' })
    await vi.waitFor(() => { expect(b.state().status).toBe('ready') })
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

  it('keeps reporting an unresolved namespace while the describe read keeps failing', async () => {
    const b = await bench([], { describeFailure: true })
    await vi.waitFor(() => { expect(b.describeCall).toHaveBeenCalled() })
    expect(b.state().status === 'loading' || b.state().status === 'unavailable').toBe(true)
  })

  it('reports an unserved namespace as unavailable', async () => {
    const b = await bench([], { exposeNamespace: false })
    await vi.waitFor(() => { expect(b.state().status).toBe('unavailable') })
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
    expect(b.state().dirty).toBe(false)
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

  it('refreshes the pickers when the host reports this entry changed', async () => {
    const b = await bench()
    await vi.waitFor(() => { expect(b.catalogCall).toHaveBeenCalledTimes(1) })
    // An unrelated namespace must not trigger the read...
    b.remote.emit('settings/document-updated', ['another', 1])
    expect(b.catalogCall).toHaveBeenCalledTimes(1)
    // ...while this entry's own change does. The refresh reads the catalogs in
    // sequence, so the second read lands a microtask later.
    b.remote.emit('settings/document-updated', [SCHEDULER_SETTINGS_NS, 2])
    await vi.waitFor(() => { expect(b.catalogCall).toHaveBeenCalledTimes(2) })
  })

  it('refreshes the permission picker when the host reports a catalog change', async () => {
    const b = await bench()
    await vi.waitFor(() => { expect(b.catalogCall).toHaveBeenCalledTimes(1) })
    b.remote.emit('permission-presets/catalog-changed', [])
    await vi.waitFor(() => { expect(b.catalogCall).toHaveBeenCalledTimes(2) })
  })

  it('removes the entry and its dictionaries when the fiber disposes', async () => {
    const b = await bench()
    expect(b.section()).toBeDefined()
    await b.fiber.dispose()
    expect(b.section()).toBeUndefined()
  })
})

describe('ui-scheduler Remote namespace declaration', () => {
  it('names each generated Remote namespace in its injection set, not just remote', () => {
    // A generated Remote namespace is its own service, registered by the
    // sibling api-remotes fiber. The `ctx.remote` property proxy resolves a
    // namespace only when that dotted name is in the consumer's injection set;
    // `remote` alone leaves the read throwing "cannot get property
    // remote.agentPresets without inject", which the picker's failure handler
    // turns into an empty list. Injection sets are static, so the declaration
    // is what this pins.
    expect(inject).toContain('remote')
    expect(inject).toContain('remote.agentPresets')
    expect(inject).toContain('remote.permissionPresets')
  })

  it('resolves the namespaces when they are registered by a sibling fiber', async () => {
    // The shared Remote double registers `remote.<name>` on the root context,
    // which resolves even without the dotted inject and so cannot see this
    // defect. Production registers the namespaces underneath api-remotes, so
    // this bench reproduces that topology: the reads succeed only when the
    // fiber's injection set names the dotted services.
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
    class FakePermissionPresets extends Service {
      /** @returns one catalog with a single preset. */
      catalog(): Promise<unknown> {
        return Promise.resolve({ ok: true, value: { options: [{ value: 'unattended', name: 'Unattended' }] } })
      }
    }
    const ctx = new Context()
    new FakeRemote(ctx, 'remote')
    const sibling = ctx.plugin({
      name: 'api-remotes-fixture',
      apply: (c: Context) => {
        new FakeAgentPresets(c, 'remote.agentPresets')
        new FakePermissionPresets(c, 'remote.permissionPresets')
      },
    })
    await sibling.await()

    let outcome = 'NOT RUN'
    const consumer = ctx.plugin({
      name: 'consumer',
      inject: inject.filter(name => name === 'remote' || name.startsWith('remote.')),
      apply: async (c: Context) => {
        // Read through the same property paths the plugin uses.
        const namespaces = c.remote as unknown as {
          agentPresets: { list(): Promise<unknown> }
          permissionPresets: { catalog(): Promise<unknown> }
        }
        outcome = JSON.stringify([await namespaces.agentPresets.list(), await namespaces.permissionPresets.catalog()])
      },
    })
    await consumer.await()
    expect(outcome).toContain('standard')
    expect(outcome).toContain('unattended')
  })
})
