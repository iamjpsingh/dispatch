/**
 * Auth API
 */
import { hc } from 'hono/client'
import type { AuthRoutes } from '@dispatch/api/src/routes/auth'
import type { User, AuthContext } from './client'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<AuthRoutes>(rpcBase(), { fetch: rpcFetch })

export const authApi = {
  login: async (email: string, password: string): Promise<AuthContext> => {
    const res = await client.auth.login.$post({ json: { email, password } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Login failed')
    return body.data as AuthContext
  },

  register: async (name: string, email: string, password: string): Promise<AuthContext> => {
    const res = await client.auth.register.$post({ json: { name, email, password } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Registration failed')
    return body.data as AuthContext
  },

  logout: async () => {
    await client.auth.logout.$post()
  },

  getMe: async (): Promise<AuthContext> => {
    const res = await client.auth.me.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Not authenticated')
    return body.data as AuthContext
  },

  switchOrg: async (orgId: string): Promise<void> => {
    const res = await client.auth['switch-org'].$post({ json: { orgId } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to switch organization')
  },

  forgotPassword: async (email: string): Promise<string> => {
    const res = await client.auth['forgot-password'].$post({ json: { email } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to send reset email')
    return body.message ?? 'If an account exists with that email, a reset link has been sent.'
  },

  validateResetToken: async (token: string): Promise<boolean> => {
    const res = await client.auth['reset-password'][':token'].$get({ param: { token } })
    const body = await res.json()
    return body.success && !!body.data?.valid
  },

  resetPassword: async (token: string, password: string): Promise<void> => {
    const res = await client.auth['reset-password'].$post({ json: { token, password } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to reset password')
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    const res = await client.auth['change-password'].$post({ json: { currentPassword, newPassword } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to change password')
  },

  updateProfile: async (data: { name?: string; email?: string }): Promise<User> => {
    const res = await client.auth.profile.$put({ json: data })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update profile')
    return (body.data as { user: User }).user
  },

  // Username
  checkUsername: async (username: string): Promise<{ available: boolean; suggestions: string[] }> => {
    const res = await client.auth['check-username'].$get({ query: { username } })
    const body = await res.json()
    return body.data as { available: boolean; suggestions: string[] }
  },

  setUsername: async (username: string) => {
    const res = await client.auth.profile.username.$put({ json: { username } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  suggestUsername: async (): Promise<string> => {
    const res = await client.auth.profile.username.suggest.$get()
    const body = await res.json()
    return (body.data as { suggestion: string } | undefined)?.suggestion ?? ''
  },
}
