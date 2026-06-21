// src/routes/whatsapp.ts - WhatsApp Business API Routes (Zod-validated)

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, getOrgId } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { whatsappService } from '../services/whatsappService'
import { success, error } from '../utils/response'
import { AppError } from '../utils/validate'

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

const whatsappRoutes = new Hono()
  // ==========================================================================
  // Configs
  // ==========================================================================
  .get('/whatsapp/configs', requirePermission(PERMISSIONS.WHATSAPP_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const configs = await whatsappService.getConfigs(orgId)
    return success(c, { configs: configs.map(cfg => ({ ...cfg, access_token: '***' })) })
  })
  .get('/whatsapp/configs/:id', requirePermission(PERMISSIONS.WHATSAPP_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const config = await whatsappService.getConfig(orgId, c.req.param('id'))
    if (!config) throw new AppError(404, 'Config not found')
    return success(c, { ...config, access_token: '***' })
  })
  .post('/whatsapp/configs', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), zValidator('json', CreateConfigSchema), async (c) => {
    const user = requireAuth(c)
    const orgId = getOrgId(c)
    const body = c.req.valid('json')

    const config = await whatsappService.createConfig(orgId, user.id, body)
    return success(c, { ...config, access_token: '***' }, 'WhatsApp account connected', 201)
  })
  .put('/whatsapp/configs/:id', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), zValidator('json', UpdateConfigSchema), async (c) => {
    const orgId = getOrgId(c)
    const body = c.req.valid('json')
    await whatsappService.updateConfig(orgId, c.req.param('id'), body)
    return success(c, null, 'Config updated')
  })
  .delete('/whatsapp/configs/:id', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    await whatsappService.deleteConfig(orgId, c.req.param('id'))
    return success(c, null, 'Config deleted')
  })
  // ==========================================================================
  // Templates
  // ==========================================================================
  .get('/whatsapp/templates', requirePermission(PERMISSIONS.WHATSAPP_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const configId = c.req.query('config_id')
    const templates = await whatsappService.getTemplates(orgId, configId || undefined)
    return success(c, { templates })
  })
  .post('/whatsapp/templates/sync', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), zValidator('json', SyncSchema), async (c) => {
    const orgId = getOrgId(c)
    const { config_id } = c.req.valid('json')
    const synced = await whatsappService.syncTemplates(orgId, config_id)
    return success(c, { synced }, `Synced ${synced} templates`)
  })
  .post('/whatsapp/templates', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), zValidator('json', CreateTemplateSchema), async (c) => {
    const orgId = getOrgId(c)
    const body = c.req.valid('json')
    const tpl = await whatsappService.createTemplate(orgId, body.config_id, body)
    return success(c, tpl, 'Template submitted for approval', 201)
  })
  .delete('/whatsapp/templates/:id', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), async (c) => {
    const orgId = getOrgId(c)
    await whatsappService.deleteTemplate(orgId, c.req.param('id'))
    return success(c, null, 'Template deleted')
  })
  // ==========================================================================
  // Sending
  // ==========================================================================
  .post('/whatsapp/send', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), zValidator('json', SendTemplateSchema), async (c) => {
    const orgId = getOrgId(c)
    const body = c.req.valid('json')
    const msg = await whatsappService.sendTemplate(orgId, body.config_id, body)
    return success(c, msg, 'Message sent')
  })
  .post('/whatsapp/send-text', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), zValidator('json', SendTextSchema), async (c) => {
    const orgId = getOrgId(c)
    const body = c.req.valid('json')
    const msg = await whatsappService.sendText(orgId, body.config_id, body.phone, body.text, body.contact_id)
    return success(c, msg, 'Message sent')
  })
  .post('/whatsapp/send-bulk', requirePermission(PERMISSIONS.WHATSAPP_MANAGE), zValidator('json', BulkSendSchema), async (c) => {
    const orgId = getOrgId(c)
    const body = c.req.valid('json')
    const result = await whatsappService.sendBulk(orgId, body.config_id, body.template_name, body.recipients, body.language)
    return success(c, result, `Sent ${result.sent}, failed ${result.failed}`)
  })
  // ==========================================================================
  // Messages & Stats
  // ==========================================================================
  .get('/whatsapp/messages', requirePermission(PERMISSIONS.WHATSAPP_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const filters = {
      configId: c.req.query('config_id') || undefined,
      status: c.req.query('status') || undefined,
      limit: parseInt(c.req.query('limit') || '50'),
      offset: parseInt(c.req.query('offset') || '0'),
    }
    const result = await whatsappService.getMessages(orgId, filters)
    return success(c, result)
  })
  .get('/whatsapp/stats', requirePermission(PERMISSIONS.WHATSAPP_VIEW), async (c) => {
    const orgId = getOrgId(c)
    const configId = c.req.query('config_id') || undefined
    const stats = await whatsappService.getStats(orgId, configId)
    return success(c, stats)
  })
  // ==========================================================================
  // Webhook (public — no auth). Meta verifies via hub.verify_token / signed
  // payload BEFORE the body is trusted, so these keep manual parsing rather
  // than zValidator (which would validate ahead of the verification check).
  // ==========================================================================
  .get('/whatsapp/webhook', async (c) => {
    const mode = c.req.query('hub.mode')
    const token = c.req.query('hub.verify_token')
    const challenge = c.req.query('hub.challenge')

    if (mode === 'subscribe' && token && (await whatsappService.verifyToken(token))) {
      return c.text(challenge || '', 200)
    }
    return c.text('Forbidden', 403)
  })
  .post('/whatsapp/webhook', async (c) => {
    const body = await c.req.json()
    await whatsappService.processWebhook(body)
    return c.text('OK', 200)
  })

export default whatsappRoutes
export type WhatsappRoutes = typeof whatsappRoutes
