// src/utils/id.ts - Secure ID generation using crypto.randomUUID()

/**
 * Generate a secure, unique ID with a prefix.
 * Uses crypto.randomUUID() instead of Date.now() + Math.random().
 */
export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`
}
