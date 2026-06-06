/**
 * Templates API
 */
import { api, type Pagination } from './client'

// ============================================================================
// Template Types
// ============================================================================

export type TemplateCategory =
  | 'newsletter'
  | 'promotional'
  | 'transactional'
  | 'welcome'
  | 'follow_up'
  | 'announcement'
  | 'general'

export interface Template {
  id: string
  user_id: string
  name: string
  description: string | null
  category: TemplateCategory
  subject: string | null
  html_content: string
  text_content: string | null
  variables: string
  is_starter: number
  version: number
  created_at: string
  updated_at: string
}

export interface TemplateInput {
  name: string
  description?: string
  category?: TemplateCategory
  subject?: string
  html_content: string
  text_content?: string
}

// ============================================================================
// Templates API
// ============================================================================

export const templatesApi = {
  list: async (params?: {
    category?: string
    search?: string
    page?: number
    limit?: number
  }): Promise<{ templates: Template[]; pagination: Pagination }> => {
    const qs = new URLSearchParams()
    if (params)
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') qs.set(k, String(v))
      })
    const res = await api.get<Template[]>(`/templates?${qs}`)
    return {
      templates: (res as any).data || [],
      pagination: (res as any).meta?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 },
    }
  },

  get: async (id: string): Promise<Template> => {
    const res = await api.get<Template>(`/templates/${id}`)
    if (!res.success) throw new Error(res.message || 'Template not found')
    return res.data!
  },

  create: async (input: TemplateInput): Promise<Template> => {
    const res = await api.post<Template>('/templates', input)
    if (!res.success) throw new Error(res.message || 'Failed to create template')
    return res.data!
  },

  update: async (id: string, updates: Partial<TemplateInput>) => {
    const res = await api.put(`/templates/${id}`, updates)
    if (!res.success) throw new Error(res.message || 'Failed to update template')
  },

  delete: async (id: string) => {
    const res = await api.delete(`/templates/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed to delete template')
  },

  duplicate: async (id: string, name: string): Promise<Template> => {
    const res = await api.post<Template>(`/templates/${id}/duplicate`, { name })
    if (!res.success) throw new Error(res.message || 'Failed to duplicate')
    return res.data!
  },

  preview: async (html: string, data: Record<string, string>): Promise<{ html: string; variables: string[] }> => {
    const res = await api.post<{ html: string; variables: string[] }>('/templates/preview', { html, data })
    return res.data || { html: '', variables: [] }
  },

  getStarters: async (): Promise<Template[]> => {
    const res = await api.get<{ templates: Template[] }>('/templates/starters')
    return res.data?.templates || []
  },

  testSend: async (id: string, opts: { to?: string; subject?: string; data?: Record<string, string> }): Promise<string> => {
    const res = await api.post<{ messageId: string }>(`/templates/${id}/test-send`, opts)
    if (!res.success) throw new Error(res.message || 'Failed to send test email')
    return res.data?.messageId || ''
  },

  // MJML compilation
  compileMjml: async (mjml: string): Promise<{ html: string; errors: { line: number; message: string }[] }> => {
    const res = await api.post<{ html: string; errors: any[] }>('/templates/compile', { mjml })
    return res.data || { html: '', errors: [] }
  },

  createFromMjml: async (name: string, mjml: string, opts?: { subject?: string; category?: string; description?: string }): Promise<Template> => {
    const res = await api.post<Template>('/templates/from-mjml', { name, mjml, ...opts })
    if (!res.success) throw new Error(res.message || 'Failed to create template')
    return res.data!
  },

  // Reusable Sections
  listSections: async (category?: string): Promise<TemplateSection[]> => {
    const qs = category ? `?category=${category}` : ''
    const res = await api.get<{ sections: TemplateSection[] }>(`/templates/sections${qs}`)
    return res.data?.sections || []
  },

  createSection: async (name: string, htmlContent: string, category?: string): Promise<TemplateSection> => {
    const res = await api.post<TemplateSection>('/templates/sections', { name, html_content: htmlContent, category })
    if (!res.success) throw new Error(res.message || 'Failed')
    return res.data!
  },

  deleteSection: async (id: string) => {
    const res = await api.delete(`/templates/sections/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed')
  },

  useSection: async (id: string): Promise<string> => {
    const res = await api.post<{ html_content: string }>(`/templates/sections/${id}/use`)
    return res.data?.html_content || ''
  },
}

export interface TemplateSection {
  id: string
  name: string
  category: string
  html_content: string
  usage_count: number
  created_at: string
}
