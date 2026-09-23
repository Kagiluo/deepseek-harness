/**
 * Browser half: register `terminal` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * then the body into the keyed `sidebar.right.pane.tab` seat under the type's
 * `id`. There is no title registration: the type's own thunked `title` is what
 * the chip captures when a tab opens, and a terminal's title never changes.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-terminal-controller/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { TERMINAL_ID, terminalDefinition } from './definition.ts'
import { terminalFace } from './face.ts'
import { en, zh } from './locales.ts'
import { TerminalBody } from './TerminalBody.tsx'

export type { TerminalKey } from './locales.ts'
export type { TerminalBodyProps } from './TerminalBody.tsx'
export type { TerminalInjected, TerminalRemote } from './face.ts'

/** This package's copy namespace. */
const NS = 'terminal'

/**
 * Required browser services: the tab registry, the keyed seat's declaration,
 * the Remote carrier, and its `terminals` namespace.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.terminals']

/**
 * Client plugin body: register the type, its dictionaries, and its tab body.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(terminalDefinition(t)), 'ui-terminal: terminal type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-terminal: dictionaries')

  const face = terminalFace(ctx.remote)
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TERMINAL_ID, locale: NS, inject: face },
    TerminalBody,
  )), 'ui-terminal: terminal tab body')
}
