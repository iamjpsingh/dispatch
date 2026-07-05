// Behavioral spot-tests — campaigns routes fire the right audit/activity action on the
// success path, and the conditional check-winner call fires ONLY on the declareWinner path.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../../../src/middleware/rbac', () => ({
  requirePermission: () => (_c: any, next: any) => next(),
  requireAnyPermission: () => (_c: any, next: any) => next(),
  requireOrgMember: () => (_c: any, next: any) => next(),
  requirePlatformAdmin: () => (_c: any, next: any) => next(),
}))
vi.mock('../../../src/utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }))

vi.mock('../../../src/services/campaignService', () => ({
  campaignService: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    schedule: vi.fn(),
    setStatus: vi.fn(),
    setJobId: vi.fn(),
    setTotalRecipients: vi.fn(),
    clone: vi.fn(),
    createABVariant: vi.fn(),
    getABVariants: vi.fn(),
    declareWinner: vi.fn(),
  },
}))
vi.mock('../../../src/services/templateService', () => ({ templateService: { get: vi.fn() } }))
vi.mock('../../../src/services/contactService', () => ({ contactService: { getContacts: vi.fn() } }))
vi.mock('../../../src/services/d1UserDatabase', () => ({
  d1UserDatabase: { getUserDefaultSMTPConfig: vi.fn(), getUserSMTPConfigs: vi.fn() },
}))
vi.mock('../../../src/services/queueEngine', () => ({ queueEngine: { enqueue: vi.fn() } }))
vi.mock('../../../src/services/orgService', () => ({ orgService: { get: vi.fn() } }))
vi.mock('../../../src/services/analyticsService', () => ({ analyticsService: { getCampaignReport: vi.fn() } }))

import { auditService } from '../../../src/services/auditService'
import { campaignService } from '../../../src/services/campaignService'
import { templateService } from '../../../src/services/templateService'
import { contactService } from '../../../src/services/contactService'
import { d1UserDatabase } from '../../../src/services/d1UserDatabase'
import { queueEngine } from '../../../src/services/queueEngine'
import { orgService } from '../../../src/services/orgService'
import { analyticsService } from '../../../src/services/analyticsService'
import campaignsRoutes from '../../../src/routes/campaigns'

function appFor() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.user = { id: 'u1', email: 'u@t.co' } as any
    c.set('orgId', 'org1')
    await next()
  })
  app.route('/', campaignsRoutes)
  app.onError((_e, c) => c.json({ success: false }, 500))
  return app
}

const json = (m: string, p: string, b?: object) =>
  new Request(`http://localhost${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  })

const LAUNCHABLE_CAMPAIGN = {
  id: 'camp-1',
  status: 'draft',
  subject: 'Hello',
  from_email: 'sender@example.com',
  from_name: 'Sender',
  template_id: 'tpl-1',
  list_id: 'list-1',
  config_id: 'cfg-1',
  batch_size: 20,
  email_delay: 45,
  batch_delay: 60,
}

const SMTP_CONFIG = {
  id: 'cfg-1',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  username: 'smtp-user',
  password: 'smtp-pass',
  name: 'Primary',
}

function abCampaign(sentHoursAgo: number, afterHours: number) {
  return {
    id: 'camp-1',
    type: 'ab_test',
    ab_config: JSON.stringify({ auto_winner: true, winner_metric: 'open_rate', auto_winner_after_hours: afterHours }),
    sent_at: new Date(Date.now() - sentHoursAgo * 3600_000).toISOString(),
  }
}

describe('campaigns audit wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(auditService, 'log').mockResolvedValue()
    vi.spyOn(auditService, 'logActivity').mockResolvedValue()
  })

  it('launch fires campaign.launched (audit) + campaign.sent (activity)', async () => {
    vi.mocked(campaignService.get).mockReturnValue(LAUNCHABLE_CAMPAIGN as any)
    vi.mocked(orgService.get).mockResolvedValue({ postal_address: '123 Test St, City, ST' } as any)
    vi.mocked(templateService.get).mockReturnValue({ id: 'tpl-1', html_content: '<p>Hi</p>' } as any)
    vi.mocked(contactService.getContacts).mockReturnValue({
      contacts: [{ id: 'con-1', email: 'r@example.com', first_name: 'Jane', last_name: 'Doe', company: 'Acme' }],
      total: 1,
    } as any)
    vi.mocked(d1UserDatabase.getUserSMTPConfigs).mockResolvedValue([SMTP_CONFIG] as any)
    vi.mocked(d1UserDatabase.getUserDefaultSMTPConfig).mockResolvedValue(SMTP_CONFIG as any)
    vi.mocked(queueEngine.enqueue).mockReturnValue('job-x' as any)
    vi.mocked(campaignService.setStatus).mockReturnValue(true as any)

    const res = await appFor().fetch(json('POST', '/campaigns/camp-1/launch'))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campaign.launched', entityType: 'campaign', entityId: 'camp-1', actorId: 'u1', orgId: 'org1' })
    )
    expect(auditService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campaign.sent', entityType: 'campaign', entityId: 'camp-1' })
    )
  })

  it('delete fires campaign.deleted', async () => {
    vi.mocked(campaignService.delete).mockReturnValue(true as any)

    const res = await appFor().fetch(json('DELETE', '/campaigns/camp-1'))

    expect(res.status).toBe(200)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campaign.deleted', entityType: 'campaign', entityId: 'camp-1' })
    )
    expect(auditService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campaign.deleted', entityType: 'campaign', entityId: 'camp-1' })
    )
  })

  it('clone fires campaign.cloned (audit) + campaign.created (activity) on the new clone id', async () => {
    vi.mocked(campaignService.clone).mockReturnValue({ id: 'camp-clone', name: 'Copy' } as any)

    const res = await appFor().fetch(json('POST', '/campaigns/camp-1/clone'))

    expect(res.status).toBe(201)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campaign.cloned', entityType: 'campaign', entityId: 'camp-clone' })
    )
    expect(auditService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campaign.created', entityType: 'campaign', entityId: 'camp-clone' })
    )
  })

  it('check-winner fires campaign.ab_winner_declared on the winner-declared path', async () => {
    vi.mocked(campaignService.get).mockReturnValue(abCampaign(5, 1) as any)
    vi.mocked(campaignService.getABVariants).mockReturnValue([
      { id: 'v1', percentage: 50, is_winner: false, variant_label: 'A' },
      { id: 'v2', percentage: 50, is_winner: false, variant_label: 'B' },
    ] as any)
    vi.mocked(analyticsService.getCampaignReport).mockResolvedValue({} as any)
    vi.mocked(campaignService.declareWinner).mockReturnValue(true as any)

    const res = await appFor().fetch(json('POST', '/campaigns/camp-1/ab/check-winner'))

    expect(res.status).toBe(200)
    expect(campaignService.declareWinner).toHaveBeenCalledWith('camp-1', expect.any(String))
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campaign.ab_winner_declared', entityType: 'campaign', entityId: 'camp-1' })
    )
  })

  it('check-winner fires NOTHING on the already-declared early return', async () => {
    vi.mocked(campaignService.get).mockReturnValue(abCampaign(5, 1) as any)
    vi.mocked(campaignService.getABVariants).mockReturnValue([
      { id: 'v1', percentage: 50, is_winner: true, variant_label: 'A' },
      { id: 'v2', percentage: 50, is_winner: false, variant_label: 'B' },
    ] as any)

    const res = await appFor().fetch(json('POST', '/campaigns/camp-1/ab/check-winner'))

    expect(res.status).toBe(200)
    expect(campaignService.declareWinner).not.toHaveBeenCalled()
    expect(auditService.log).not.toHaveBeenCalled()
    expect(auditService.logActivity).not.toHaveBeenCalled()
  })
})
