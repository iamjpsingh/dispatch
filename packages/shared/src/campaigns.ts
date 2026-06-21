import { z } from 'zod'

export const CreateCampaignSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  subject: z.string().min(1, 'Subject is required').max(500),
  from_email: z.string().email('Valid from_email is required'),
  from_name: z.string().min(1, 'from_name is required').max(200),
  type: z.enum(['regular', 'ab_test', 'automated', 'rss']).optional(),
  template_id: z.string().optional(),
  html_content: z.string().optional(),
  text_content: z.string().optional(),
  list_ids: z.array(z.string()).optional(),
  segment_ids: z.array(z.string()).optional(),
  config_id: z.string().optional(),
  folder: z.string().max(100).optional(),
  tags: z.array(z.string()).optional(),
})

export const UpdateCampaignSchema = CreateCampaignSchema.partial()

export const ScheduleSchema = z.object({
  scheduled_at: z.string().min(1, 'scheduled_at is required'),
})

export const ABVariantSchema = z.object({
  label: z.string().max(50).optional(),
  percentage: z.number().min(1).max(100).optional(),
  subject: z.string().max(500).optional(),
  template_id: z.string().optional(),
  sender_name: z.string().max(200).optional(),
  sender_email: z.string().email().optional(),
})

export const ABWinnerSchema = z.object({
  variant_id: z.string().min(1, 'variant_id is required'),
})

export const FrequencyCapSchema = z.object({
  maxPerWindow: z.number().int().min(1).max(100),
  windowHours: z.number().int().min(1).max(720),
  enabled: z.boolean(),
})

export const ABAutoWinnerSchema = z.object({
  winner_metric: z.enum(['open_rate', 'click_rate', 'click_to_open_rate']).default('open_rate'),
  auto_winner_after_hours: z.number().int().min(1).max(168).default(24),
})

export const GraymailConfigSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(3).max(50),
})

export const RotationConfigSchema = z.object({
  mode: z.enum(['smart', 'manual', 'round_robin', 'weighted']),
  config_ids: z.array(z.string()).optional(),
  weights: z.record(z.string(), z.number()).optional(),
})

export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>
export type ScheduleInput = z.infer<typeof ScheduleSchema>
export type ABVariantInput = z.infer<typeof ABVariantSchema>
export type ABWinnerInput = z.infer<typeof ABWinnerSchema>
export type FrequencyCapInput = z.infer<typeof FrequencyCapSchema>
export type ABAutoWinnerInput = z.infer<typeof ABAutoWinnerSchema>
export type GraymailConfigInput = z.infer<typeof GraymailConfigSchema>
export type RotationConfigInput = z.infer<typeof RotationConfigSchema>
