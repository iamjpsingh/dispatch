// P3 — AES-256-GCM crypto core. Authenticated encryption with a versioned, key-id'd
// envelope and key rotation via FALLBACK_ENCRYPTION_KEY.
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { encrypt, decrypt, isEncrypted, assertEncryptionKey, __resetKeysForTest } from '../../src/utils/crypto'

const KEY_A = Buffer.alloc(32, 1).toString('base64')
const KEY_B = Buffer.alloc(32, 2).toString('base64')

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY_A
  delete process.env.FALLBACK_ENCRYPTION_KEY
  __resetKeysForTest()
})

afterAll(() => {
  // leave a valid key for any other suites running in this worker
  process.env.ENCRYPTION_KEY = KEY_A
  delete process.env.FALLBACK_ENCRYPTION_KEY
  __resetKeysForTest()
})

describe('P3 — crypto (AES-256-GCM)', () => {
  it('round-trips plaintext', async () => {
    const secret = 'super-secret-token-123'
    const env = await encrypt(secret)
    expect(await decrypt(env)).toBe(secret)
  })

  it('produces a versioned, key-id envelope', async () => {
    const env = await encrypt('x')
    expect(env).toMatch(/^v1:[0-9a-f]{8}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/)
    expect(isEncrypted(env)).toBe(true)
  })

  it('uses a unique IV per call (same plaintext → different ciphertext)', async () => {
    const a = await encrypt('same')
    const b = await encrypt('same')
    expect(a).not.toBe(b)
    expect(await decrypt(a)).toBe('same')
    expect(await decrypt(b)).toBe('same')
  })

  it('fails closed on tampered ciphertext (auth tag)', async () => {
    const env = await encrypt('tamper-me')
    const parts = env.split(':')
    // flip a char in the ciphertext segment
    const ct = parts[3]
    parts[3] = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)
    await expect(decrypt(parts.join(':'))).rejects.toThrow()
  })

  it('isEncrypted distinguishes envelopes from plaintext', () => {
    expect(isEncrypted('plain text value')).toBe(false)
    expect(isEncrypted('')).toBe(false)
    expect(isEncrypted('v1:deadbeef:aaaa:bbbb')).toBe(true)
  })

  it('decrypts old envelopes after key rotation via FALLBACK_ENCRYPTION_KEY', async () => {
    const env = await encrypt('rotate-me') // encrypted with KEY_A
    // rotate: KEY_B becomes primary, KEY_A becomes fallback
    process.env.ENCRYPTION_KEY = KEY_B
    process.env.FALLBACK_ENCRYPTION_KEY = KEY_A
    __resetKeysForTest()
    expect(await decrypt(env)).toBe('rotate-me') // old envelope still decrypts via fallback
    // new writes use KEY_B
    const fresh = await encrypt('new')
    expect(await decrypt(fresh)).toBe('new')
  })

  it('assertEncryptionKey throws when the key is missing or wrong length', () => {
    delete process.env.ENCRYPTION_KEY
    expect(() => assertEncryptionKey()).toThrow()
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64') // too short
    expect(() => assertEncryptionKey()).toThrow()
    process.env.ENCRYPTION_KEY = KEY_A
    expect(() => assertEncryptionKey()).not.toThrow()
  })
})
