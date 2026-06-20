import { z } from 'zod'

export const CreateFormSchema = z.object({
  name: z.string().min(1, 'Form name is required').max(200),
  list_id: z.string().min(1, 'List ID is required'),
  required_fields: z.array(z.string()).optional(),
  field_mapping: z.record(z.string(), z.string()).optional(),
  allowed_domains: z.array(z.string()).optional(),
  redirect_url: z.string().url().optional().or(z.literal('')),
  success_message: z.string().max(500).optional(),
  actions: z.array(z.object({
    type: z.string(),
    tag: z.string().optional(),
  })).optional(),
})

export const SubmissionsQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
})

export type CreateFormInput = z.infer<typeof CreateFormSchema>
export type SubmissionsQueryInput = z.infer<typeof SubmissionsQuerySchema>
