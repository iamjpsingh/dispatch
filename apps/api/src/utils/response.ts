/**
 * Standardized API Response Utilities
 * Consistent response format across all endpoints
 */
import type { Context } from 'hono'

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
  error?: string
  meta?: Record<string, unknown>
}

/**
 * Success response helper
 */
export function success<T>(c: Context, data?: T, message?: string, status = 200) {
  const response: ApiResponse<T> = { success: true }
  if (data !== undefined) response.data = data
  if (message) response.message = message
  return c.json(response, status)
}

/**
 * Error response helper
 */
export function error(c: Context, message: string, status = 400, details?: string) {
  const response: ApiResponse = { success: false, message }
  if (details) response.error = details
  return c.json(response, status)
}

/**
 * Paginated response helper
 */
export function paginated<T>(
  c: Context,
  data: T[],
  pagination: { page: number; limit: number; total: number }
) {
  return c.json({
    success: true,
    data,
    meta: {
      pagination: {
        ...pagination,
        totalPages: Math.ceil(pagination.total / pagination.limit),
        hasMore: pagination.page * pagination.limit < pagination.total,
      },
    },
  })
}

/**
 * Common error messages
 */
export const ErrorMessages = {
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'Access denied',
  NOT_FOUND: 'Resource not found',
  VALIDATION: 'Validation failed',
  SERVER_ERROR: 'Internal server error',
  SESSION_EXPIRED: 'Session expired',
  MISSING_FIELDS: 'Missing required fields',
  INVALID_CONFIG: 'Invalid configuration',
} as const
