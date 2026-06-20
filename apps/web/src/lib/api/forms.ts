/**
 * Forms API — Universal Form Connector
 */
import { hc } from 'hono/client'
import type { FormsRoutes } from '@dispatch/api/src/routes/forms'
import { rpcBase, rpcFetch } from '../rpc/client'

const client = hc<FormsRoutes>(rpcBase(), { fetch: rpcFetch })

// ============================================================================
// Types
// ============================================================================

export interface FormAction {
  type: 'add_to_list' | 'add_tag' | 'enroll_automation' | 'send_email' | 'webhook' | 'update_score'
  listId?: string
  tag?: string
  automationId?: string
  templateId?: string
  url?: string
  amount?: number
}

export interface FormEndpoint {
  id: string
  org_id: string
  user_id: string
  name: string
  list_id: string
  field_mapping: string
  required_fields: string
  allowed_domains: string
  redirect_url: string | null
  actions: string
  double_optin: number
  success_message: string
  submission_count: number
  status: 'active' | 'paused'
  created_at: string
  updated_at: string
}

export interface FormSubmission {
  id: string
  form_id: string
  data: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface FormInput {
  name: string
  list_id: string
  field_mapping?: Record<string, string>
  required_fields?: string[]
  allowed_domains?: string[]
  redirect_url?: string
  actions?: FormAction[]
  double_optin?: boolean
  success_message?: string
}

export interface EmbedCode {
  html: string
  js: string
  api: string
}

// ============================================================================
// Forms API
// ============================================================================

export const formsApi = {
  list: async (): Promise<FormEndpoint[]> => {
    const res = await client.forms.$get()
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load forms')
    return (body.data as { forms: FormEndpoint[] } | undefined)?.forms || []
  },

  get: async (id: string): Promise<FormEndpoint> => {
    const res = await client.forms[':id'].$get({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Form not found')
    return body.data as FormEndpoint
  },

  create: async (input: FormInput): Promise<FormEndpoint> => {
    const res = await client.forms.$post({ json: input })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to create form')
    return body.data as FormEndpoint
  },

  update: async (id: string, updates: Partial<FormInput>) => {
    const res = await client.forms[':id'].$put({ param: { id }, json: updates })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to update form')
  },

  delete: async (id: string) => {
    const res = await client.forms[':id'].$delete({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to delete form')
  },

  toggle: async (id: string): Promise<string> => {
    const res = await client.forms[':id'].toggle.$post({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to toggle form')
    return (body.data as { status: string } | undefined)?.status || 'paused'
  },

  getEmbed: async (id: string): Promise<EmbedCode> => {
    const res = await client.forms[':id'].embed.$get({ param: { id } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to get embed code')
    return body.data as EmbedCode
  },

  getSubmissions: async (id: string, limit = 50, offset = 0): Promise<{ submissions: FormSubmission[]; total: number }> => {
    const res = await client.forms[':id'].submissions.$get({ param: { id }, query: { limit: String(limit), offset: String(offset) } })
    const body = await res.json()
    if (!body.success) throw new Error(body.message ?? 'Failed to load submissions')
    return (body.data as { submissions: FormSubmission[]; total: number } | undefined) || { submissions: [], total: 0 }
  },
}
