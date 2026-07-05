/**
 * Send Routes
 * Email sending, batch processing, scheduling
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { schedulerService } from '../services/schedulerService'
import { notificationService } from '../services/notificationService'
import { queueEngine } from '../services/queueEngine'
import { ProviderDetection } from '../services/providerLimits'
import { FileService } from '../services/fileService'
import { requireAuth, getOrgId, type User } from '../middleware/auth'
import { requirePermission } from '../middleware/rbac'
import { PERMISSIONS } from '../services/rbacService'
import { success, error } from '../utils/response'
import { parseIntSafe } from '../utils/validation'
import { logger } from '../utils/logger'
import { scanForSpam } from '../services/spamScanner'
import type { EmailJob, BatchConfig, Contact, EmailConfig } from '../types/index'
import { auditFromContext } from '../services/audit/context'

import {
  type UserSMTPConfig,
  getUserConfig,
  validateSendRequest,
  testConnection,
  buildEmailConfig,
  processExcelFile,
  checkProviderLimits,
  processHtmlTemplate,
  sendBulkOAuthEmails,
} from '../services/sendHelpers'

// ============================================================================
// Handler Parameter Types
// ============================================================================

interface ScheduledSendParams {
  user: User
  userConfig: UserSMTPConfig
  contacts: Contact[]
  subject: string
  htmlContent: string
  emailConfig: EmailConfig
  useBatch: boolean
  batchSize: number
  batchDelay: number
  emailDelay: number
  delay: number
  scheduledTime: string
  notifyEmail: string
  notifyBrowser: boolean
  fromEmail: string
  fromName: string
}

interface OAuthSendParams {
  user: User
  userConfig: UserSMTPConfig
  contacts: Contact[]
  subject: string
  htmlContent: string
  useBatch: boolean
  emailDelay: number
  delay: number
}

interface SmtpSendParams {
  user: User
  userConfig: UserSMTPConfig
  contacts: Contact[]
  subject: string
  htmlContent: string
  emailConfig: EmailConfig
  useBatch: boolean
  batchSize: number
  batchDelay: number
  emailDelay: number
  delay: number
  notifyEmail: string
  fromEmail: string
  fromName: string
}

// ============================================================================
// Main Send Endpoint
// ============================================================================

/**
 * Send emails
 * POST /send
 */
const sendRoutes = new Hono()
  .post('/send', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  try {
    const user = requireAuth(c)
    logger.debug(`Send request from user: ${user.email}`)

    const formData = await c.req.formData()

    // Get user configuration
    const userConfig = await getUserConfig(user.id, formData.get('configId') as string)
    if (!userConfig) {
      return error(c, 'No SMTP configuration found. Please add an SMTP configuration first.', 400)
    }

    logger.debug(`Using config: ${userConfig.name} (${userConfig.provider_type || 'smtp'})`)

    const isOAuthConfig = userConfig.provider_type === 'google' || userConfig.provider_type === 'microsoft'

    // Extract form data
    const subject = (formData.get('subject') as string) || ''
    const htmlContent = (formData.get('htmlContent') as string) || ''
    const delay = parseIntSafe(formData.get('delay') as string, 20)

    // Batch processing
    const useBatch = formData.get('useBatch') === 'on'
    const batchSize = parseIntSafe(formData.get('batchSize') as string, 20)
    const batchDelay = parseIntSafe(formData.get('batchDelay') as string, 60)
    const emailDelay = parseIntSafe(formData.get('emailDelay') as string, 45)

    // Scheduling
    const scheduleEmail = formData.get('scheduleEmail') === 'on'
    const scheduledTime = formData.get('scheduledTime') as string
    const notifyEmail = formData.get('notifyEmail') as string
    const notifyBrowser = formData.get('notifyBrowser') === 'on'

    const excelFile = formData.get('excelFile') as File
    const htmlTemplateFile = formData.get('htmlTemplate') as File

    // Validate required fields
    const validationError = validateSendRequest(userConfig, isOAuthConfig, subject, scheduleEmail, scheduledTime)
    if (validationError) {
      return error(c, validationError, 400)
    }

    if (!excelFile || excelFile.size === 0) {
      return error(c, 'Excel file is required', 400)
    }

    // Validate content
    if (!htmlTemplateFile || htmlTemplateFile.size === 0) {
      if (!htmlContent || htmlContent.trim() === '' || htmlContent === '<p><br></p>') {
        return error(c, 'Email content is required (either in editor or upload HTML template)', 400)
      }
    }

    // Test connection
    const connectionError = await testConnection(userConfig, isOAuthConfig, user.id)
    if (connectionError) {
      return error(c, connectionError, 400)
    }

    // Process Excel file
    const contactsResult = await processExcelFile(excelFile, formData)
    if ('error' in contactsResult) {
      return error(c, contactsResult.error, 400)
    }
    const contacts = contactsResult.contacts

    // Check provider limits
    const limitError = checkProviderLimits(userConfig, isOAuthConfig, contacts.length, !!notifyEmail)
    if (limitError) {
      return error(c, limitError, 400)
    }

    // Process HTML template
    const finalHtmlContent = await processHtmlTemplate(htmlTemplateFile, htmlContent)
    if ('error' in finalHtmlContent) {
      return error(c, finalHtmlContent.error, 400)
    }

    // Spam content pre-scan
    const spamScan = scanForSpam(subject, typeof finalHtmlContent === 'string' ? finalHtmlContent : finalHtmlContent.html)
    // Return warnings to frontend but don't block sending (user decides)

    // Build email config
    const emailConfig = isOAuthConfig ? null : buildEmailConfig(userConfig)
    const fromEmail = userConfig.from_email || userConfig.oauth_email || ''
    const fromName = userConfig.from_name || userConfig.name || ''

    // Handle scheduling vs immediate sending
    if (scheduleEmail) {
      if (isOAuthConfig) {
        return error(
          c,
          'Scheduled sending is not yet supported for OAuth accounts. Please send immediately or use SMTP.',
          400
        )
      }

      return handleScheduledSend(c, {
        user,
        userConfig,
        contacts,
        subject,
        htmlContent: finalHtmlContent.content,
        emailConfig: emailConfig!,
        useBatch,
        batchSize,
        batchDelay,
        emailDelay,
        delay,
        scheduledTime,
        notifyEmail,
        notifyBrowser,
        fromEmail,
        fromName,
      })
    }

    // Immediate sending
    if (isOAuthConfig) {
      return handleOAuthSend(c, {
        user,
        userConfig,
        contacts,
        subject,
        htmlContent: finalHtmlContent.content,
        useBatch,
        emailDelay,
        delay,
      })
    }

    return handleSmtpSend(c, {
      user,
      userConfig,
      contacts,
      subject,
      htmlContent: finalHtmlContent.content,
      emailConfig: emailConfig!,
      useBatch,
      batchSize,
      batchDelay,
      emailDelay,
      delay,
      notifyEmail,
      fromEmail,
      fromName,
    })
  } catch (err) {
    logger.error('Send endpoint error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error occurred'
    return error(c, `Server error: ${message}`, 500)
  }
})

// ============================================================================
// Spam Scanner Endpoint
// ============================================================================

/**
 * Pre-scan email content for spam indicators
 * POST /send/spam-check
 */
  .post('/send/spam-check', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const body = await c.req.json()
  const result = scanForSpam(body.subject || '', body.html || '')
  return success(c, result)
})

// ============================================================================
// Supporting Endpoints
// ============================================================================

/**
 * Test notification
 * POST /test-notification
 */
  .post('/test-notification', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  try {
    const user = requireAuth(c)
    const body = await c.req.json()
    const { testEmail } = body

    if (!testEmail) {
      return error(c, 'Test email required', 400)
    }

    const sent = await notificationService.sendTestNotification(user.id, testEmail)
    return success(c, { sent }, sent ? '✅ Test notification sent successfully' : '❌ Failed to send test notification')
  } catch (err) {
    logger.error('Test notification error:', err)
    return error(c, 'Failed to send test notification', 500)
  }
})

/**
 * Get provider info
 * POST /provider-info
 */
  .post('/provider-info', async (c) => {
  try {
    const formData = await c.req.formData()
    const smtpHost = (formData.get('smtpHost') as string) || ''
    const hasNotification = (formData.get('hasNotification') as string) === 'true'

    if (!smtpHost) {
      return error(c, 'SMTP host required', 400)
    }

    const provider = ProviderDetection.detectProvider(smtpHost)
    const maxContacts = ProviderDetection.calculateMaxContacts(smtpHost, hasNotification)

    return success(c, {
      provider: provider.name,
      dailyLimit: provider.dailyLimit,
      maxContacts,
      recommendedBatchSize: provider.recommendedBatchSize,
      recommendedDelay: provider.recommendedDelay,
    })
  } catch (err) {
    return error(c, 'Failed to detect provider', 500)
  }
})

/**
 * Parse Excel file
 * POST /parse-excel
 */
  .post('/parse-excel', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  try {
    const formData = await c.req.formData()
    const excelFile = formData.get('excelFile') as File

    if (!excelFile || excelFile.size === 0) {
      return error(c, 'Excel file is required', 400)
    }

    const contacts = await FileService.parseExcelBuffer(new Uint8Array(await excelFile.arrayBuffer()))

    return success(c, {
      contacts: contacts.slice(0, 5),
      totalCount: contacts.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse Excel file'
    return error(c, message, 500)
  }
})

// ============================================================================
// Scheduled Jobs
// ============================================================================

  .get('/scheduled-jobs', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const jobs = await schedulerService.getScheduledJobs()
  return success(c, jobs)
  })
  .delete('/scheduled-jobs/:id', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const jobId = c.req.param('id')
  const cancelled = await schedulerService.cancelScheduledJob(jobId)

  if (cancelled) {
    auditFromContext(c, { action: 'job.cancelled', entityType: 'job', entityId: jobId })
    return success(c, undefined, 'Scheduled job cancelled')
  }
  return error(c, 'Job not found or cannot be cancelled', 404)
  })
  // ==========================================================================
  // Batch Control (delegates to queue engine, legacy endpoints preserved)
  // ==========================================================================
  .get('/batch-status', requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), async (c) => {
  const user = requireAuth(c)
  const activeIds = await queueEngine.getActiveJobIds()
  const runningJobs = await queueEngine.getJobs(user.id, 'running', 5)

  // Map to legacy BatchStatus format for backward compatibility
  const currentJob = runningJobs[0] || null
  return success(c, {
    isRunning: runningJobs.length > 0,
    currentJob: currentJob
      ? {
          id: currentJob.id,
          totalContacts: currentJob.total_count,
          currentBatch: Math.ceil(currentJob.last_processed_index / (currentJob.batch_size || 20)),
          totalBatches: Math.ceil(currentJob.total_count / (currentJob.batch_size || 20)),
          emailsSent: currentJob.sent_count,
          emailsFailed: currentJob.failed_count,
          status: currentJob.status === 'running' ? 'Running' : currentJob.status,
          nextBatchTime: undefined,
        }
      : null,
    totalJobs: runningJobs.length + activeIds.length,
    completedJobs: 0,
  })
  })
  .post('/batch-pause', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const user = requireAuth(c)
  const runningJobs = await queueEngine.getJobs(user.id, 'running', 1)
  let count = 0
  if (runningJobs.length > 0) {
    await queueEngine.pause(runningJobs[0].id)
    count = 1
  }
  auditFromContext(c, { action: 'job.paused', entityType: 'job', metadata: { count } })
  return success(c, undefined, 'Job paused')
  })
  .post('/batch-resume', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const user = requireAuth(c)
  const pausedJobs = await queueEngine.getJobs(user.id, 'paused', 1)
  let count = 0
  if (pausedJobs.length > 0) {
    await queueEngine.resume(pausedJobs[0].id)
    count = 1
  }
  auditFromContext(c, { action: 'job.resumed', entityType: 'job', metadata: { count } })
  return success(c, undefined, 'Job resumed')
  })
  .delete('/batch-cancel', requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (c) => {
  const user = requireAuth(c)
  const runningJobs = await queueEngine.getJobs(user.id, 'running', 1)
  let count = 0
  if (runningJobs.length > 0) {
    await queueEngine.cancel(runningJobs[0].id)
    count = 1
  }
  auditFromContext(c, { action: 'job.cancelled', entityType: 'job', metadata: { count } })
  return success(c, undefined, 'Job cancelled')
  })

// ============================================================================
// Send Handlers
// ============================================================================

async function handleScheduledSend(c: Context, params: ScheduledSendParams) {
  const {
    user,
    userConfig,
    contacts,
    subject,
    htmlContent,
    emailConfig,
    useBatch,
    batchSize,
    batchDelay,
    emailDelay,
    delay,
    scheduledTime,
    notifyEmail,
    notifyBrowser,
    fromEmail,
    fromName,
  } = params

  const scheduledDate = new Date(scheduledTime)
  if (scheduledDate <= new Date()) {
    return error(c, 'Scheduled time must be in the future', 400)
  }

  const batchConfig: BatchConfig | null = useBatch ? { batchSize, emailDelay, batchDelay, enabled: true } : null

  const emailJob: EmailJob = {
    contacts,
    htmlContent,
    subject: subject.trim(),
    fromEmail,
    fromName,
    config: emailConfig,
    delay: useBatch ? emailDelay : delay,
  }

  const jobId = await schedulerService.scheduleJob(
    user.id,
    getOrgId(c),
    emailJob,
    batchConfig,
    scheduledDate,
    userConfig.name,
    notifyEmail,
    notifyBrowser
  )

  logger.info(`Email campaign scheduled: ${jobId} for user ${user.email}`)

  return success(
    c,
    {
      jobId,
      scheduledTime: scheduledDate.toISOString(),
      contactCount: contacts.length,
      scheduledMode: true,
      batchMode: useBatch,
      configUsed: userConfig.name,
    },
    `📅 Email campaign scheduled for ${scheduledDate.toLocaleString()}`
  )
}

async function handleOAuthSend(c: Context, params: OAuthSendParams) {
  const { user, userConfig, contacts, subject, htmlContent, useBatch, emailDelay, delay } = params

  logger.info(`Starting OAuth email job: ${contacts.length} contacts via ${userConfig.provider_type}`)

  const delayMs = useBatch ? emailDelay * 1000 : delay * 1000

  // Send in background
  sendBulkOAuthEmails(userConfig, user.id, contacts, subject.trim(), htmlContent, delayMs)
    .then((result) => {
      logger.info(`OAuth send complete: ${result.sent} sent, ${result.failed} failed`)
    })
    .catch((err) => {
      logger.error('OAuth bulk email sending failed:', err)
    })

  return success(
    c,
    {
      contactCount: contacts.length,
      configUsed: userConfig.name,
      provider: userConfig.provider_type,
    },
    `Email sending started for ${contacts.length} contacts via ${userConfig.provider_type === 'google' ? 'Gmail' : 'Outlook'}`
  )
}

async function handleSmtpSend(c: Context, params: SmtpSendParams) {
  const {
    user,
    userConfig,
    contacts,
    subject,
    htmlContent,
    emailConfig,
    useBatch,
    batchSize,
    batchDelay,
    emailDelay,
    delay,
    notifyEmail,
    fromEmail,
    fromName,
  } = params

  // Enqueue to the persistent BullMQ send queue
  const jobId = await queueEngine.enqueue(user.id, emailConfig, contacts, {
    type: useBatch ? 'batch' : 'direct',
    orgId: getOrgId(c),
    htmlContent,
    subject: subject.trim(),
    fromEmail,
    fromName,
    configId: userConfig.id,
    configName: userConfig.name,
    notifyEmail: notifyEmail || undefined,
    batchSize: useBatch ? batchSize : contacts.length,
    emailDelaySec: useBatch ? emailDelay : delay,
    batchDelayMin: useBatch ? batchDelay : 0,
    priority: 5,
  })

  logger.info(`Job ${jobId} enqueued: ${contacts.length} contacts (${useBatch ? 'batch' : 'direct'} mode)`)

  auditFromContext(c, { action: 'send.enqueued', entityType: 'send', entityId: jobId, metadata: { count: contacts.length } })

  if (useBatch) {
    return success(
      c,
      {
        jobId,
        contactCount: contacts.length,
        batchMode: true,
        batchConfig: { batchSize, emailDelay, batchDelay, enabled: true },
        configUsed: userConfig.name,
      },
      `Job queued! ${contacts.length} contacts in batches of ${batchSize}.`
    )
  }

  return success(
    c,
    {
      jobId,
      contactCount: contacts.length,
      configUsed: userConfig.name,
    },
    `Job queued for ${contacts.length} contacts`
  )
}

export default sendRoutes
export type SendRoutes = typeof sendRoutes
