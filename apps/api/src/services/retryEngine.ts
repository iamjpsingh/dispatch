// src/services/retryEngine.ts - SMTP Error Classification + Exponential Backoff

export type ErrorType = 'rate_limit' | 'temporary' | 'permanent' | 'network';

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const RETRY_CONFIGS: Record<ErrorType, RetryConfig> = {
  rate_limit: { maxRetries: 5, baseDelayMs: 60_000, maxDelayMs: 300_000 },   // 1-5 min
  temporary:  { maxRetries: 3, baseDelayMs: 30_000, maxDelayMs: 120_000 },   // 30s-2 min
  permanent:  { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },              // No retry
  network:    { maxRetries: 5, baseDelayMs: 5_000, maxDelayMs: 60_000 },     // 5s-1 min
};

// SMTP response code ranges
const PERMANENT_CODES = [
  421, 450, 451, 452, // Occasionally temp, but we check message too
  500, 501, 502, 503, 504, 510, 511, 512, 513, 523, 530, 541, 550, 551, 552, 553, 554, 555,
];

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /too many/i,
  /throttl/i,
  /try again later/i,
  /exceeded.*limit/i,
  /quota exceeded/i,
  /4\.7\.1/,          // Gmail rate limit
  /connection rate/i,
];

const PERMANENT_PATTERNS = [
  /user unknown/i,
  /mailbox not found/i,
  /no such user/i,
  /does not exist/i,
  /invalid recipient/i,
  /address rejected/i,
  /relay.*denied/i,
  /blocked/i,
  /blacklisted/i,
  /spam/i,
  /rejected/i,
  /5\.1\.1/,          // Bad destination mailbox
  /5\.1\.2/,          // Bad destination system
  /5\.7\.1/,          // Delivery not authorized
];

const TEMPORARY_PATTERNS = [
  /try again/i,
  /service unavailable/i,
  /temporarily/i,
  /greylisted/i,
  /4\.2\.1/,          // Mailbox disabled
  /4\.7\.0/,          // IP connection limit
];

const NETWORK_PATTERNS = [
  /ECONNREFUSED/,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /ENOTFOUND/,
  /EHOSTUNREACH/,
  /socket hang up/i,
  /connection.*closed/i,
  /getaddrinfo/i,
];

class RetryEngine {
  /**
   * Classify an SMTP error into a category
   */
  classifyError(error: Error | string): ErrorType {
    const message = typeof error === 'string' ? error : error.message;
    const code = this.extractSmtpCode(message);

    // Check network errors first (they have specific error codes)
    for (const pattern of NETWORK_PATTERNS) {
      if (pattern.test(message)) return 'network';
    }

    // Check rate limiting
    for (const pattern of RATE_LIMIT_PATTERNS) {
      if (pattern.test(message)) return 'rate_limit';
    }

    // Check permanent failures
    for (const pattern of PERMANENT_PATTERNS) {
      if (pattern.test(message)) return 'permanent';
    }

    // Check by SMTP code
    if (code) {
      if (code >= 500 && code <= 599) return 'permanent';
      if (code >= 400 && code <= 499) return 'temporary';
    }

    // Check temporary patterns
    for (const pattern of TEMPORARY_PATTERNS) {
      if (pattern.test(message)) return 'temporary';
    }

    // Default: treat unknown errors as temporary (safe to retry)
    return 'temporary';
  }

  /**
   * Calculate retry delay with exponential backoff + jitter
   */
  getRetryDelay(attempt: number, errorType: ErrorType): number {
    const config = RETRY_CONFIGS[errorType];
    if (config.maxRetries === 0) return 0;

    // Exponential backoff: base * 2^attempt
    const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

    // Add jitter (±25%)
    const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);

    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Check if we should retry based on error type and attempt count
   */
  shouldRetry(errorType: ErrorType, attempts: number): boolean {
    return attempts < RETRY_CONFIGS[errorType].maxRetries;
  }

  /**
   * Get max retries for an error type
   */
  getMaxRetries(errorType: ErrorType): number {
    return RETRY_CONFIGS[errorType].maxRetries;
  }

  /**
   * Extract SMTP response code from error message
   */
  private extractSmtpCode(message: string): number | null {
    const match = message.match(/\b([2-5]\d{2})\b/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Get a human-readable description of the error classification
   */
  describeError(errorType: ErrorType): string {
    switch (errorType) {
      case 'rate_limit':
        return 'Rate limited by mail server — will retry with longer delays';
      case 'temporary':
        return 'Temporary server error — will retry with backoff';
      case 'permanent':
        return 'Permanent delivery failure — moved to dead letter queue';
      case 'network':
        return 'Network connectivity issue — will retry';
    }
  }
}

export const retryEngine = new RetryEngine();
