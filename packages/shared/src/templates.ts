import { z } from 'zod'

export const CreateTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  html_content: z.string().trim().min(1, 'HTML content is required'),
  subject: z.string().max(500).optional(),
  category: z.string().max(50).optional(),
  description: z.string().max(1000).optional(),
  variables: z.array(z.string()).optional(),
})

export const UpdateTemplateSchema = CreateTemplateSchema.partial()

export const PreviewSchema = z.object({
  data: z.record(z.string(), z.string()).optional(),
  html: z.string().optional(),
})

export const PreviewHtmlSchema = PreviewSchema.extend({ html: z.string().min(1, 'HTML content is required') })

export const TestSendSchema = z.object({
  to: z.string().email().optional(),
  subject: z.string().max(500).optional(),
  data: z.record(z.string(), z.string()).optional(),
})

export const DuplicateTemplateSchema = z.object({
  name: z.string().optional(),
})

export const SectionSchema = z.object({
  name: z.string().min(1, 'Section name is required').max(200),
  category: z.enum(['header', 'footer', 'cta', 'hero', 'social', 'divider', 'general']).optional(),
  html_content: z.string().min(1, 'HTML content is required'),
})

export const UpdateSectionSchema = SectionSchema.partial()

export const MjmlSchema = z.object({
  mjml: z.string().min(1, 'MJML source is required'),
})

export const FromMjmlSchema = z.object({
  name: z.string().min(1).max(200),
  mjml: z.string().min(1),
  subject: z.string().max(500).optional(),
  category: z.string().max(50).optional(),
  description: z.string().max(1000).optional(),
})

export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateSchema>
export type PreviewInput = z.infer<typeof PreviewSchema>
export type TestSendInput = z.infer<typeof TestSendSchema>
export type DuplicateTemplateInput = z.infer<typeof DuplicateTemplateSchema>
export type SectionInput = z.infer<typeof SectionSchema>
export type MjmlInput = z.infer<typeof MjmlSchema>
export type FromMjmlInput = z.infer<typeof FromMjmlSchema>
