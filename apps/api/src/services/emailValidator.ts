// src/services/emailValidator.ts - Email Validation (Syntax + MX + Disposable)

import { logger } from '../utils/logger'

export interface ValidationResult {
  valid: boolean
  score: number // 0-100
  issues: string[]
}

// Common disposable email domains
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
  'dispostable.com', 'mailnesia.com', 'trashmail.com', 'maildrop.cc',
  'fakeinbox.com', 'getnada.com', 'temp-mail.org', 'mohmal.com',
  'harakirimail.com', 'burpcollaborator.net', 'emailondeck.com',
  'tempail.com', 'binkmail.com', 'safetymail.info', '10minutemail.com',
  'minuteinbox.com', 'discard.email', 'mailsac.com', 'inboxkitten.com',
  'trashmail.me', 'trashmail.net', 'mailcatch.com', 'spamgourmet.com',
  'jetable.org', 'mytrashmail.com', 'mailexpire.com', 'meltmail.com',
  'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamail.de', 'guerrillamailblock.com', 'spam4.me', 'anonbox.net',
  'bugmenot.com', 'devnullmail.com', 'mailzilla.com', 'throwam.com',
])

// RFC 5321 email regex (simplified but accurate)
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

// Role-based emails (these often bounce or should not be marketed to)
const ROLE_PREFIXES = new Set([
  'abuse', 'admin', 'billing', 'compliance', 'devnull', 'dns', 'ftp',
  'hostmaster', 'info', 'inoc', 'ispfeedback', 'ispsupport', 'list',
  'maildaemon', 'mailer-daemon', 'mailerdaemon', 'marketing', 'noc',
  'no-reply', 'noreply', 'null', 'phish', 'phishing', 'postmaster',
  'privacy', 'registrar', 'root', 'sales', 'security', 'spam', 'support',
  'sysadmin', 'tech', 'undisclosed-recipients', 'unsubscribe', 'usenet',
  'uucp', 'webmaster', 'www',
])

class EmailValidator {
  /**
   * Validate an email address.
   * Returns score 0-100 and list of issues.
   */
  async validate(email: string): Promise<ValidationResult> {
    const issues: string[] = []
    let score = 100

    const normalizedEmail = email.toLowerCase().trim()

    // 1. Syntax check
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return { valid: false, score: 0, issues: ['Invalid email syntax'] }
    }

    const [localPart, domain] = normalizedEmail.split('@')

    // 2. Domain exists check
    if (!domain || domain.length < 3 || !domain.includes('.')) {
      return { valid: false, score: 0, issues: ['Invalid domain'] }
    }

    // 3. Disposable domain check
    if (DISPOSABLE_DOMAINS.has(domain)) {
      issues.push('Disposable email domain')
      score -= 60
    }

    // 4. Role-based check
    if (ROLE_PREFIXES.has(localPart)) {
      issues.push('Role-based email address')
      score -= 20
    }

    // 5. MX record check
    try {
      const hasMx = await this.checkMX(domain)
      if (!hasMx) {
        issues.push('No MX records found for domain')
        score -= 50
      }
    } catch {
      issues.push('Could not verify MX records')
      score -= 10
    }

    // 6. Suspicious patterns
    if (/\+/.test(localPart)) {
      issues.push('Contains + alias (may be temporary)')
      score -= 5
    }

    if (localPart.length > 64) {
      issues.push('Local part exceeds 64 characters')
      score -= 30
    }

    if (/^[0-9]+$/.test(localPart)) {
      issues.push('Numeric-only local part (likely auto-generated)')
      score -= 15
    }

    score = Math.max(0, score)
    return { valid: score >= 40, score, issues }
  }

  /**
   * Quick syntax-only check (no network calls).
   */
  validateSyntax(email: string): boolean {
    return EMAIL_REGEX.test(email.toLowerCase().trim())
  }

  /**
   * Check if domain has MX records using dns/promises.
   */
  private async checkMX(domain: string): Promise<boolean> {
    try {
      const dns = await import('dns/promises')
      const records = await dns.resolveMx(domain)
      return records.length > 0
    } catch (err: any) {
      // ENODATA or ENOTFOUND means no MX records
      if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
        return false
      }
      // Other DNS errors — don't penalize
      throw err
    }
  }
}

export const emailValidator = new EmailValidator()
