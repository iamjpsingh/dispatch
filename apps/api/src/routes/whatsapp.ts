// src/routes/whatsapp.ts - WhatsApp Business API Routes (Zod-validated)

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { whatsappService } from '../services/whatsappService'
import { success, error } from '../utils/response'
import { validateBody, AppError } from '../utils/validate'

const app = new Hono()

// ============================================================================
// Schemas
// ============================================================================

const CreateConfigSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  provider: z.enum(['meta', 'twilio', '360dialog']).default('meta'),
  phone_number_id: z.string().min(1, 'Phone Number ID is required'),
  business_account_id: z.string().optional(),
  access_token: z.string().min(1, 'Access Token is required'),
  phone_display: z.string().optional(),
  daily_limit: z.number().int().min(1).max(100000).default(1000),
})

const UpdateConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone_number_id: z.string().min(1).optional(),
  business_account_id: z.string().optional(),
  access_token: z.string().min(1).optional(),
  phone_display: z.string().optional(),
  daily_limit: z.number().int().min(1).max(100000).optional(),
})

const SendTemplateSchema = z.object({
  config_id: z.string().min(1, 'config_id is required'),
  phone: z.string().min(7, 'Phone number is required').max(20),
  template_name: z.string().min(1, 'template_name is required'),
  language: z.string().default('en'),
  components: z.array(z.any()).optional(),
  contact_id: z.string().optional(),
  campaign_id: z.string().optional(),
})

const SendTextSchema = z.object({
  config_id: z.string().min(1, 'config_id is required'),
  phone: z.string().min(7, 'Phone number is required').max(20),
  text: z.string().min(1, 'Message text is required').max(4096),
  contact_id: z.string().optional(),
})

const BulkSendSchema = z.object({
  config_id: z.string().min(1, 'config_id is required'),
  template_name: z.string().min(1, 'template_name is required'),
  language: z.string().default('en'),
  recipients: z.array(z.object({
    phone: z.string().min(7),
    contactId: z.string().optional(),
    params: z.array(z.string()).optional(),
  })).min(1, 'At least one recipient is required'),
})

const SyncSchema = z.object({
  config_id: z.string().min(1, 'config_id is required'),
})

const CreateTemplateSchema = z.object({
  config_id: z.string().min(1, 'config_id is required'),
  name: z.string().min(1, 'Template name is required').max(512),
  language: z.string().default('en'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('MARKETING'),
  components: z.array(z.any()).min(1, 'At least one component is required'),
})

// ============================================================================
// Configs
// ============================================================================

app.get('/whatsapp/configs', requirePermission(PERMISSIONS.WHATSAPP_VIEW), (c) => {
  const orgId = getOrgId(c)
  const configs = whatsappService.getConfigs(orgId)
  return success(c, { configs: configs.map(cfg => ({ ...cfg, access_token: '***' })) })
})

app.get('/whatsapp/configs/:id', requirePermission(PERMISSIONS.WHATSAPP_VIEW), (c) => {
  const orgId = getOrgId(c)
  const config = whatsappService.getConfig(orgId, c.req.param('id'))
  if (!config) throw new AppError(404, 'Config not found')
  return success(c, { ...config, access_token: '***' })
})

app.post('/whatsapp/configs', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), async (c) => {
  const user = requireAuth(c)
  const orgId = getOrgId(c)
  const body = await validateBody(c, CreateConfigSchema)

  const config = whatsappService.createConfig(orgId, user.id, body)
  return success(c, { ...config, access_token: '***' }, 'WhatsApp account connected', 201)
})

app.put('/whatsapp/configs/:id', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const body = await validateBody(c, UpdateConfigSchema)
  whatsappService.updateConfig(orgId, c.req.param('id'), body)
  return success(c, null, 'Config updated')
})

app.delete('/whatsapp/configs/:id', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), (c) => {
  const orgId = getOrgId(c)
  whatsappService.deleteConfig(orgId, c.req.param('id'))
  return success(c, null, 'Config deleted')
})

// ============================================================================
// Templates
// ============================================================================

app.get('/whatsapp/templates', requirePermission(PERMISSIONS.WHATSAPP_VIEW), (c) => {
  const orgId = getOrgId(c)
  const configId = c.req.query('config_id')
  const templates = whatsappService.getTemplates(orgId, configId || undefined)
  return success(c, { templates })
})

app.post('/whatsapp/templates/sync', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const { config_id } = await validateBody(c, SyncSchema)
  const synced = await whatsappService.syncTemplates(orgId, config_id)
  return success(c, { synced }, `Synced ${synced} templates`)
})

app.post('/whatsapp/templates', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const body = await validateBody(c, CreateTemplateSchema)
  const tpl = await whatsappService.createTemplate(orgId, body.config_id, body)
  return success(c, tpl, 'Template submitted for approval', 201)
})

app.delete('/whatsapp/templates/:id', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  await whatsappService.deleteTemplate(orgId, c.req.param('id'))
  return success(c, null, 'Template deleted')
})

// ============================================================================
// Sending
// ============================================================================

app.post('/whatsapp/send', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const body = await validateBody(c, SendTemplateSchema)
  const msg = await whatsappService.sendTemplate(orgId, body.config_id, body)
  return success(c, msg, 'Message sent')
})

app.post('/whatsapp/send-text', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const body = await validateBody(c, SendTextSchema)
  const msg = await whatsappService.sendText(orgId, body.config_id, body.phone, body.text, body.contact_id)
  return success(c, msg, 'Message sent')
})

app.post('/whatsapp/send-bulk', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), async (c) => {
  const orgId = getOrgId(c)
  const body = await validateBody(c, BulkSendSchema)
  const result = await whatsappService.sendBulk(orgId, body.config_id, body.template_name, body.recipients, body.language)
  return success(c, result, `Sent ${result.sent}, failed ${result.failed}`)
})

// ============================================================================
// Messages & Stats
// ============================================================================

app.get('/whatsapp/messages', requirePermission(PERMISSIONS.WHATSAPP_VIEW), (c) => {
  const orgId = getOrgId(c)
  const filters = {
    configId: c.req.query('config_id') || undefined,
    status: c.req.query('status') || undefined,
    limit: parseInt(c.req.query('limit') || '50'),
    offset: parseInt(c.req.query('offset') || '0'),
  }
  const result = whatsappService.getMessages(orgId, filters)
  return success(c, result)
})

app.get('/whatsapp/stats', requirePermission(PERMISSIONS.WHATSAPP_VIEW), (c) => {
  const orgId = getOrgId(c)
  const configId = c.req.query('config_id') || undefined
  const stats = whatsappService.getStats(orgId, configId)
  return success(c, stats)
})

// ============================================================================
// Webhook (public — no auth)
// ============================================================================

app.get('/whatsapp/webhook', (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  if (mode === 'subscribe' && token && whatsappService.verifyToken(token)) {
    return c.text(challenge || '', 200)
  }
  return c.text('Forbidden', 403)
})

app.post('/whatsapp/webhook', async (c) => {
  const body = await c.req.json()
  whatsappService.processWebhook(body)
  return c.text('OK', 200)
})

export default app
