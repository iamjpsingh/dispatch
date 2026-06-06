// src/middleware/validate.ts - Input Validation & Sanitization Helpers

import { isValidEmail, validatePassword } from '../utils/validation'
export { isValidEmail, validatePassword }

/**
 * Sanitize string input (remove dangerous characters)
 */
export function sanitizeString(input: string, maxLength = 500): string {
  if (!input || typeof input !== 'string') return ''
  return input.trim().slice(0, maxLength).replace(/[<>]/g, '') // Strip angle brackets (basic XSS)
}

/**
 * Sanitize HTML content (allow HTML but strip script tags)
 */
export function sanitizeHtml(html: string, maxLength = 500000): string {
  if (!html || typeof html !== 'string') return ''
  return html
    .slice(0, maxLength)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=/gi, 'data-removed=')
    .replace(/javascript:/gi, 'removed:')
}

/**
 * Validate required fields in request body
 */
export function validateRequired(body: Record<string, any>, fields: string[]): string | null {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      return `Missing required field: ${field}`
    }
  }
  return null
}

/**
 * Validate file upload
 */
export function validateFileUpload(
  file: {
    size: number
    type?: string
    name?: string
  },
  options: {
    maxSizeMB?: number
    allowedTypes?: string[]
    allowedExtensions?: string[]
  } = {}
): string | null {
  const maxSize = (options.maxSizeMB || 10) * 1024 * 1024

  if (file.size > maxSize) {
    return `File too large. Maximum size: ${options.maxSizeMB || 10}MB`
  }

  if (options.allowedTypes && file.type) {
    if (!options.allowedTypes.includes(file.type)) {
      return `File type not allowed: ${file.type}`
    }
  }

  if (options.allowedExtensions && file.name) {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!ext || !options.allowedExtensions.includes(ext)) {
      return `File extension not allowed: .${ext}`
    }
  }

  return null
}

/**
 * Validate pagination params
 */
export function validatePagination(params: { page?: any; limit?: any }): { page: number; limit: number } {
  const page = Math.max(1, parseInt(params.page) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(params.limit) || 50))
  return { page, limit }
}
