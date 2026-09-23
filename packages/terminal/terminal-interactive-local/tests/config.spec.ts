import { describe, expect, it } from 'vitest'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { DEFAULT_BASH_ARGS, DEFAULT_BASH_SHELL, DEFAULT_PWSH_ARGS, resolveConfig, validateConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('selects the bash dialect and its defaults when nothing is configured', () => {
    const resolved = resolveConfig({ providerType: 'shell', disposeGraceMs: 10 })
    expect(resolved.shellDialect).toBe('bash')
    expect(resolved.shellPath).toBe(DEFAULT_BASH_SHELL)
    expect(resolved.shellArgs).toEqual(DEFAULT_BASH_ARGS)
  })

  it('selects the resolved pwsh executable and its defaults for the pwsh dialect', () => {
    const resolved = resolveConfig({ providerType: 'shell', shellDialect: 'pwsh', disposeGraceMs: 10 })
    expect(resolved.shellPath).toBe(resolvePwshPath())
    expect(resolved.shellArgs).toEqual(DEFAULT_PWSH_ARGS)
  })

  it('keeps an explicit executable and argument list over the dialect defaults', () => {
    const resolved = resolveConfig({
      providerType: 'shell',
      shellDialect: 'pwsh',
      shellPath: '/custom/pwsh',
      shellArgs: ['-NoProfile'],
      disposeGraceMs: 10,
    })
    expect(resolved.shellPath).toBe('/custom/pwsh')
    expect(resolved.shellArgs).toEqual(['-NoProfile'])
  })

  it('treats an empty executable or argument list as the dialect default', () => {
    const resolved = resolveConfig({
      providerType: 'shell',
      shellDialect: 'bash',
      shellPath: '',
      shellArgs: [],
      disposeGraceMs: 10,
    })
    expect(resolved.shellPath).toBe(DEFAULT_BASH_SHELL)
    expect(resolved.shellArgs).toEqual(DEFAULT_BASH_ARGS)
  })
})

describe('validateConfig', () => {
  it('accepts a resolved configuration for either dialect', () => {
    expect(() => {
      validateConfig(resolveConfig({ providerType: 'shell', disposeGraceMs: 10 }))
    }).not.toThrow()
    expect(() => {
      validateConfig(resolveConfig({ providerType: 'shell', shellDialect: 'pwsh', disposeGraceMs: 10 }))
    }).not.toThrow()
  })

  it('rejects an empty provider type', () => {
    expect(() => {
      validateConfig(resolveConfig({ providerType: '', disposeGraceMs: 10 }))
    }).toThrow('providerType must be non-empty')
  })

  it('rejects an empty effective shell path', () => {
    expect(() => {
      validateConfig({ providerType: 'shell', shellDialect: 'bash', shellPath: '', shellArgs: ['-i'], disposeGraceMs: 10 })
    }).toThrow('shellPath must be non-empty')
  })

  it('rejects a numeric field that is not a positive safe integer', () => {
    expect(() => {
      validateConfig(resolveConfig({ providerType: 'shell', disposeGraceMs: 0 }))
    }).toThrow('disposeGraceMs must be a positive safe integer')
    expect(() => {
      validateConfig(resolveConfig({ providerType: 'shell', disposeGraceMs: 1.5 }))
    }).toThrow('disposeGraceMs must be a positive safe integer')
  })
})
