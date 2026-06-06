/**
 * Input Validation Utilities
 * Centralized validation for all endpoints
 */

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Canonical email validation regex
 * Used across the entire application - do not duplicate
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  return emailRegex.test(email.trim()) && email.length <= 254
}

/**
 * Validate required fields
 */
export function validateRequired(data: Record<string, unknown>, fields: string[]): ValidationResult {
  const errors: string[] = []

  for (const field of fields) {
    const value = data[field]
    if (value === undefined || value === null || value === '') {
      errors.push(`${field} is required`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate SMTP configuration
 */
export function validateSMTPConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = []

  if (!config.host) errors.push('SMTP host is required')
  if (!config.user) errors.push('SMTP username is required')
  if (!config.pass) errors.push('SMTP password is required')
  if (!config.fromEmail && !config.from_email) errors.push('From email is required')

  if (config.port && (typeof config.port !== 'number' || config.port < 1 || config.port > 65535)) {
    errors.push('Invalid port number')
  }

  const email = (config.fromEmail || config.from_email) as string
  if (email && !isValidEmail(email)) {
    errors.push('Invalid from email format')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate OAuth configuration
 */
export function validateOAuthConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = []

  if (!config.oauth_email) errors.push('OAuth email is required')
  if (!config.oauth_access_token) errors.push('OAuth access token is required')

  return { valid: errors.length === 0, errors }
}

/**
 * Validate email job data
 */
export function validateEmailJob(data: Record<string, unknown>): ValidationResult {
  const errors: string[] = []

  if (!data.subject || (data.subject as string).trim() === '') {
    errors.push('Subject is required')
  }

  if (!data.htmlContent || (data.htmlContent as string).trim() === '' || data.htmlContent === '<p><br></p>') {
    errors.push('Email content is required')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Canonical password validation
 * Minimum 8 chars, at least one uppercase, one lowercase, one number
 */
export function validatePassword(password: string): { valid: boolean; message: string } {
  if (!password || password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters' }
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' }
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' }
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' }
  }
  return { valid: true, message: 'Password is valid' }
}

/**
 * Sanitize string input
 */
export function sanitize(input: string): string {
  return input.trim().replace(/[<>]/g, '')
}

/**
 * Parse integer with default
 */
export function parseIntSafe(value: string | null | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? defaultValue : parsed
}
