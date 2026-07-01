import { describe, it, expect, beforeAll } from 'vitest'
import { hashEmail, assertSuppressionSecret } from '../../src/utils/suppressionHash'

describe('hashEmail', () => {
  beforeAll(() => { process.env.SUPPRESSION_HASH_SECRET = 'test-suppression-secret' })

  it('is deterministic and case/space-insensitive', () => {
    expect(hashEmail('A@B.com')).toBe(hashEmail('  a@b.com '))
  })
  it('differs for different emails and is not the plaintext', () => {
    const h = hashEmail('a@b.com')
    expect(h).not.toBe(hashEmail('c@d.com'))
    expect(h).not.toContain('a@b.com')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
  it('assertSuppressionSecret throws when the secret is unset (boot fail-fast)', () => {
    const saved = process.env.SUPPRESSION_HASH_SECRET
    delete process.env.SUPPRESSION_HASH_SECRET
    expect(() => assertSuppressionSecret()).toThrow()
    process.env.SUPPRESSION_HASH_SECRET = saved
    expect(() => assertSuppressionSecret()).not.toThrow()
  })
})
