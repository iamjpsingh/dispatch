import { describe, it, expect, vi } from 'vitest'
import { retryEngine } from '../../src/services/retryEngine'

// ============================================================================
// Error Classification
// ============================================================================

describe('RetryEngine - classifyError', () => {
  // --- Network errors ---
  it('classifies ECONNREFUSED as network', () => {
    expect(retryEngine.classifyError('connect ECONNREFUSED 127.0.0.1:587')).toBe('network')
  })

  it('classifies ECONNRESET as network', () => {
    expect(retryEngine.classifyError(new Error('read ECONNRESET'))).toBe('network')
  })

  it('classifies ETIMEDOUT as network', () => {
    expect(retryEngine.classifyError('connect ETIMEDOUT 10.0.0.1:25')).toBe('network')
  })

  it('classifies ENOTFOUND as network', () => {
    expect(retryEngine.classifyError('getaddrinfo ENOTFOUND smtp.example.com')).toBe('network')
  })

  it('classifies EHOSTUNREACH as network', () => {
    expect(retryEngine.classifyError('connect EHOSTUNREACH 10.0.0.1:25')).toBe('network')
  })

  it('classifies socket hang up as network', () => {
    expect(retryEngine.classifyError('socket hang up')).toBe('network')
  })

  it('classifies connection closed as network', () => {
    expect(retryEngine.classifyError('connection unexpectedly closed')).toBe('network')
  })

  it('classifies getaddrinfo as network', () => {
    expect(retryEngine.classifyError('getaddrinfo failed for host')).toBe('network')
  })

  // --- Rate limit errors ---
  it('classifies "rate limit" as rate_limit', () => {
    expect(retryEngine.classifyError('421 rate limit exceeded')).toBe('rate_limit')
  })

  it('classifies "too many" as rate_limit', () => {
    expect(retryEngine.classifyError('Too many connections from your IP')).toBe('rate_limit')
  })

  it('classifies "throttled" as rate_limit', () => {
    expect(retryEngine.classifyError('Message throttled by server')).toBe('rate_limit')
  })

  it('classifies "try again later" as rate_limit', () => {
    expect(retryEngine.classifyError('421 Try again later')).toBe('rate_limit')
  })

  it('classifies "exceeded limit" as rate_limit', () => {
    expect(retryEngine.classifyError('You have exceeded your daily limit')).toBe('rate_limit')
  })

  it('classifies "quota exceeded" as rate_limit', () => {
    expect(retryEngine.classifyError('550 Quota exceeded for user')).toBe('rate_limit')
  })

  it('classifies Gmail rate limit code 4.7.1 as rate_limit', () => {
    expect(retryEngine.classifyError('421 4.7.1 Temporarily rejected')).toBe('rate_limit')
  })

  it('classifies "connection rate" as rate_limit', () => {
    expect(retryEngine.classifyError('Connection rate limit exceeded')).toBe('rate_limit')
  })

  // --- Permanent errors ---
  it('classifies "user unknown" as permanent', () => {
    expect(retryEngine.classifyError('550 User unknown')).toBe('permanent')
  })

  it('classifies "mailbox not found" as permanent', () => {
    expect(retryEngine.classifyError('550 Mailbox not found')).toBe('permanent')
  })

  it('classifies "no such user" as permanent', () => {
    expect(retryEngine.classifyError('550 No such user')).toBe('permanent')
  })

  it('classifies "does not exist" as permanent', () => {
    expect(retryEngine.classifyError('550 Recipient does not exist')).toBe('permanent')
  })

  it('classifies "invalid recipient" as permanent', () => {
    expect(retryEngine.classifyError('550 Invalid recipient')).toBe('permanent')
  })

  it('classifies "address rejected" as permanent', () => {
    expect(retryEngine.classifyError('550 Address rejected')).toBe('permanent')
  })

  it('classifies "relay denied" as permanent', () => {
    expect(retryEngine.classifyError('550 Relay access denied')).toBe('permanent')
  })

  it('classifies "blocked" as permanent', () => {
    expect(retryEngine.classifyError('550 Blocked by policy')).toBe('permanent')
  })

  it('classifies "blacklisted" as permanent', () => {
    expect(retryEngine.classifyError('550 Your IP is blacklisted')).toBe('permanent')
  })

  it('classifies "spam" as permanent', () => {
    expect(retryEngine.classifyError('550 Message identified as spam')).toBe('permanent')
  })

  it('classifies "rejected" as permanent', () => {
    expect(retryEngine.classifyError('550 Message rejected')).toBe('permanent')
  })

  it('classifies SMTP code 5.1.1 as permanent', () => {
    expect(retryEngine.classifyError('550 5.1.1 Bad destination mailbox')).toBe('permanent')
  })

  it('classifies SMTP code 5.1.2 as permanent', () => {
    expect(retryEngine.classifyError('550 5.1.2 Bad destination system')).toBe('permanent')
  })

  it('classifies SMTP code 5.7.1 as permanent', () => {
    expect(retryEngine.classifyError('550 5.7.1 Delivery not authorized')).toBe('permanent')
  })

  // --- SMTP code-based classification ---
  it('classifies 500-series SMTP code as permanent', () => {
    expect(retryEngine.classifyError('550 mailbox unavailable')).toBe('permanent')
  })

  it('classifies 400-series SMTP code as temporary (when no pattern matches)', () => {
    expect(retryEngine.classifyError('450 Requested action not taken')).toBe('temporary')
  })

  // --- Temporary errors ---
  it('classifies "service unavailable" as temporary', () => {
    expect(retryEngine.classifyError('Service unavailable, please retry')).toBe('temporary')
  })

  it('classifies "temporarily" as temporary', () => {
    expect(retryEngine.classifyError('Temporarily deferred')).toBe('temporary')
  })

  it('classifies "greylisted" as temporary', () => {
    expect(retryEngine.classifyError('Greylisted, please retry in 5 minutes')).toBe('temporary')
  })

  it('classifies SMTP code 4.2.1 as temporary', () => {
    expect(retryEngine.classifyError('452 4.2.1 Mailbox disabled')).toBe('temporary')
  })

  it('classifies SMTP code 4.7.0 as temporary', () => {
    expect(retryEngine.classifyError('421 4.7.0 IP connection limit exceeded')).toBe('temporary')
  })

  // --- Default / Unknown ---
  it('classifies unknown error as temporary (safe default)', () => {
    expect(retryEngine.classifyError('Something went completely wrong')).toBe('temporary')
  })

  it('handles empty string as temporary', () => {
    expect(retryEngine.classifyError('')).toBe('temporary')
  })

  it('accepts Error objects', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:25')
    expect(retryEngine.classifyError(err)).toBe('network')
  })
})

// ============================================================================
// Retry Delay Calculation
// ============================================================================

describe('RetryEngine - getRetryDelay', () => {
  it('returns 0 delay for permanent errors', () => {
    expect(retryEngine.getRetryDelay(0, 'permanent')).toBe(0)
    expect(retryEngine.getRetryDelay(3, 'permanent')).toBe(0)
  })

  it('returns positive delay for network errors', () => {
    const delay = retryEngine.getRetryDelay(0, 'network')
    // base = 5000, attempt 0: 5000 * 2^0 = 5000, ±25% jitter => 3750..6250
    expect(delay).toBeGreaterThanOrEqual(3750)
    expect(delay).toBeLessThanOrEqual(6250)
  })

  it('increases delay exponentially', () => {
    // Collect multiple samples to average out jitter
    const delays0: number[] = []
    const delays2: number[] = []
    for (let i = 0; i < 20; i++) {
      delays0.push(retryEngine.getRetryDelay(0, 'network'))
      delays2.push(retryEngine.getRetryDelay(2, 'network'))
    }
    const avg0 = delays0.reduce((a, b) => a + b) / delays0.length
    const avg2 = delays2.reduce((a, b) => a + b) / delays2.length
    // attempt 2 should be ~4x attempt 0 (2^2)
    expect(avg2).toBeGreaterThan(avg0 * 2)
  })

  it('caps delay at maxDelayMs for rate_limit', () => {
    // rate_limit: baseDelay=60000, maxDelay=300000
    // attempt 10: 60000 * 2^10 = 61440000 → capped at 300000
    const delay = retryEngine.getRetryDelay(10, 'rate_limit')
    // max=300000, ±25% jitter => 225000..375000
    expect(delay).toBeLessThanOrEqual(375000)
    expect(delay).toBeGreaterThanOrEqual(225000)
  })

  it('caps delay at maxDelayMs for temporary', () => {
    // temporary: baseDelay=30000, maxDelay=120000
    const delay = retryEngine.getRetryDelay(10, 'temporary')
    expect(delay).toBeLessThanOrEqual(150000)
    expect(delay).toBeGreaterThanOrEqual(90000)
  })

  it('caps delay at maxDelayMs for network', () => {
    // network: baseDelay=5000, maxDelay=60000
    const delay = retryEngine.getRetryDelay(20, 'network')
    expect(delay).toBeLessThanOrEqual(75000)
    expect(delay).toBeGreaterThanOrEqual(45000)
  })

  it('returns integer (floored) delay', () => {
    const delay = retryEngine.getRetryDelay(1, 'temporary')
    expect(Number.isInteger(delay)).toBe(true)
  })
})

// ============================================================================
// shouldRetry
// ============================================================================

describe('RetryEngine - shouldRetry', () => {
  it('never retries permanent errors', () => {
    expect(retryEngine.shouldRetry('permanent', 0)).toBe(false)
  })

  it('retries network errors up to 5 times', () => {
    expect(retryEngine.shouldRetry('network', 0)).toBe(true)
    expect(retryEngine.shouldRetry('network', 4)).toBe(true)
    expect(retryEngine.shouldRetry('network', 5)).toBe(false)
  })

  it('retries rate_limit errors up to 5 times', () => {
    expect(retryEngine.shouldRetry('rate_limit', 0)).toBe(true)
    expect(retryEngine.shouldRetry('rate_limit', 4)).toBe(true)
    expect(retryEngine.shouldRetry('rate_limit', 5)).toBe(false)
  })

  it('retries temporary errors up to 3 times', () => {
    expect(retryEngine.shouldRetry('temporary', 0)).toBe(true)
    expect(retryEngine.shouldRetry('temporary', 2)).toBe(true)
    expect(retryEngine.shouldRetry('temporary', 3)).toBe(false)
  })
})

// ============================================================================
// getMaxRetries
// ============================================================================

describe('RetryEngine - getMaxRetries', () => {
  it('returns 0 for permanent', () => {
    expect(retryEngine.getMaxRetries('permanent')).toBe(0)
  })

  it('returns 5 for rate_limit', () => {
    expect(retryEngine.getMaxRetries('rate_limit')).toBe(5)
  })

  it('returns 3 for temporary', () => {
    expect(retryEngine.getMaxRetries('temporary')).toBe(3)
  })

  it('returns 5 for network', () => {
    expect(retryEngine.getMaxRetries('network')).toBe(5)
  })
})

// ============================================================================
// describeError
// ============================================================================

describe('RetryEngine - describeError', () => {
  it('describes rate_limit', () => {
    const desc = retryEngine.describeError('rate_limit')
    expect(desc).toContain('Rate limited')
    expect(desc).toContain('retry')
  })

  it('describes temporary', () => {
    const desc = retryEngine.describeError('temporary')
    expect(desc).toContain('Temporary')
    expect(desc).toContain('retry')
  })

  it('describes permanent', () => {
    const desc = retryEngine.describeError('permanent')
    expect(desc).toContain('Permanent')
    expect(desc).toContain('dead letter')
  })

  it('describes network', () => {
    const desc = retryEngine.describeError('network')
    expect(desc).toContain('Network')
    expect(desc).toContain('retry')
  })
})
