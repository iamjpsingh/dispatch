import { z } from 'zod'

export const RecordEventSchema = z.object({
  eventType: z.enum(['open', 'click', 'bounce', 'unsubscribe']),
  campaignId: z.string().optional(),
  recipientEmail: z.string().optional(),
  userAgent: z.string().optional(),
  url: z.string().optional(),
  geoCountry: z.string().optional(),
  geoCity: z.string().optional(),
})

export const SeedSchema = z.object({
  campaignId: z.string().min(1, 'campaignId is required'),
  campaignName: z.string().optional(),
  // Typed to match analyticsService.seedFromCampaign's stats param (was z.record — too loose).
  stats: z.object({
    total_sent: z.number(),
    delivered: z.number().optional(),
    failed: z.number().optional(),
    opened: z.number().optional(),
    clicked: z.number().optional(),
    bounced: z.number().optional(),
    unsubscribed: z.number().optional(),
  }),
})

export const CustomReportSchema = z.object({
  name: z.string().max(200).optional(),
  columns: z.array(z.string()).min(1, 'At least one column required'),
  filters: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
})

export type RecordEventInput = z.infer<typeof RecordEventSchema>
export type SeedInput = z.infer<typeof SeedSchema>
export type CustomReportInput = z.infer<typeof CustomReportSchema>
