// src/utils/crypto.ts — AES-256-GCM authenticated encryption for secrets at rest (P3).
//
// Envelope (string): `v1:<keyId>:<base64 iv>:<base64 ciphertext+tag>`
//   - keyId = first 8 hex of SHA-256(rawKey), so decrypt() knows which key to try first.
//   - random 12-byte IV per encryption; GCM 16-byte auth tag (appended to ciphertext).
// Keys (base64, 32 raw bytes) from env:
//   - ENCRYPTION_KEY            primary, required; used for all new encryptions.
//   - FALLBACK_ENCRYPTION_KEY   optional, decrypt-only, for zero-downtime rotation.
// Keys are loaded lazily + cached (so tests can set env before first use).

interface KeyMaterial {
  keyId: string
  cryptoKey: CryptoKey
}

let primaryCache: Promise<KeyMaterial> | null = null
let fallbackCache: Promise<KeyMaterial | null> | null = null

function rawKey(envValue: string): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(envValue, 'base64'))
  if (bytes.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes encoded as base64')
  }
  return bytes
}

async function loadKey(raw: Uint8Array): Promise<KeyMaterial> {
  const digest = await crypto.subtle.digest('SHA-256', raw as BufferSource)
  const keyId = Buffer.from(digest).toString('hex').slice(0, 8)
  const cryptoKey = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  return { keyId, cryptoKey }
}

function getPrimary(): Promise<KeyMaterial> {
  if (!primaryCache) {
    const env = process.env.ENCRYPTION_KEY
    if (!env) throw new Error('ENCRYPTION_KEY is not set')
    primaryCache = loadKey(rawKey(env))
  }
  return primaryCache
}

function getFallback(): Promise<KeyMaterial | null> {
  if (!fallbackCache) {
    const env = process.env.FALLBACK_ENCRYPTION_KEY
    fallbackCache = env ? loadKey(rawKey(env)) : Promise.resolve(null)
  }
  return fallbackCache
}

/** Encrypt a UTF-8 string into a self-describing envelope using the primary key. */
export async function encrypt(plaintext: string): Promise<string> {
  const { keyId, cryptoKey } = await getPrimary()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(plaintext))
  return `v1:${keyId}:${Buffer.from(iv).toString('base64')}:${Buffer.from(ct).toString('base64')}`
}

/** Decrypt an envelope. Tries the key whose keyId matches, then primary, then fallback. */
export async function decrypt(value: string): Promise<string> {
  const parts = value.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid ciphertext envelope')
  }
  const [, keyId, ivB64, ctB64] = parts
  const iv = new Uint8Array(Buffer.from(ivB64, 'base64'))
  const ct = new Uint8Array(Buffer.from(ctB64, 'base64'))

  const keys: KeyMaterial[] = [await getPrimary()]
  const fb = await getFallback()
  if (fb) keys.push(fb)
  // Try the matching keyId first, then the rest.
  keys.sort((a, b) => (a.keyId === keyId ? -1 : b.keyId === keyId ? 1 : 0))

  let lastErr: unknown
  for (const k of keys) {
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k.cryptoKey, ct)
      return new TextDecoder().decode(pt)
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(`Decryption failed: ${lastErr instanceof Error ? lastErr.message : 'no matching key / tampered'}`)
}

/** True if the value is a crypto envelope (used to decrypt-or-passthrough legacy plaintext). */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && /^v1:[0-9a-f]{8}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(value)
}

/** Decrypt an envelope, or return the value unchanged if it isn't one (legacy plaintext). */
export async function decryptOrPlain(value: string): Promise<string> {
  return isEncrypted(value) ? decrypt(value) : value
}

/** Fail-fast key validation for boot. Throws if ENCRYPTION_KEY is missing or wrong length. */
export function assertEncryptionKey(): void {
  const env = process.env.ENCRYPTION_KEY
  if (!env) throw new Error('ENCRYPTION_KEY is required to start (32 bytes, base64)')
  rawKey(env)
  if (process.env.FALLBACK_ENCRYPTION_KEY) rawKey(process.env.FALLBACK_ENCRYPTION_KEY)
}

/** TEST ONLY — clear the cached keys so a test can swap ENCRYPTION_KEY / FALLBACK. */
export function __resetKeysForTest(): void {
  primaryCache = null
  fallbackCache = null
}
