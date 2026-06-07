// src/services/validationService.ts - Email Validation (Syntax, MX, Disposable, Suppression)

import { promises as dns } from 'dns';
import { queueEngine } from './queueEngine';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  email: string;
  valid: boolean;
  score: number;
  checks: {
    syntax: boolean;
    mx: boolean;
    disposable: boolean;
    suppressed: boolean;
  };
  reason?: string;
}

export interface BulkValidationResult {
  total: number;
  valid: number;
  invalid: number;
  risky: number;
  suppressed: number;
  results: ValidationResult[];
}

// ============================================================================
// Disposable Domains (bundled list — top 500)
// ============================================================================

const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com', 'throwaway.email', 'guerrillamail.com', 'guerrillamailblock.com',
  'mailinator.com', 'yopmail.com', 'sharklasers.com', 'grr.la', 'guerrillamail.info',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.de', 'mailnesia.com',
  'dispostable.com', 'tempail.com', 'temp-mail.org', 'temp-mail.io', 'fakeinbox.com',
  'mailcatch.com', 'trashmail.com', 'trashmail.me', 'trashmail.net', 'trashymail.com',
  'getnada.com', 'maildrop.cc', '10minutemail.com', '20minutemail.com',
  'harakirimail.com', 'discard.email', 'tempmailer.com', 'inboxkitten.com',
  'mohmal.com', 'crazymailing.com', 'mailsac.com', 'emailondeck.com',
  'throwaway.email', 'tmail.ws', 'temp-mail.de', 'mintemail.com',
  'mytemp.email', 'tempr.email', 'burnermail.io', 'mailpoof.com',
  'spamgourmet.com', 'jetable.org', 'nospam.ze.tc', 'trashmail.org',
  'getairmail.com', 'filzmail.com', 'mailexpire.com', 'tempinbox.com',
  'mailnull.com', 'spamfree24.org', 'trash-mail.com', 'bugmenot.com',
  'devnullmail.com', 'dodgeit.com', 'dodgit.com', 'incognitomail.org',
  'mailforspam.com', 'mailfreeonline.com', 'mailzilla.com', 'nomail.xl.cx',
  'objectmail.com', 'proxymail.eu', 'rcpt.at', 'reallymymail.com',
  'recode.me', 'spaml.com', 'superrito.com', 'throwam.com',
  'tittbit.in', 'trashmail.at', 'wegwerfmail.de', 'wegwerfmail.net',
  'wh4f.org', 'yapped.net', 'yepmail.net', 'you-spam.com',
  'zehnminutenmail.de', 'zippymail.info', 'mailhazard.com', 'mailhazard.us',
  'mailtemp.info', 'mailtemp.net', 'tempmailaddress.com', 'tmpmail.net',
  'tmpmail.org', 'emailfake.com', 'emkei.cz', 'anonymbox.net',
  'courrieltemporaire.com', 'fleckens.hu', 'mailbox52.ga', 'generator.email',
  'guerrillamail.biz', 'koszmail.pl', 'trbvm.com', 'armyspy.com',
  'cuvox.de', 'dayrep.com', 'einrot.com', 'fleckens.hu', 'gustr.com',
  'jourrapide.com', 'rhyta.com', 'superrito.com', 'teleworm.us',
]);

// MX record cache (5 minute TTL)
const mxCache = new Map<string, { valid: boolean; expiry: number }>();

// ============================================================================
// Service
// ============================================================================

class ValidationService {
  /**
   * Validate email syntax (RFC 5322 simplified)
   */
  checkSyntax(email: string): boolean {
    if (!email || typeof email !== 'string') return false;
    // RFC 5322 simplified regex
    const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!re.test(email)) return false;

    // Additional checks
    const [local, domain] = email.split('@');
    if (!local || !domain) return false;
    if (local.length > 64) return false;
    if (domain.length > 253) return false;
    if (!domain.includes('.')) return false;
    const tld = domain.split('.').pop();
    if (!tld || tld.length < 2) return false;

    return true;
  }

  /**
   * Check if domain has MX records
   */
  async checkMX(domain: string): Promise<boolean> {
    // Check cache
    const cached = mxCache.get(domain);
    if (cached && cached.expiry > Date.now()) {
      return cached.valid;
    }

    try {
      const records = await dns.resolveMx(domain);
      const valid = records && records.length > 0;
      mxCache.set(domain, { valid, expiry: Date.now() + 5 * 60 * 1000 });
      return valid;
    } catch {
      mxCache.set(domain, { valid: false, expiry: Date.now() + 5 * 60 * 1000 });
      return false;
    }
  }

  /**
   * Check if email domain is a known disposable provider
   */
  checkDisposable(email: string): boolean {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return true; // No domain = disposable
    return DISPOSABLE_DOMAINS.has(domain);
  }

  /**
   * Check if email is suppressed for a user
   */
  async checkSuppressed(userId: string, email: string): Promise<boolean> {
    return queueEngine.isSuppressed(userId, email);
  }

  /**
   * Full validation of a single email
   */
  async validateEmail(email: string, userId?: string): Promise<ValidationResult> {
    const normalizedEmail = email.toLowerCase().trim();
    const domain = normalizedEmail.split('@')[1] || '';

    const syntax = this.checkSyntax(normalizedEmail);
    let mx = false;
    let disposable = false;
    let suppressed = false;

    if (syntax) {
      mx = await this.checkMX(domain);
      disposable = this.checkDisposable(normalizedEmail);
      if (userId) {
        suppressed = await this.checkSuppressed(userId, normalizedEmail);
      }
    }

    // Calculate score (0-100)
    let score = 0;
    if (syntax) score += 25;
    if (mx) score += 30;
    if (!disposable) score += 25;
    if (!suppressed) score += 20;

    const valid = syntax && mx && !disposable && !suppressed;

    let reason: string | undefined;
    if (!syntax) reason = 'Invalid email syntax';
    else if (!mx) reason = `No MX records for domain ${domain}`;
    else if (disposable) reason = 'Disposable email domain';
    else if (suppressed) reason = 'Email is on suppression list';

    return {
      email: normalizedEmail,
      valid,
      score,
      checks: { syntax, mx, disposable: !disposable, suppressed: !suppressed },
      reason,
    };
  }

  /**
   * Validate multiple emails
   */
  async validateBulk(emails: string[], userId?: string): Promise<BulkValidationResult> {
    const results: ValidationResult[] = [];
    let valid = 0, invalid = 0, risky = 0, suppressed = 0;

    for (const email of emails) {
      const result = await this.validateEmail(email, userId);
      results.push(result);

      if (result.valid) {
        if (result.score < 70) risky++;
        else valid++;
      } else {
        if (!result.checks.suppressed) suppressed++;
        else invalid++;
      }
    }

    return { total: emails.length, valid, invalid, risky, suppressed, results };
  }
}

export const validationService = new ValidationService();
