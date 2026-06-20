import { z } from 'zod'

export const CreatePageSchema = z.object({
  title: z.string().min(1, 'Page title is required').max(200),
  slug: z.string().min(1, 'Page slug is required').max(200),
  html_content: z.string().optional(),
  css: z.string().optional(),
  meta_description: z.string().max(500).optional(),
  meta_image: z.string().url().optional().or(z.literal('')),
  template_id: z.string().optional(),
})

export type CreatePageInput = z.infer<typeof CreatePageSchema>
