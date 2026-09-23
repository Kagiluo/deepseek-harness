/**
 * Scheduled-task copy: the two dictionaries stay key-identical, and the
 * namespace the browser half spells again is pinned to the Host's declaration.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SCHEDULER_SETTINGS_NS } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

describe('scheduler dictionaries', () => {
  it('keeps the Chinese dictionary key-identical to the English source of truth', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('leaves no copy empty', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en.${key}`).not.toBe('')
    }
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim(), `zh.${key}`).not.toBe('')
    }
  })

  it('owns one dictionary namespace', () => {
    expect(NS).toBe('settings.scheduler')
  })

  it('carries the placeholder its render site substitutes', () => {
    expect(en.saveFailed).toContain('{message}')
    expect(zh.saveFailed).toContain('{message}')
    expect(en.taskHeading).toContain('{number}')
    expect(zh.taskHeading).toContain('{number}')
  })

  it('names every weekday exactly once', () => {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      expect(en[`weekday.${String(day)}` as keyof typeof en]).toBeDefined()
    }
  })
})

describe('settings namespace spelling', () => {
  it('matches the Host declaration the page is bound to', () => {
    // A cross-plugin value import is rejected by the bundle purity gate, so the
    // browser half spells the namespace again; this pins the two together.
    const hostSettings = readFileSync(
      fileURLToPath(new URL('../../../scheduler/scheduler/src/settings.ts', import.meta.url)),
      'utf8',
    )
    expect(hostSettings).toContain(`export const SCHEDULER_SETTINGS_NAMESPACE = '${SCHEDULER_SETTINGS_NS}'`)
  })
})
