// src/utils/validate.ts — Zod request validation + AppError

import { z } from 'zod'
import type { Context } from 'hono'

// ============================================================================
// AppError — throw from anywhere, caught by Hono onError
// ============================================================================

export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'AppError'
  }
}

// ============================================================================
// Request Validation
// ============================================================================

/**
 * Validate and parse a JSON request body against a Zod schema.
 * Returns the typed, validated data or throws AppError(400).
 *
 * Usage in routes:
 *   const body = await validateBody(c, MySchema)
 */
export async function validateBody<T extends z.ZodType>(
  c: Context,
  schema: T
): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new AppError(400, 'Invalid JSON body')
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
    const message = issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new AppError(400, message || 'Validation failed')
  }

  return result.data
}

/**
 * Validate query parameters against a Zod schema.
 * Extracts all query params as key-value pairs, then validates.
 */
export function validateQuery<T extends z.ZodType>(
  c: Context,
  schema: T
): z.infer<T> {
  const raw: Record<string, string> = {}
  for (const [key, value] of new URL(c.req.url).searchParams.entries()) {
    raw[key] = value
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
    const message = issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new AppError(400, message || 'Invalid query parameters')
  }

  return result.data
}
