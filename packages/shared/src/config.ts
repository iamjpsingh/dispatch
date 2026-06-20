import { z } from 'zod'

export const CreateSMTPSchema = z.object({
  name: z.string().max(200).optional(),
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535).optional().default(587),
  secure: z.boolean().optional().default(false),
  user: z.string().min(1, 'Username is required'),
  pass: z.string().min(1, 'Password is required'),
  fromEmail: z.string().email().optional(),
  from_email: z.string().email().optional(),
  fromName: z.string().max(200).optional(),
  from_name: z.string().max(200).optional(),
  isDefault: z.boolean().optional(),
  is_default: z.boolean().optional(),
})
  .refine((d) => !!(d.fromEmail || d.from_email), {
    message: 'from_email is required',
    path: ['from_email'],
  })

export const UpdateSMTPSchema = z.object({
  name: z.string().max(200).optional(),
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().optional(),
  pass: z.string().optional(),
  fromEmail: z.string().email().optional(),
  from_email: z.string().email().optional(),
  fromName: z.string().max(200).optional(),
  from_name: z.string().max(200).optional(),
  isDefault: z.boolean().optional(),
  is_default: z.boolean().optional(),
  api_key: z.string().optional(),
  api_secret: z.string().optional(),
  api_region: z.string().optional(),
  api_domain: z.string().optional(),
})

export const TestSMTPSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().optional().default(587),
  secure: z.boolean().optional().default(false),
  user: z.string().min(1, 'Username is required'),
  pass: z.string().min(1, 'Password is required'),
})

export const CreateProviderSchema = z.object({
  provider_type: z.enum(['ses', 'mailgun', 'sendgrid']),
  name: z.string().max(200).optional(),
  from_email: z.string().email('from_email is required'),
  from_name: z.string().max(200).optional(),
  is_default: z.boolean().optional(),
  api_key: z.string().optional(),
  access_key_id: z.string().optional(),
  secret_access_key: z.string().optional(),
  region: z.string().optional(),
  api_region: z.string().optional(),
  domain: z.string().optional(),
  api_domain: z.string().optional(),
})

export type CreateSMTPInput = z.infer<typeof CreateSMTPSchema>
export type UpdateSMTPInput = z.infer<typeof UpdateSMTPSchema>
export type TestSMTPInput = z.infer<typeof TestSMTPSchema>
export type CreateProviderInput = z.infer<typeof CreateProviderSchema>
