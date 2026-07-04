// src/services/audit/context.ts - Route-layer audit primitives.
// Derive actor/org/ip/ua from the Hono Context server-side; fire-and-forget (never throws).
import type { Context } from 'hono'
import { auditService } from '../auditService'
import type { AuditAction, ActivityAction } from './types'

function actor(c: Context) {
  // Read defensively — do NOT use requireAuth/getOrgId (they throw). This runs in a
  // fire-and-forget path and must never break the request.
  const user = c.user
  return {
    actorId: user?.id ?? 'unknown',
    actorEmail: user?.email,
    orgId: (c.get('orgId') as string | null) ?? undefined,
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  }
}

export function auditFromContext(
  c: Context,
  entry: { action: AuditAction; entityType: string; entityId?: string;
           changes?: Record<string, { from: unknown; to: unknown }>;
           metadata?: Record<string, unknown> },
): void {
  const a = actor(c)
  void auditService.log({ ...a, ...entry })
}

export function activityFromContext(
  c: Context,
  entry: { action: ActivityAction; entityType: string; entityId?: string;
           description: string; metadata?: Record<string, unknown> },
): void {
  const a = actor(c)
  void auditService.logActivity({ ...a, ...entry })
}
