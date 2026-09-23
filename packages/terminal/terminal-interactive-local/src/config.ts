/** Validated configuration for the local interactive terminal provider. */

import z from '@deepseek-ai/schemastery'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'

/** One supported interactive shell dialect. */
export type ShellDialect = 'bash' | 'pwsh'

/** Public plugin configuration. */
export interface Config {
  /** Provider registry type (default: `shell`). */
  providerType?: string
  /** Interactive shell dialect (default: `bash`); selects the argv defaults. */
  shellDialect?: ShellDialect
  /** Interactive shell executable (default per dialect: `/bin/bash`, or the resolved pwsh). */
  shellPath?: string
  /** Shell arguments (default per dialect). */
  shellArgs?: string[]
  /** Grace before teardown escalates from TERM to KILL. */
  disposeGraceMs?: number
}

/** Configuration after Schemastery defaults and dialect resolution. */
export type ResolvedConfig = Omit<Required<Config>, 'shellDialect' | 'shellPath' | 'shellArgs'> & {
  shellDialect: ShellDialect
  shellPath: string
  shellArgs: string[]
}

/** Bash dialect default executable. */
export const DEFAULT_BASH_SHELL = '/bin/bash'
/**
 * Bash dialect default arguments.
 *
 * Unlike the model-facing PTY backend, a user's terminal keeps its own startup
 * files: aliases, prompt, and completion are the point of an interactive shell.
 */
export const DEFAULT_BASH_ARGS = ['-i']
/** Pwsh dialect default arguments: interactive host with its banner suppressed. */
export const DEFAULT_PWSH_ARGS = ['-NoLogo']

/**
 * Resolve the effective per-dialect shell specification. Defaulting is this
 * explicit step: an unset or empty `shellPath`/`shellArgs` selects the
 * dialect's defaults, while a non-empty explicit value always wins.
 * (Schemastery materializes an absent optional array as `[]`, so emptiness —
 * not just `undefined` — means "dialect default".)
 * @param config - Schemastery-resolved plugin configuration.
 * @returns the fully resolved configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const shellDialect = config.shellDialect ?? 'bash'
  const pwsh = shellDialect === 'pwsh'
  return {
    ...(config as Required<Config>),
    shellDialect,
    shellPath: config.shellPath !== undefined && config.shellPath.length > 0
      ? config.shellPath
      : (pwsh ? resolvePwshPath() : DEFAULT_BASH_SHELL),
    shellArgs: config.shellArgs !== undefined && config.shellArgs.length > 0
      ? config.shellArgs
      : (pwsh ? DEFAULT_PWSH_ARGS : DEFAULT_BASH_ARGS),
  }
}

/** Schemastery config exposed by the plugin. */
export const Config: z<Config> = z.object({
  providerType: z.string().default('shell'),
  shellDialect: z.union(['bash', 'pwsh'] as const).default('bash'),
  shellPath: z.string().required(false),
  shellArgs: z.array(z.string()).required(false),
  disposeGraceMs: z.number().default(3_000),
})

/**
 * Assert every effective string field is non-empty and every numeric field is a
 * positive safe integer.
 * @param config - Schemastery-resolved plugin configuration.
 * @returns Narrows the input to the fully resolved configuration.
 */
export function validateConfig(config: Config): asserts config is ResolvedConfig {
  const resolved = config as ResolvedConfig
  if (resolved.providerType.length === 0) throw new Error('terminal-interactive-local: providerType must be non-empty')
  if (resolved.shellPath.length === 0) throw new Error('terminal-interactive-local: shellPath must be non-empty')
  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`terminal-interactive-local: ${name} must be a positive safe integer`)
    }
  }
}
