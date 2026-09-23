/**
 * The client package's Node half. It exists so the row resolves in a host
 * composition; the browser half is what the Web Loader actually loads from
 * `exports["./client"]`.
 */

import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-scheduler node half', () => {
  it('exposes an inert apply so the host composition accepts the row', () => {
    expect(() => { apply() }).not.toThrow()
  })
})
