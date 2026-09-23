/**
 * The `terminal` tab type: a page, not a viewer.
 *
 * It claims no address. The guide page offers it as an entry box, and every
 * terminal opened from that box is its own tab, because two terminals of one
 * workspace are two different shells rather than two views of one thing.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const TERMINAL_KIND = 'terminal'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const TERMINAL_ID = '@deepseek-ai/dsh-client-ui-terminal'

/**
 * The terminal type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function terminalDefinition(t: TranslateNS<'terminal'>): SidebarRightTabDefinition {
  return {
    id: TERMINAL_ID,
    kind: TERMINAL_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }
}
