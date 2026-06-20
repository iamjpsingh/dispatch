/**
 * Landing Pages API
 */
import { hc } from 'hono/client'
import type { PagesRoutes } from '@dispatch/api/src/routes/pages'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<PagesRoutes>(rpcBase(), { fetch: rpcFetch })

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
    const res = await client.pages.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load pages')
    return (body.data as { pages: LandingPage[] } | undefined)?.pages || []
  },

  get: async (id: string): Promise<LandingPage> => {
    const res = await client.pages[':id'].$get({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Page not found')
    return body.data as LandingPage
  },

  create: async (input: LandingPageInput): Promise<LandingPage> => {
    const res = await client.pages.$post({ json: input })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create page')
    return body.data as LandingPage
  },

  update: async (id: string, updates: Partial<LandingPageInput>) => {
    const res = await client.pages[':id'].$put({ param: { id }, json: updates })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update page')
  },

  delete: async (id: string) => {
    const res = await client.pages[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete page')
  },

  publish: async (id: string): Promise<string> => {
    const res = await client.pages[':id'].publish.$post({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to publish page')
    return (body.data as { url: string } | undefined)?.url || ''
  },

  unpublish: async (id: string) => {
    const res = await client.pages[':id'].unpublish.$post({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to unpublish page')
  },

  getTemplates: async (): Promise<PageTemplate[]> => {
    const res = await client.pages.templates.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load templates')
    return (body.data as { templates: PageTemplate[] } | undefined)?.templates || []
  },

  getPreviewUrl: (id: string): string => {
    const baseUrl = import.meta.env.VITE_API_URL || '/api'
    return `${baseUrl}/pages/${id}/preview`
  },
}
