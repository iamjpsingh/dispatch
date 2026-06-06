import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock dependencies before importing routes
vi.mock('../../src/services/campaignService', () => ({
  campaignService: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    saveDraft: vi.fn(),
    schedule: vi.fn(),
    setStatus: vi.fn(),
    setJobId: vi.fn(),
    setTotalRecipients: vi.fn(),
    clone: vi.fn(),
    getDashboardStats: vi.fn(),
    getStats: vi.fn(),
    createABVariant: vi.fn(),
    getABVariants: vi.fn(),
    declareWinner: vi.fn(),
  },
}))

vi.mock('../../src/services/templateService', () => ({
  templateService: {
    get: vi.fn(),
  },
}))

vi.mock('../../src/services/contactService', () => ({
  contactService: {
    getContacts: vi.fn(),
  },
}))

vi.mock('../../src/services/d1UserDatabase', () => ({
  d1UserDatabase: {
    getUserDefaultSMTPConfig: vi.fn(),
    getUserSMTPConfigs: vi.fn(),
  },
}))

vi.mock('../../src/services/queueEngine', () => ({
  queueEngine: {
    enqueue: vi.fn(),
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

// Bypass RBAC permission gates in route-handler unit tests.
vi.mock('../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))

import { campaignService } from '../../src/services/campaignService'
import { templateService } from '../../src/services/templateService'
import { contactService } from '../../src/services/contactService'
import { d1UserDatabase } from '../../src/services/d1UserDatabase'
import { queueEngine } from '../../src/services/queueEngine'
import campaignRoutes from '../../src/routes/campaigns'

const TEST_USER = { id: 'user-1', email: 'test@test.com', name: 'Test User' }

function createApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.user = TEST_USER as any
    c.set('orgId', 'org-1')
    await next()
  })
  app.route('/', campaignRoutes)
  app.onError((err: any, c) => {
    if (err?.name === 'AppError' && 'status' in err) {
      return c.json({ success: false, message: err.message }, err.status)
    }
    return c.json({ success: false, message: 'Internal Server Error' }, 500)
  })
  return app
}

function jsonRequest(method: string, path: string, body?: object) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) init.body = JSON.stringify(body)
  return new Request(`http://localhost${path}`, init)
}

const SAMPLE_CAMPAIGN = {
  id: 'camp-1',
  name: 'Test Campaign',
  subject: 'Hello World',
  from_email: 'sender@example.com',
  from_name: 'Sender',
  status: 'draft',
  type: 'regular',
  created_at: '2025-01-01T00:00:00Z',
}

// A campaign in a launchable state with content + recipients wired up.
const LAUNCHABLE_CAMPAIGN = {
  ...SAMPLE_CAMPAIGN,
  status: 'draft',
  template_id: 'tpl-1',
  list_id: 'list-1',
  config_id: 'cfg-1',
  batch_size: 20,
  email_delay: 45,
  batch_delay: 60,
}

const DEFAULT_SMTP_CONFIG = {
  id: 'cfg-1',
  user_id: 'user-1',
  name: 'Primary SMTP',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  username: 'smtp-user',
  password: 'smtp-pass',
  from_email: 'sender@example.com',
  from_name: 'Sender',
  provider_type: 'smtp',
  is_default: true,
  created_at: '2025-01-01T00:00:00Z',
}

describe('Campaign Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // GET /campaigns
  // ==========================================================================
  describe('GET /campaigns', () => {
    it('returns a paginated list of campaigns', async () => {
      const app = createApp()
      vi.mocked(campaignService.list).mockReturnValue({
        campaigns: [SAMPLE_CAMPAIGN],
        total: 1,
      })

      const res = await app.fetch(new Request('http://localhost/campaigns'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.meta.pagination.total).toBe(1)
      expect(body.meta.pagination.page).toBe(1)
    })

    it('passes filter params to the service', async () => {
      const app = createApp()
      vi.mocked(campaignService.list).mockReturnValue({ campaigns: [], total: 0 })

      await app.fetch(new Request('http://localhost/campaigns?status=draft&type=regular&search=hello&page=2&limit=10'))

      expect(campaignService.list).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          status: 'draft',
          type: 'regular',
          search: 'hello',
          page: 2,
          limit: 10,
        })
      )
    })

    it('returns empty array when no campaigns exist', async () => {
      const app = createApp()
      vi.mocked(campaignService.list).mockReturnValue({ campaigns: [], total: 0 })

      const res = await app.fetch(new Request('http://localhost/campaigns'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toEqual([])
      expect(body.meta.pagination.total).toBe(0)
    })
  })

  // ==========================================================================
  // POST /campaigns
  // ==========================================================================
  describe('POST /campaigns', () => {
    const validPayload = {
      name: 'New Campaign',
      subject: 'Hello',
      from_email: 'sender@example.com',
      from_name: 'Sender',
    }

    it('creates a new campaign', async () => {
      const app = createApp()
      vi.mocked(campaignService.create).mockReturnValue({
        ...SAMPLE_CAMPAIGN,
        id: 'camp-new',
      })

      const res = await app.fetch(jsonRequest('POST', '/campaigns', validPayload))

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('camp-new')
      expect(body.message).toBe('Campaign created')
    })

    it('returns 400 when name is missing', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/campaigns', {
          subject: 'Hello',
          from_email: 'a@b.com',
          from_name: 'Sender',
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('name')
    })

    it('returns 400 when subject is missing', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/campaigns', {
          name: 'Campaign',
          from_email: 'a@b.com',
          from_name: 'Sender',
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 400 when from_email is missing', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/campaigns', {
          name: 'Campaign',
          subject: 'Hello',
          from_name: 'Sender',
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 400 when from_name is missing', async () => {
      const app = createApp()

      const res = await app.fetch(
        jsonRequest('POST', '/campaigns', {
          name: 'Campaign',
          subject: 'Hello',
          from_email: 'a@b.com',
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // GET /campaigns/:id
  // ==========================================================================
  describe('GET /campaigns/:id', () => {
    it('returns a specific campaign', async () => {
      const app = createApp()
      vi.mocked(campaignService.get).mockReturnValue(SAMPLE_CAMPAIGN)

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('camp-1')
    })

    it('returns 404 when campaign not found', async () => {
      const app = createApp()
      vi.mocked(campaignService.get).mockReturnValue(null)

      const res = await app.fetch(new Request('http://localhost/campaigns/nonexistent'))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('not found')
    })
  })

  // ==========================================================================
  // PUT /campaigns/:id
  // ==========================================================================
  describe('PUT /campaigns/:id', () => {
    it('updates a campaign', async () => {
      const app = createApp()
      vi.mocked(campaignService.update).mockReturnValue(true)

      const res = await app.fetch(jsonRequest('PUT', '/campaigns/camp-1', { name: 'Updated Campaign' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('updated')
    })

    it('returns 404 when campaign not found or cannot be edited', async () => {
      const app = createApp()
      vi.mocked(campaignService.update).mockReturnValue(false)

      const res = await app.fetch(jsonRequest('PUT', '/campaigns/nonexistent', { name: 'X' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // DELETE /campaigns/:id
  // ==========================================================================
  describe('DELETE /campaigns/:id', () => {
    it('deletes a campaign', async () => {
      const app = createApp()
      vi.mocked(campaignService.delete).mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1', { method: 'DELETE' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('deleted')
    })

    it('returns 404 when campaign not found', async () => {
      const app = createApp()
      vi.mocked(campaignService.delete).mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/campaigns/nonexistent', { method: 'DELETE' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // Campaign Lifecycle
  // ==========================================================================
  describe('POST /campaigns/:id/draft', () => {
    it('saves a draft', async () => {
      const app = createApp()
      vi.mocked(campaignService.saveDraft).mockReturnValue(true)

      const res = await app.fetch(jsonRequest('POST', '/campaigns/camp-1/draft', { html_content: '<p>Hi</p>' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('Draft saved')
    })

    it('returns 404 when campaign not found', async () => {
      const app = createApp()
      vi.mocked(campaignService.saveDraft).mockReturnValue(false)

      const res = await app.fetch(jsonRequest('POST', '/campaigns/nonexistent/draft', {}))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('POST /campaigns/:id/schedule', () => {
    it('schedules a campaign', async () => {
      const app = createApp()
      vi.mocked(campaignService.schedule).mockReturnValue(true)

      const res = await app.fetch(
        jsonRequest('POST', '/campaigns/camp-1/schedule', {
          scheduled_at: '2025-06-01T12:00:00Z',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('scheduled')
    })

    it('returns 400 when scheduled_at is missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/campaigns/camp-1/schedule', {}))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('scheduled_at')
    })

    it('returns 404 when campaign is not found or wrong status', async () => {
      const app = createApp()
      vi.mocked(campaignService.schedule).mockReturnValue(false)

      const res = await app.fetch(
        jsonRequest('POST', '/campaigns/camp-1/schedule', {
          scheduled_at: '2025-06-01T12:00:00Z',
        })
      )

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('POST /campaigns/:id/launch', () => {
    function wireLaunchableCampaign() {
      vi.mocked(campaignService.get).mockReturnValue(LAUNCHABLE_CAMPAIGN as any)
      vi.mocked(templateService.get).mockReturnValue({
        id: 'tpl-1',
        html_content: '<p>Hello {{FirstName}}</p>',
      } as any)
      vi.mocked(contactService.getContacts).mockReturnValue({
        contacts: [
          { id: 'con-1', email: 'recipient@example.com', first_name: 'Jane', last_name: 'Doe', company: 'Acme' },
        ],
        total: 1,
      } as any)
      vi.mocked(d1UserDatabase.getUserSMTPConfigs).mockResolvedValue([DEFAULT_SMTP_CONFIG] as any)
      vi.mocked(d1UserDatabase.getUserDefaultSMTPConfig).mockResolvedValue(DEFAULT_SMTP_CONFIG as any)
      vi.mocked(queueEngine.enqueue).mockReturnValue('job-x')
      vi.mocked(campaignService.setStatus).mockReturnValue(true)
    }

    it('enqueues a send job for the campaign recipients, links the job, and marks it sending', async () => {
      const app = createApp()
      wireLaunchableCampaign()

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1/launch', { method: 'POST' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('launched')
      expect(body.data.jobId).toBe('job-x')
      expect(body.data.recipientCount).toBe(1)

      // Enqueued with the right user, an email config, the recipient, and campaign-linked options.
      expect(queueEngine.enqueue).toHaveBeenCalledTimes(1)
      const [userId, emailConfig, contacts, options] = vi.mocked(queueEngine.enqueue).mock.calls[0]
      expect(userId).toBe('user-1')
      expect(emailConfig).toMatchObject({ host: 'smtp.example.com', auth: { user: 'smtp-user' } })
      expect(contacts).toEqual([
        expect.objectContaining({ Email: 'recipient@example.com', FirstName: 'Jane' }),
      ])
      expect(options).toMatchObject({ campaignId: 'camp-1', subject: 'Hello World' })

      // Job is linked to the campaign and status flipped to sending.
      expect(campaignService.setJobId).toHaveBeenCalledWith('camp-1', 'job-x')
      expect(campaignService.setStatus).toHaveBeenCalledWith('org-1', 'camp-1', 'sending')
    })

    it('returns 400 when the campaign has no recipients', async () => {
      const app = createApp()
      wireLaunchableCampaign()
      vi.mocked(contactService.getContacts).mockReturnValue({ contacts: [], total: 0 } as any)

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1/launch', { method: 'POST' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('recipients')
      expect(queueEngine.enqueue).not.toHaveBeenCalled()
      expect(campaignService.setStatus).not.toHaveBeenCalledWith('org-1', 'camp-1', 'sending')
    })

    it('returns 400 when no email configuration exists', async () => {
      const app = createApp()
      wireLaunchableCampaign()
      vi.mocked(d1UserDatabase.getUserSMTPConfigs).mockResolvedValue([])
      vi.mocked(d1UserDatabase.getUserDefaultSMTPConfig).mockResolvedValue(null)

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1/launch', { method: 'POST' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('configuration')
      expect(queueEngine.enqueue).not.toHaveBeenCalled()
    })

    it('returns 404 when campaign not found', async () => {
      const app = createApp()
      vi.mocked(campaignService.get).mockReturnValue(null)

      const res = await app.fetch(new Request('http://localhost/campaigns/nonexistent/launch', { method: 'POST' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('POST /campaigns/:id/pause', () => {
    it('pauses a campaign', async () => {
      const app = createApp()
      vi.mocked(campaignService.setStatus).mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1/pause', { method: 'POST' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('paused')
    })
  })

  describe('POST /campaigns/:id/cancel', () => {
    it('cancels a campaign', async () => {
      const app = createApp()
      vi.mocked(campaignService.setStatus).mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1/cancel', { method: 'POST' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('cancelled')
    })
  })

  describe('POST /campaigns/:id/clone', () => {
    it('clones a campaign', async () => {
      const app = createApp()
      vi.mocked(campaignService.clone).mockReturnValue({
        ...SAMPLE_CAMPAIGN,
        id: 'camp-clone',
        name: 'Test Campaign (Copy)',
      })

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1/clone', { method: 'POST' }))

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('camp-clone')
    })

    it('returns 404 when campaign not found', async () => {
      const app = createApp()
      vi.mocked(campaignService.clone).mockReturnValue(null)

      const res = await app.fetch(new Request('http://localhost/campaigns/nonexistent/clone', { method: 'POST' }))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('POST /campaigns/:id/archive', () => {
    it('archives a campaign', async () => {
      const app = createApp()
      vi.mocked(campaignService.setStatus).mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1/archive', { method: 'POST' }))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('archived')
    })
  })

  // ==========================================================================
  // Campaign Stats
  // ==========================================================================
  describe('GET /campaigns/:id/stats', () => {
    it('returns campaign statistics', async () => {
      const app = createApp()
      vi.mocked(campaignService.getStats).mockReturnValue({
        total_recipients: 100,
        sent_count: 90,
        failed_count: 5,
        open_count: 40,
        click_count: 10,
        bounce_count: 3,
        unsubscribe_count: 1,
      })

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1/stats'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.total_recipients).toBe(100)
      expect(body.data.sent).toBe(90)
      expect(body.data.open_rate).toBeGreaterThan(0)
      expect(body.data.click_rate).toBeGreaterThan(0)
    })

    it('returns 404 when campaign not found', async () => {
      const app = createApp()
      vi.mocked(campaignService.getStats).mockReturnValue(null)

      const res = await app.fetch(new Request('http://localhost/campaigns/nonexistent/stats'))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // A/B Testing
  // ==========================================================================
  describe('POST /campaigns/:id/ab/variant', () => {
    it('creates an A/B variant', async () => {
      const app = createApp()
      vi.mocked(campaignService.get).mockReturnValue(SAMPLE_CAMPAIGN)
      vi.mocked(campaignService.createABVariant).mockReturnValue({
        id: 'var-1',
        label: 'A',
        percentage: 50,
      })

      const res = await app.fetch(
        jsonRequest('POST', '/campaigns/camp-1/ab/variant', {
          label: 'A',
          percentage: 50,
          subject: 'Test A',
        })
      )

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('var-1')
    })

    it('returns 404 when campaign not found', async () => {
      const app = createApp()
      vi.mocked(campaignService.get).mockReturnValue(null)

      const res = await app.fetch(
        jsonRequest('POST', '/campaigns/nonexistent/ab/variant', {
          label: 'A',
        })
      )

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('GET /campaigns/:id/ab/variants', () => {
    it('returns A/B variants', async () => {
      const app = createApp()
      vi.mocked(campaignService.get).mockReturnValue(SAMPLE_CAMPAIGN)
      vi.mocked(campaignService.getABVariants).mockReturnValue([
        { id: 'var-1', label: 'A' },
        { id: 'var-2', label: 'B' },
      ])

      const res = await app.fetch(new Request('http://localhost/campaigns/camp-1/ab/variants'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.variants).toHaveLength(2)
    })

    it('returns 404 when campaign not found', async () => {
      const app = createApp()
      vi.mocked(campaignService.get).mockReturnValue(null)

      const res = await app.fetch(new Request('http://localhost/campaigns/nonexistent/ab/variants'))

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  describe('POST /campaigns/:id/ab/winner', () => {
    it('declares an A/B winner', async () => {
      const app = createApp()
      vi.mocked(campaignService.declareWinner).mockReturnValue(true)

      const res = await app.fetch(
        jsonRequest('POST', '/campaigns/camp-1/ab/winner', {
          variant_id: 'var-1',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.message).toContain('Winner')
    })

    it('returns 400 when variant_id is missing', async () => {
      const app = createApp()

      const res = await app.fetch(jsonRequest('POST', '/campaigns/camp-1/ab/winner', {}))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 404 when variant not found', async () => {
      const app = createApp()
      vi.mocked(campaignService.declareWinner).mockReturnValue(false)

      const res = await app.fetch(
        jsonRequest('POST', '/campaigns/camp-1/ab/winner', {
          variant_id: 'nonexistent',
        })
      )

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // ==========================================================================
  // Dashboard Stats
  // ==========================================================================
  describe('GET /campaigns/dashboard', () => {
    it('returns campaign dashboard stats', async () => {
      const app = createApp()
      vi.mocked(campaignService.getDashboardStats).mockReturnValue({
        total: 10,
        draft: 3,
        sending: 2,
        completed: 5,
      })

      const res = await app.fetch(new Request('http://localhost/campaigns/dashboard'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.total).toBe(10)
    })
  })
})
