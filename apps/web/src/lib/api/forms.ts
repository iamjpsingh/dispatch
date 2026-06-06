/**
 * Forms API — Universal Form Connector
 */
import { api } from './client'

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
    const res = await api.get<{ forms: FormEndpoint[] }>('/forms')
    if (!res.success) throw new Error(res.message || 'Failed to load forms')
    return res.data?.forms || []
  },

  get: async (id: string): Promise<FormEndpoint> => {
    const res = await api.get<FormEndpoint>(`/forms/${id}`)
    if (!res.success) throw new Error(res.message || 'Form not found')
    return res.data!
  },

  create: async (input: FormInput): Promise<FormEndpoint> => {
    const res = await api.post<FormEndpoint>('/forms', input)
    if (!res.success) throw new Error(res.message || 'Failed to create form')
    return res.data!
  },

  update: async (id: string, updates: Partial<FormInput>) => {
    const res = await api.put(`/forms/${id}`, updates)
    if (!res.success) throw new Error(res.message || 'Failed to update form')
  },

  delete: async (id: string) => {
    const res = await api.delete(`/forms/${id}`)
    if (!res.success) throw new Error(res.message || 'Failed to delete form')
  },

  toggle: async (id: string): Promise<string> => {
    const res = await api.post<{ status: string }>(`/forms/${id}/toggle`)
    if (!res.success) throw new Error(res.message || 'Failed to toggle form')
    return res.data?.status || 'paused'
  },

  getEmbed: async (id: string): Promise<EmbedCode> => {
    const res = await api.get<EmbedCode>(`/forms/${id}/embed`)
    if (!res.success) throw new Error(res.message || 'Failed to get embed code')
    return res.data!
  },

  getSubmissions: async (id: string, limit = 50, offset = 0): Promise<{ submissions: FormSubmission[]; total: number }> => {
    const res = await api.get<{ submissions: FormSubmission[]; total: number }>(`/forms/${id}/submissions?limit=${limit}&offset=${offset}`)
    if (!res.success) throw new Error(res.message || 'Failed to load submissions')
    return res.data || { submissions: [], total: 0 }
  },
}
