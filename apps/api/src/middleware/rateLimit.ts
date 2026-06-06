// src/middleware/rateLimit.ts - In-memory rate limiter (no deps)

import type { Context, Next } from 'hono'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const stores = new Map<string, Map<string, RateLimitEntry>>()

function getStore(name: string): Map<string, RateLimitEntry> {
  if (!stores.has(name)) {
    stores.set(name, new Map())
  }
  return stores.get(name)!
}

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const store of stores.values()) {
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetAt) store.delete(key)
    }
  }
}, 5 * 60 * 1000)

/**
 * Create a rate limit middleware
 * @param name - Store name (e.g. 'auth', 'send')
 * @param maxRequests - Max requests per window
 * @param windowMs - Time window in milliseconds
 */
export function rateLimit(name: string, maxRequests: number, windowMs: number) {
  const store = getStore(name)

  return async (c: Context, next: Next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown'

    const now = Date.now()
    let entry = store.get(ip)

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(ip, entry)
    }

    entry.count++

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - entry.count)
    c.header('X-RateLimit-Limit', String(maxRequests))
    c.header('X-RateLimit-Remaining', String(remaining))
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      c.header('Retry-After', String(retryAfter))
      return c.json({
        success: false,
        message: 'Too many requests. Please try again later.',
      }, 429)
    }

    return next()
  }
}

// Pre-configured rate limiters
export const authRateLimit = rateLimit('auth', 10, 15 * 60 * 1000)        // 10 per 15 min
export const sendRateLimit = rateLimit('send', 30, 60 * 1000)             // 30 per minute
export const apiRateLimit = rateLimit('api', 100, 60 * 1000)              // 100 per minute
export const uploadRateLimit = rateLimit('upload', 10, 60 * 1000)         // 10 per minute
