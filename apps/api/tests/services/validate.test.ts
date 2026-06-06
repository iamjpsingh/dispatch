import { describe, it, expect } from 'vitest'
import {
  isValidEmail,
  sanitizeString,
  sanitizeHtml,
  validatePassword,
  validateRequired,
} from '../../src/middleware/validate'

// ============================================================================
// isValidEmail
// ============================================================================

describe('isValidEmail', () => {
  it('accepts a standard email', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
  })

  it('accepts email with subdomains', () => {
    expect(isValidEmail('user@mail.example.co.uk')).toBe(true)
  })

  it('accepts email with plus addressing', () => {
    expect(isValidEmail('user+tag@example.com')).toBe(true)
  })

  it('accepts email with dots in local part', () => {
    expect(isValidEmail('first.last@example.com')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false)
  })

  it('rejects null/undefined coerced inputs', () => {
    expect(isValidEmail(null as unknown as string)).toBe(false)
    expect(isValidEmail(undefined as unknown as string)).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isValidEmail(123 as unknown as string)).toBe(false)
  })

  it('rejects email without @', () => {
    expect(isValidEmail('userexample.com')).toBe(false)
  })

  it('rejects email without domain', () => {
    expect(isValidEmail('user@')).toBe(false)
  })

  it('rejects email without local part', () => {
    expect(isValidEmail('@example.com')).toBe(false)
  })

  it('rejects email exceeding 254 characters', () => {
    const longLocal = 'a'.repeat(243)
    const email = `${longLocal}@example.com` // 255 chars
    expect(isValidEmail(email)).toBe(false)
  })

  it('accepts email at exactly 254 characters', () => {
    const longLocal = 'a'.repeat(242)
    const email = `${longLocal}@example.com` // 254 chars
    expect(email.length).toBe(254)
    expect(isValidEmail(email)).toBe(true)
  })
})

// ============================================================================
// sanitizeString
// ============================================================================

describe('sanitizeString', () => {
  it('returns the original string when no dangerous chars', () => {
    expect(sanitizeString('hello world')).toBe('hello world')
  })

  it('strips angle brackets (basic XSS prevention)', () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe('scriptalert("xss")/script')
  })

  it('strips only < and > characters', () => {
    expect(sanitizeString('a < b > c')).toBe('a  b  c')
  })

  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello')
  })

  it('truncates to default maxLength of 500', () => {
    const long = 'x'.repeat(600)
    expect(sanitizeString(long).length).toBe(500)
  })

  it('truncates to custom maxLength', () => {
    const long = 'x'.repeat(100)
    expect(sanitizeString(long, 50).length).toBe(50)
  })

  it('returns empty string for null/undefined', () => {
    expect(sanitizeString(null as unknown as string)).toBe('')
    expect(sanitizeString(undefined as unknown as string)).toBe('')
  })

  it('returns empty string for non-string input', () => {
    expect(sanitizeString(42 as unknown as string)).toBe('')
  })
})

// ============================================================================
// sanitizeHtml
// ============================================================================

describe('sanitizeHtml', () => {
  it('preserves normal HTML tags', () => {
    expect(sanitizeHtml('<p>Hello <b>world</b></p>')).toBe('<p>Hello <b>world</b></p>')
  })

  it('removes script tags and their content', () => {
    const input = '<p>Hi</p><script>alert("xss")</script><p>Bye</p>'
    expect(sanitizeHtml(input)).toBe('<p>Hi</p><p>Bye</p>')
  })

  it('removes script tags case-insensitively', () => {
    const input = '<SCRIPT>evil()</SCRIPT>'
    expect(sanitizeHtml(input)).toBe('')
  })

  it('neutralizes inline event handlers', () => {
    const input = '<img onerror="alert(1)" src="x">'
    expect(sanitizeHtml(input)).toContain('data-removed=')
    expect(sanitizeHtml(input)).not.toContain('onerror=')
  })

  it('neutralizes javascript: protocol', () => {
    const input = '<a href="javascript:alert(1)">click</a>'
    expect(sanitizeHtml(input)).not.toContain('javascript:')
    expect(sanitizeHtml(input)).toContain('removed:')
  })

  it('truncates to maxLength', () => {
    const html = '<p>' + 'x'.repeat(600000) + '</p>'
    expect(sanitizeHtml(html).length).toBeLessThanOrEqual(500000)
  })

  it('returns empty string for null/undefined', () => {
    expect(sanitizeHtml(null as unknown as string)).toBe('')
    expect(sanitizeHtml(undefined as unknown as string)).toBe('')
  })
})

// ============================================================================
// validatePassword
// ============================================================================

describe('validatePassword', () => {
  it('accepts a strong password', () => {
    const result = validatePassword('MyStr0ngPass')
    expect(result.valid).toBe(true)
    expect(result.message).toBe('Password is valid')
  })

  it('rejects empty password', () => {
    const result = validatePassword('')
    expect(result.valid).toBe(false)
    expect(result.message).toBe('Password must be at least 8 characters')
  })

  it('rejects null/undefined', () => {
    const r1 = validatePassword(null as unknown as string)
    expect(r1.valid).toBe(false)
    const r2 = validatePassword(undefined as unknown as string)
    expect(r2.valid).toBe(false)
  })

  it('rejects password shorter than 8 characters', () => {
    const result = validatePassword('Ab1cdef')
    expect(result.valid).toBe(false)
    expect(result.message).toBe('Password must be at least 8 characters')
  })

  it('rejects password without uppercase letter', () => {
    const result = validatePassword('alllowercase1')
    expect(result.valid).toBe(false)
    expect(result.message).toBe('Password must contain at least one uppercase letter')
  })

  it('rejects password without lowercase letter', () => {
    const result = validatePassword('ALLUPPERCASE1')
    expect(result.valid).toBe(false)
    expect(result.message).toBe('Password must contain at least one lowercase letter')
  })

  it('rejects password without a number', () => {
    const result = validatePassword('NoNumbersHere')
    expect(result.valid).toBe(false)
    expect(result.message).toBe('Password must contain at least one number')
  })

  it('accepts password at exactly 8 characters', () => {
    const result = validatePassword('Abcdefg1')
    expect(result.valid).toBe(true)
  })

  it('accepts long valid password', () => {
    const pass = 'Aa1' + 'x'.repeat(125)
    expect(pass.length).toBe(128)
    const result = validatePassword(pass)
    expect(result.valid).toBe(true)
  })
})

// ============================================================================
// validateRequired
// ============================================================================

describe('validateRequired', () => {
  it('returns null when all required fields are present', () => {
    const body = { name: 'John', email: 'john@example.com' }
    expect(validateRequired(body, ['name', 'email'])).toBeNull()
  })

  it('returns error message for missing field', () => {
    const body = { name: 'John' }
    expect(validateRequired(body, ['name', 'email'])).toBe('Missing required field: email')
  })

  it('treats undefined as missing', () => {
    const body = { name: undefined }
    expect(validateRequired(body as any, ['name'])).toBe('Missing required field: name')
  })

  it('treats null as missing', () => {
    const body = { name: null }
    expect(validateRequired(body as any, ['name'])).toBe('Missing required field: name')
  })

  it('treats empty string as missing', () => {
    const body = { name: '' }
    expect(validateRequired(body, ['name'])).toBe('Missing required field: name')
  })

  it('returns null for empty required fields array', () => {
    expect(validateRequired({}, [])).toBeNull()
  })

  it('accepts zero as a valid value', () => {
    const body = { count: 0 }
    expect(validateRequired(body, ['count'])).toBeNull()
  })

  it('accepts false as a valid value', () => {
    const body = { active: false }
    expect(validateRequired(body, ['active'])).toBeNull()
  })
})
