/**
 * Node half of the terminal UI plugin: nothing to apply.
 *
 * The interaction terminal surface is browser-only, so this entry exists to keep
 * the package's two faces symmetric and to give the Loader a Node module to
 * import.
 * @module @deepseek-ai/dsh-client-ui-terminal
 */

import type { Context } from '@deepseek-ai/cordis'

/**
 * Node-half plugin body.
 * @param _ctx - Host context; this face contributes nothing.
 */
export function apply(_ctx: Context): void {}
