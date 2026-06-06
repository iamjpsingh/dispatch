import type { Context, Next } from 'hono'
import { rbacService, type Permission } from '../services/rbacService'

/**
 * Middleware that requires specific permission(s) in the current org.
 * Must be used AFTER authMiddleware (which sets c.user and c.orgId).
 */
export function requirePermission(...permissions: Permission[]) {
  return async (c: Context, next: Next) => {
    const user = c.user
    const orgId = c.get('orgId') as string | undefined

    if (!user) {
      return c.json({ success: false, message: 'Authentication required' }, 401)
    }

    // Platform admins bypass org context requirement
    if (!orgId) {
      if (rbacService.isPlatformAdmin(user.id)) {
        return next()
      }
      return c.json({ success: false, message: 'No organization context. Select an organization first.' }, 403)
    }

    const hasAccess = permissions.length === 1
      ? rbacService.hasPermission(user.id, orgId, permissions[0])
      : rbacService.hasAllPermissions(user.id, orgId, permissions)

    if (!hasAccess) {
      return c.json({
        success: false,
        message: 'Insufficient permissions',
        required: permissions,
      }, 403)
    }

    return next()
  }
}

/**
 * Middleware that requires ANY of the given permissions
 */
export function requireAnyPermission(...permissions: Permission[]) {
  return async (c: Context, next: Next) => {
    const user = c.user
    const orgId = c.get('orgId') as string | undefined

    if (!user) {
      return c.json({ success: false, message: 'Authentication required' }, 401)
    }

    // Platform admins bypass org context requirement
    if (!orgId) {
      if (rbacService.isPlatformAdmin(user.id)) {
        return next()
      }
      return c.json({ success: false, message: 'No organization context' }, 403)
    }

    if (!rbacService.hasAnyPermission(user.id, orgId, permissions)) {
      return c.json({
        success: false,
        message: 'Insufficient permissions',
        required: permissions,
      }, 403)
    }

    return next()
  }
}

/**
 * Middleware that requires platform admin access
 */
export function requirePlatformAdmin() {
  return async (c: Context, next: Next) => {
    const user = c.user
    if (!user) {
      return c.json({ success: false, message: 'Authentication required' }, 401)
    }

    if (!rbacService.isPlatformAdmin(user.id)) {
      return c.json({ success: false, message: 'Platform admin access required' }, 403)
    }

    return next()
  }
}

/**
 * Middleware that requires org membership (any role)
 */
export function requireOrgMember() {
  return async (c: Context, next: Next) => {
    const user = c.user
    const orgId = c.get('orgId') as string | undefined

    if (!user) {
      return c.json({ success: false, message: 'Authentication required' }, 401)
    }

    if (!orgId) {
      if (rbacService.isPlatformAdmin(user.id)) {
        return next()
      }
      return c.json({ success: false, message: 'No organization context' }, 403)
    }

    if (!rbacService.isPlatformAdmin(user.id) && !rbacService.isMember(user.id, orgId)) {
      return c.json({ success: false, message: 'You are not a member of this organization' }, 403)
    }

    return next()
  }
}
