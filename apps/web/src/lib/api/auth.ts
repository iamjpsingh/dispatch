/**
 * Auth API
 */
import { api, type User, type AuthContext } from './client'

export const authApi = {
  login: async (email: string, password: string): Promise<AuthContext> => {
    const res = await api.post<AuthContext>('/auth/login', { email, password })
    if (!res.success) throw new Error(res.message || 'Login failed')
    return res.data!
  },

  register: async (name: string, email: string, password: string): Promise<AuthContext> => {
    const res = await api.post<AuthContext>('/auth/register', { name, email, password })
    if (!res.success) throw new Error(res.message || 'Registration failed')
    return res.data!
  },

  logout: async () => {
    await api.post('/auth/logout')
  },

  getMe: async (): Promise<AuthContext> => {
    const res = await api.get<AuthContext>('/auth/me')
    if (!res.success) throw new Error(res.message || 'Not authenticated')
    return res.data!
  },

  switchOrg: async (orgId: string): Promise<void> => {
    const res = await api.post('/auth/switch-org', { orgId })
    if (!res.success) throw new Error(res.message || 'Failed to switch organization')
  },

  forgotPassword: async (email: string): Promise<string> => {
    const res = await api.post<void>('/auth/forgot-password', { email })
    if (!res.success) throw new Error(res.message || 'Failed to send reset email')
    return res.message || 'If an account exists with that email, a reset link has been sent.'
  },

  validateResetToken: async (token: string): Promise<boolean> => {
    const res = await api.get<{ valid: boolean }>(`/auth/reset-password/${token}`)
    return res.success && !!res.data?.valid
  },

  resetPassword: async (token: string, password: string): Promise<void> => {
    const res = await api.post('/auth/reset-password', { token, password })
    if (!res.success) throw new Error(res.message || 'Failed to reset password')
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    const res = await api.post('/auth/change-password', { currentPassword, newPassword })
    if (!res.success) throw new Error(res.message || 'Failed to change password')
  },

  updateProfile: async (data: { name?: string; email?: string }): Promise<User> => {
    const res = await api.put<{ user: User }>('/auth/profile', data)
    if (!res.success) throw new Error(res.message || 'Failed to update profile')
    return res.data!.user
  },

  // Username
  checkUsername: async (username: string): Promise<{ available: boolean; suggestions: string[] }> => {
    const res = await api.get<any>(`/auth/check-username?username=${encodeURIComponent(username)}`)
    return res.data!
  },

  setUsername: async (username: string) => {
    const res = await api.put('/auth/profile/username', { username })
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  suggestUsername: async (): Promise<string> => {
    const res = await api.get<{ suggestion: string }>('/auth/profile/username/suggest')
    return res.data?.suggestion || ''
  },
}
