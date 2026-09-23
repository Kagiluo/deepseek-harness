/**
 * Browser half of the Scheduler settings page: the `settings.section` entry
 * that lists, adds, edits, and removes the deployment's scheduled tasks.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale) into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section'
// entry) and its settings-scope/schema service merges into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the renderer's Context merge (ctx.slots) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Workspace service merge (ctx.workspaces) into this program.
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SchedulerTask } from '@deepseek-ai/dsh-scheduler'
import { SchedulerTasksController } from './controller.ts'
import { SchedulerSection, type SchedulerSectionInjected } from './SchedulerSection.tsx'
import { en, NS, zh, type SchedulerLocaleKey } from './locales.ts'

/**
 * The Host's settings namespace, spelled again on the browser side.
 *
 * `packages/scheduler/scheduler/src/settings.ts` owns the declaration; the
 * client cannot import the constant because a cross-plugin value import is
 * rejected by the bundle purity gate. `tests/namespace.client.spec.ts` pins the
 * two spellings together, so a rename on either side fails a test rather than
 * silently detaching the page from its storage.
 */
export const SCHEDULER_SETTINGS_NS = 'scheduler'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Scheduled-task editor copy. */
    'settings.scheduler': SchedulerLocaleKey
  }
}

/**
 * Required services. `settingsScope` carries the namespace read/write face,
 * `settingsSchema` reads the permission choices the Host advertises, `remote`
 * the Remote method face, and `workspaces` the registered directories.
 *
 * `remote.agentPresets` is named separately because a generated Remote
 * namespace is its own service: the `ctx.remote` property proxy resolves a
 * namespace only when that dotted name is in this fiber's injection set, and
 * reads the namespace off the sibling fiber that mounted it. Declaring `remote`
 * alone leaves the read throwing "cannot get property ... without inject".
 */
export const inject = ['slots', 'locale', 'remote', 'remote.agentPresets', 'settingsScope', 'settingsSchema', 'workspaces']

/** One advertised constant choice inside a union schema node. */
interface ConstChoice {
  type: string
  value?: unknown
}

/**
 * Read the permission presets the Host advertises as runnable unattended.
 *
 * The Host encodes them as a union of constants inside the task schema, which
 * is the same mechanism the permission page uses for its own picker: the schema
 * is what a configuration surface reads to build a choice list, so no policy is
 * restated client side. A union is identified by its member list — a plain
 * `string` node, which is what a deployment mounting no permission service
 * registers, carries none. The walk is explicit rather than going through
 * `nodeAtPath`, whose single-key-per-level contract descends through an array
 * without consuming the key that names a field inside its element.
 *
 * The descriptor comes from the shared describe mirror, which is the browser's
 * one `settings.describe` reader: a per-namespace scope carries the resolved
 * value but not the namespace's schema, so the schema has to be read here.
 * @param describe - the shared mirror's read face.
 * @param schema - the settings-owned schema rehydrator.
 * @returns the preset names in advertised order, or none before the first read
 * lands or when this deployment advertises no union.
 */
function eligiblePresets(
  describe: { getSnapshot(): { view?: { namespaces: readonly { ns: string; schema: unknown }[] } | undefined } },
  schema: { rehydrate(serialized: unknown): { dict?: Record<string, unknown> } },
): { id: string; name: string }[] {
  const namespaces = describe.getSnapshot().view?.namespaces
  const view = namespaces?.find(entry => entry.ns === SCHEDULER_SETTINGS_NS)
  if (view === undefined) return []
  const root = schema.rehydrate(view.schema) as {
    dict?: Record<string, { inner?: { dict?: Record<string, { list?: ConstChoice[] }> } }>
  }
  const tasks = root.dict?.['tasks']
  const field = tasks?.inner?.dict?.['permissionPreset']
  if (field?.list === undefined) return []
  return field.list.flatMap((choice) => {
    if (choice.type !== 'const' || typeof choice.value !== 'string') return []
    return [{ id: choice.value, name: choice.value }]
  })
}

/**
 * Register the dictionaries and the Scheduled tasks settings page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-scheduler: dictionaries')

  // A captured function, not the service object: the proxy is topology
  // sensitive, and this page reads the registry lazily on each picker refresh.
  const workspaces = () => ctx.workspaces.list.getSnapshot().items
    .map(item => ({ path: item.path, name: item.title === '' ? item.path : item.title }))
  const describe = () => ctx.settingsScope.describe()
  const controller = new SchedulerTasksController(ctx.settingsScope.bind({ namespace: SCHEDULER_SETTINGS_NS }), {
    workspaces,
    presets: async () => {
      const response = await ctx.remote.agentPresets.list()
      if (!response.ok) throw new Error(response.error.message)
      return response.value.presets
        .filter(preset => preset.broken === undefined)
        .map(preset => ({ id: preset.id, name: preset.name ?? preset.id }))
    },
    permissionPresets: () => eligiblePresets(describe(), ctx.settingsSchema),
  })
  const stopSettings = controller.start()
  ctx.effect(() => () => { stopSettings() }, 'ui-scheduler: settings subscription')
  // Never rejects: the roster read is the only fallible step and it resolves to
  // an empty list, so the picker is simply left without preset options.
  void controller.refreshCatalogues()
  ctx.effect(
    () => ctx.remote.$on('settings/document-updated', () => { void controller.refreshCatalogues() }),
    'ui-scheduler: catalog invalidations',
  )

  const injected = (): SchedulerSectionInjected => ({
    hooks: { schedulerTasks: controller.source },
    add: () => { controller.add() },
    remove: (index: number) => { controller.remove(index) },
    patch: (index: number, next) => { controller.patch(index, next) },
    save: () => controller.save(),
    discard: () => { controller.discard() },
  })

  // Placed after the agent-preset page: the tasks that compose sessions follow
  // the compositions they draw on.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'scheduled-tasks',
    order: 25,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: injected,
  }, SchedulerSection))
}

export type { SchedulerTask }
