/**
 * Templates API
 */
import { hc } from 'hono/client'
import type { TemplatesRoutes } from '@dispatch/api/src/routes/templates'
import { type Pagination } from './client'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<TemplatesRoutes>(rpcBase(), { fetch: rpcFetch })

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
    const query: Record<string, string> = {}
    if (params)
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') query[k] = String(v)
      })
    const res = await client.templates.$get({ query })
    const body = await res.json()
    return {
      templates: ((body as any).data as Template[]) || [],
      pagination: (body as any).meta?.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 },
    }
  },

  get: async (id: string): Promise<Template> => {
    const res = await client.templates[':id'].$get({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Template not found')
    return body.data as Template
  },

  create: async (input: TemplateInput): Promise<Template> => {
    const res = await client.templates.$post({ json: input })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create template')
    return body.data as Template
  },

  update: async (id: string, updates: Partial<TemplateInput>) => {
    const res = await client.templates[':id'].$put({ param: { id }, json: updates })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update template')
  },

  delete: async (id: string) => {
    const res = await client.templates[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete template')
  },

  duplicate: async (id: string, name: string): Promise<Template> => {
    const res = await client.templates[':id'].duplicate.$post({ param: { id }, json: { name } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to duplicate')
    return body.data as Template
  },

  preview: async (html: string, data: Record<string, string>): Promise<{ html: string; variables: string[] }> => {
    const res = await client.templates.preview.$post({ json: { html, data } })
    const body = await res.json()
    return (body.data as { html: string; variables: string[] }) || { html: '', variables: [] }
  },

  getStarters: async (): Promise<Template[]> => {
    const res = await client.templates.starters.$get()
    const body = await res.json()
    return (body.data as { templates: Template[] } | undefined)?.templates || []
  },

  testSend: async (id: string, opts: { to?: string; subject?: string; data?: Record<string, string> }): Promise<string> => {
    const res = await client.templates[':id']['test-send'].$post({ param: { id }, json: opts })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to send test email')
    return (body.data as { messageId: string } | undefined)?.messageId || ''
  },

  // MJML compilation
  compileMjml: async (mjml: string): Promise<{ html: string; errors: { line: number; message: string }[] }> => {
    const res = await client.templates.compile.$post({ json: { mjml } })
    const body = await res.json()
    return (body.data as { html: string; errors: any[] }) || { html: '', errors: [] }
  },

  createFromMjml: async (name: string, mjml: string, opts?: { subject?: string; category?: string; description?: string }): Promise<Template> => {
    const res = await client.templates['from-mjml'].$post({ json: { name, mjml, ...opts } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create template')
    return body.data as Template
  },

  // Reusable Sections
  listSections: async (category?: string): Promise<TemplateSection[]> => {
    const query: Record<string, string> = {}
    if (category) query.category = category
    const res = await client.templates.sections.$get({ query })
    const body = await res.json()
    return (body.data as { sections: TemplateSection[] } | undefined)?.sections || []
  },

  createSection: async (name: string, htmlContent: string, category?: string): Promise<TemplateSection> => {
    const res = await client.templates.sections.$post({ json: { name, html_content: htmlContent, category: category as any } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
    return body.data as TemplateSection
  },

  deleteSection: async (id: string) => {
    const res = await client.templates.sections[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed')
  },

  useSection: async (id: string): Promise<string> => {
    const res = await client.templates.sections[':id'].use.$post({ param: { id } })
    const body = await res.json()
    return (body.data as { html_content: string } | undefined)?.html_content || ''
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
