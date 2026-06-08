// P5.1 net — storageService against a real S3 (MinIO). GATED behind RUN_STORAGE_IT=1
// (requires MinIO reachable on S3_ENDPOINT / localhost:9000). Default `bun test` skips it.
// Run with: RUN_STORAGE_IT=1 bunx vitest run tests/services/storageService.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), startup: vi.fn() } }))

import { storageService } from '../../src/services/storageService'

const RUN = !!process.env.RUN_STORAGE_IT

describe.skipIf(!RUN)('P5.1 — storageService (MinIO)', () => {
  beforeAll(async () => {
    await storageService.ensureBucket()
  }, 30_000)

  it('put → get round-trips bytes', async () => {
    const key = `test/p5-${Date.now()}.txt`
    const body = new TextEncoder().encode('hello dispatch')
    await storageService.put(key, body, 'text/plain')

    const got = await storageService.get(key)
    expect(got).not.toBeNull()
    expect(new TextDecoder().decode(got!)).toBe('hello dispatch')

    await storageService.delete(key)
  })

  it('get returns null for a missing key', async () => {
    expect(await storageService.get(`test/missing-${Date.now()}`)).toBeNull()
  })

  it('getSignedDownloadUrl yields a fetchable URL', async () => {
    const key = `test/signed-${Date.now()}.txt`
    await storageService.put(key, new TextEncoder().encode('signed-body'), 'text/plain')

    const url = await storageService.getSignedDownloadUrl(key, 60)
    expect(url).toMatch(/^https?:\/\//)
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('signed-body')

    await storageService.delete(key)
  })

  it('delete removes the object', async () => {
    const key = `test/del-${Date.now()}.txt`
    await storageService.put(key, new TextEncoder().encode('x'))
    await storageService.delete(key)
    expect(await storageService.get(key)).toBeNull()
  })
})
