import { describe, it, expect } from 'vitest'
import app, { startBackgroundWorkers, stopBackgroundWorkers } from '../src/app'

describe('app boot surface', () => {
  it('default export exposes fetch (Bun server object)', () => {
    expect(typeof app.fetch).toBe('function')
  })
  it('exposes worker lifecycle without starting it at import', () => {
    expect(typeof startBackgroundWorkers).toBe('function')
    expect(typeof stopBackgroundWorkers).toBe('function')
  })
})
