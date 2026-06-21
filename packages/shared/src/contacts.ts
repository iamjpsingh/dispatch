import { z } from 'zod'

export const CreateListSchema = z.object({
  name: z.string().trim().min(1, 'List name is required').max(200),
  description: z.string().max(1000).optional(),
})

export const UpdateListSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
})

export const AddContactSchema = z.object({
  email: z.string().email('Valid email is required'),
  first_name: z.string().max(200).optional(),
  last_name: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.string(), z.string()).optional(),
})

export const MergeSchema = z.object({
  primary_id: z.string().min(1, 'primary_id is required'),
  merge_ids: z.array(z.string()).min(1, 'merge_ids must have at least one entry'),
})

export const ValidateBulkSchema = z.object({
  emails: z.array(z.string()).min(1, 'Emails array is required').max(100),
})

export const ValidateSingleSchema = z.object({
  email: z.string().email('Valid email is required'),
})

export const BulkDeleteSchema = z.object({
  ids: z.array(z.string()).min(1, 'Contact IDs array is required'),
})

export const BulkTagSchema = z.object({
  ids: z.array(z.string()).min(1, 'Contact IDs are required'),
  tags: z.array(z.string()).min(1, 'Tags are required'),
})

export const BulkMoveSchema = z.object({
  ids: z.array(z.string()).min(1, 'Contact IDs are required'),
  target_list_id: z.string().min(1, 'Target list ID is required'),
})

export const PreferenceSchema = z.object({
  preference: z.enum(['subscribed', 'campaign_only', 'digest_weekly', 'digest_monthly', 'paused', 'unsubscribed']),
  reason: z.string().max(500).optional(),
  pause_days: z.number().int().min(1).max(365).optional(),
})

export const ContactsQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  tags: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
})

export const TimelineQuerySchema = z.object({
  limit: z.string().optional(),
})

export type CreateListInput = z.infer<typeof CreateListSchema>
export type UpdateListInput = z.infer<typeof UpdateListSchema>
export type AddContactInput = z.infer<typeof AddContactSchema>
export type MergeInput = z.infer<typeof MergeSchema>
export type ValidateBulkInput = z.infer<typeof ValidateBulkSchema>
export type ValidateSingleInput = z.infer<typeof ValidateSingleSchema>
export type BulkDeleteInput = z.infer<typeof BulkDeleteSchema>
export type BulkTagInput = z.infer<typeof BulkTagSchema>
export type BulkMoveInput = z.infer<typeof BulkMoveSchema>
export type PreferenceInput = z.infer<typeof PreferenceSchema>
export type ContactsQueryInput = z.infer<typeof ContactsQuerySchema>
export type TimelineQueryInput = z.infer<typeof TimelineQuerySchema>
