/**
 * Browser half of the Scheduler settings page: the `settings.section` entry
 * that lists, adds, edits, and removes the deployment's scheduled tasks.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale) into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings and permission invalidations ride the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section'
// entry) and its configForms service merge into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the renderer's Context merge (ctx.slots) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Workspace service merge (ctx.workspaces) into this program.
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SchedulerTask } from '@deepseek-ai/dsh-scheduler'
import { SchedulerTasksController, type SchedulerSection as SchedulerConfigSection } from './controller.ts'
import { SchedulerSection, type SchedulerSectionInjected } from './SchedulerSection.tsx'
import { en, NS, zh, type SchedulerLocaleKey } from './locales.ts'

/**
 * The Host entry id owning the settings section, spelled again on the browser
 * side.
 *
 * `packages/scheduler/scheduler/src/settings.ts` owns the declaration; the
 * client cannot import the constant because a cross-plugin value import is
 * rejected by the bundle purity gate. `tests/locales.client.spec.ts` pins the
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
 * Required services. `configForms` carries the `scheduler` entry's values and
 * write queue, `remote` the Remote method face, and `workspaces` the registered
 * directories.
 *
 * `remote.agentPresets` and `remote.permissionPresets` are named separately
 * because a generated Remote namespace is its own service: the `ctx.remote`
 * property proxy resolves a namespace only when that dotted name is in this
 * fiber's injection set, and reads the namespace off the sibling fiber that
 * mounted it. Declaring `remote` alone leaves the read throwing "cannot get
 * property ... without inject".
 */
export const inject = [
  'slots', 'locale', 'remote', 'remote.agentPresets', 'remote.permissionPresets', 'configForms', 'workspaces',
]

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
  const controller = new SchedulerTasksController(ctx.configForms.get<SchedulerConfigSection>(SCHEDULER_SETTINGS_NS), {
    workspaces,
    presets: async () => {
      const response = await ctx.remote.agentPresets.list()
      if (!response.ok) throw new Error(response.error.message)
      return response.value.presets
        .filter(preset => preset.broken === undefined)
        .map(preset => ({ id: preset.id, name: preset.name ?? preset.id }))
    },
    // The unattended subset is enforced when the Host arms a task, so the page
    // offers every preset the permission table advertises and restates no
    // policy of its own.
    permissionPresets: async () => {
      const response = await ctx.remote.permissionPresets.catalog()
      if (!response.ok) throw new Error(response.error.message)
      return response.value.options.map(option => ({ id: option.value, name: option.name }))
    },
  })
  const stopSettings = controller.start()
  ctx.effect(() => () => { stopSettings() }, 'ui-scheduler: settings subscription')
  // Never rejects: each catalog read resolves to an empty list on failure, so a
  // picker is simply left without options.
  void controller.refreshCatalogues()
  ctx.effect(
    () => ctx.remote.$on('settings/document-updated', (ns) => {
      if (ns !== SCHEDULER_SETTINGS_NS) return
      void controller.refreshCatalogues()
    }),
    'ui-scheduler: settings invalidations',
  )
  ctx.effect(
    () => ctx.remote.$on('permission-presets/catalog-changed', () => { void controller.refreshCatalogues() }),
    'ui-scheduler: permission invalidations',
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
