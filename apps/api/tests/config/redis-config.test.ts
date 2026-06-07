import { describe, it, expect } from 'vitest'
import { REDIS } from '../../src/config'

describe('REDIS config', () => {
  it('defaults to a redis:// URL when REDIS_URL is unset', () => {
    expect(REDIS.URL).toMatch(/^redis:\/\//)
  })
})
