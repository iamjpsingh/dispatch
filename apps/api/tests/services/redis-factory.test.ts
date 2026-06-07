import { describe, it, expect } from 'vitest'
import { createRedisConnection } from '../../src/services/queue/redis'

describe('createRedisConnection', () => {
  it('parses the URL and sets BullMQ-required options', () => {
    const conn = createRedisConnection('redis://localhost:6379')
    expect(conn.options.host).toBe('localhost')
    expect(conn.options.port).toBe(6379)
    expect(conn.options.maxRetriesPerRequest).toBeNull()
    conn.disconnect()
  })
})
