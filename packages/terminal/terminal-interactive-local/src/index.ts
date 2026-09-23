/**
 * Local interactive terminal provider over the subprocess terminal primitive,
 * the shared sandbox policy, and provider-owned session cleanup.
 * @module @deepseek-ai/dsh-terminal-interactive-local
 */

import { Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type {
  InteractiveTerminalBackendSession,
  InteractiveTerminalOpenSpec,
  InteractiveTerminalProvider,
} from '@deepseek-ai/dsh-terminal-interactive'
import { type Config, type ResolvedConfig, resolveConfig, validateConfig } from './config.ts'
import { LocalInteractiveSession } from './session.ts'

export { Config } from './config.ts'
export type { Config as TerminalInteractiveLocalConfig } from './config.ts'

/** Cordis plugin name. */
export const name = 'terminal-interactive-local'
/** Required services: the interactive terminal registry, the shared confinement policy, and the process substrate. */
export const inject = ['interactiveTerminals', 'sandboxPolicy', 'subprocess']

/**
 * The environment this provider layers over the subprocess provider's own
 * scrubbed ambient base. `TERM` and `COLORTERM` describe the Client emulator,
 * not this process, so a shell emits the escapes the terminal can draw.
 */
function childEnvironment(spec: InteractiveTerminalOpenSpec): Record<string, string> {
  return {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    DSH_SHELL: '1',
    DSH_SESSION_ID: spec.owner,
    DSH_PTY_SESSION_ID: spec.terminalId,
  }
}

/** The argv the shared sandbox policy permits for one spawn. */
function spawnArgv(ctx: Context, config: ResolvedConfig, policy: SandboxExecutionPolicy): string[] {
  const argv = [config.shellPath, ...config.shellArgs]
  if (policy.mode === 'danger-full-access') return argv
  const sandbox = ctx.get('sandbox')
  if (sandbox === undefined) {
    throw new Error(
      `terminal-interactive-local: sandbox mode "${policy.mode}" requires a ctx.sandbox provider in the execution world`,
    )
  }
  // Re-state the discriminant because object spread does not preserve its narrowed type.
  return sandbox.confine(argv, { ...policy, mode: policy.mode }).argv
}

/** Local shell provider registered under the configured type. */
export class LocalInteractiveTerminalProvider implements InteractiveTerminalProvider {
  /**
   * @param ctx - Host context carrying the process substrate and the policy.
   * @param type - provider type this instance registers under.
   * @param config - resolved shell and cleanup settings.
   */
  constructor(
    private readonly ctx: Context,
    readonly type: string,
    private readonly config: ResolvedConfig,
  ) {}

  /**
   * Allocate one shell terminal in the requested directory under the owning
   * Session's execution policy.
   * @param spec - minted identity, owning Session, and requested dimensions.
   * @returns the live session; a sandbox refusal rejects before any process is published.
   */
  async open(spec: InteractiveTerminalOpenSpec): Promise<InteractiveTerminalBackendSession> {
    spec.signal?.throwIfAborted()
    const session = this.ctx.get('sessions')?.get(spec.owner)
    const policy = this.ctx.sandboxPolicy.resolve(session === undefined ? {} : { session })
    const argv = spawnArgv(this.ctx, this.config, policy)
    if (argv[0] === undefined) throw new Error('terminal-interactive-local: sandbox returned empty argv')
    const terminal = await this.ctx.subprocess.spawnTerminal({
      argv,
      // A caller that names no directory gets the policy's root, which is the
      // owning Session's cwd when it has one and the deployment root otherwise.
      cwd: spec.cwd ?? policy.workspaceRoot,
      env: childEnvironment(spec),
      rows: spec.rows,
      cols: spec.cols,
      graceMs: this.config.disposeGraceMs,
      signal: spec.signal,
    })
    return new LocalInteractiveSession(terminal)
  }
}

/**
 * Register the local interactive terminal provider.
 * @param ctx - Host context carrying the registry and the substrate.
 * @param config - plugin configuration; unspecified fields take dialect defaults.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  validateConfig(resolved)
  ctx.interactiveTerminals.registerProvider(
    new LocalInteractiveTerminalProvider(ctx, resolved.providerType, resolved),
  )
}
