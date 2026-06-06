/**
 * Landing Pages API
 */
import { api } from './client'

// ============================================================================
// Types
// ============================================================================

export interface LandingPage {
  id: string
  org_id: string
  user_id: string
  slug: string
  title: string
  template: string
  html_content: string
  css_content: string
  meta_description: string | null
  meta_image: string | null
  form_id: string | null
  tracking_enabled: number
  published: number
  visit_count: number
  created_at: string
  updated_at: string
}

export interface LandingPageInput {
  title: string
  slug: string
  template?: string
  html_content: string
  css_content?: string
  meta_description?: string
  meta_image?: string
  form_id?: string
  tracking_enabled?: boolean
}

export interface PageTemplate {
  id: string
  name: string
  html: string
  css: string
}

// ============================================================================
// Pages API
// ============================================================================

export const pagesApi = {
  list: async (): Promise<LandingPage[]> => {
    const res = await api.get<{ pages: LandingPage[] }>('/pages')
    if (!res.success) throw new Error(res.message || 'Failed to load pages')
    return res.data?.pages || []
  },

  get: async (id: string): Promise<LandingPage> => {
    const res = await api.get<LandingPage>(`/pages/${id}`)
    if (!res.success) throw new Error(res.message || 'Page not found')
    return res.data!
  },

  create: async (input: LandingPageInput): Promise<LandingPage> => {
    const res = await api.post<LandingPage>('/pages', input)
    if (!res.success) throw new Error(res.message || 'Failed to create page')
    return res.data!
  },

  update: async (id: string, updates: Partial<LandingPageInput>) => {
    const res = await api.put(`/pages/${id}`, updates)
    if (!res.success) throw new Error(res.message || 'Failed to update page')
  },

  delete: async (id: string) => {
    const res = await api.delete(`/pages/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed to delete page')
  },

  publish: async (id: string): Promise<string> => {
    const res = await api.post<{ url: string }>(`/pages/${id}/publish`)
    if (!res.success) throw new Error(res.message || 'Failed to publish page')
    return res.data?.url || ''
  },

  unpublish: async (id: string) => {
    const res = await api.post(`/pages/${id}/unpublish`)
    if (!res.success) throw new Error(res.message || 'Failed to unpublish page')
  },

  getTemplates: async (): Promise<PageTemplate[]> => {
    const res = await api.get<{ templates: PageTemplate[] }>('/pages/templates')
    if (!res.success) throw new Error(res.message || 'Failed to load templates')
    return res.data?.templates || []
  },

  getPreviewUrl: (id: string): string => {
    const baseUrl = import.meta.env.VITE_API_URL || '/api'
    return `${baseUrl}/pages/${id}/preview`
  },
}
