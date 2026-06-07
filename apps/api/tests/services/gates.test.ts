// P4.C net — evaluateGates: the send-time deliverability gate chain.
// Verified order: suppression -> frequency cap -> email preferences -> graymail.
// Suppression is user-scoped (always checked); the org-scoped gates run only when
// an org_id is present. The backing services are netted in P2.4; here we test the
// ORDER, the reason mapping, and the null-org short-circuit (this module's logic).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const suppressed = vi.fn()
const freqCanSend = vi.fn()
const prefCanReceive = vi.fn()
const grayCanSend = vi.fn()

vi.mock('../../src/services/queue/suppressionStore', () => ({
  suppressionStore: { isSuppressed: (...a: unknown[]) => suppressed(...a) },
}))
vi.mock('../../src/services/frequencyCapService', () => ({
  frequencyCapService: { canSend: (...a: unknown[]) => freqCanSend(...a) },
}))
vi.mock('../../src/services/preferenceCenterService', () => ({
  preferenceCenterService: { canReceive: (...a: unknown[]) => prefCanReceive(...a) },
}))
vi.mock('../../src/services/graymailService', () => ({
  graymailService: { canSend: (...a: unknown[]) => grayCanSend(...a) },
}))

import { evaluateGates } from '../../src/services/queue/gates'

describe('P4.C — evaluateGates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    suppressed.mockResolvedValue(false)
    freqCanSend.mockResolvedValue(true)
    prefCanReceive.mockResolvedValue(true)
    grayCanSend.mockResolvedValue(true)
  })

  it('allows when every gate passes', async () => {
    expect(await evaluateGates('u1', 'org1', 'a@b.com')).toEqual({ allowed: true })
  })

  it('blocks suppressed first, before any org gate runs', async () => {
    suppressed.mockResolvedValue(true)
    freqCanSend.mockResolvedValue(false) // would also block, but suppression wins
    expect(await evaluateGates('u1', 'org1', 'a@b.com')).toEqual({ allowed: false, reason: 'suppressed' })
    expect(freqCanSend).not.toHaveBeenCalled()
  })

  it('blocks on frequency cap (reason frequency_cap)', async () => {
    freqCanSend.mockResolvedValue(false)
    expect(await evaluateGates('u1', 'org1', 'a@b.com')).toEqual({ allowed: false, reason: 'frequency_cap' })
  })

  it('blocks on preferences (reason unsubscribed)', async () => {
    prefCanReceive.mockResolvedValue(false)
    expect(await evaluateGates('u1', 'org1', 'a@b.com')).toEqual({ allowed: false, reason: 'unsubscribed' })
  })

  it('blocks on graymail (reason graymail)', async () => {
    grayCanSend.mockResolvedValue(false)
    expect(await evaluateGates('u1', 'org1', 'a@b.com')).toEqual({ allowed: false, reason: 'graymail' })
  })

  it('uses orgId for org-scoped gates, userId for suppression', async () => {
    await evaluateGates('user-1', 'org-9', 'x@y.com')
    expect(suppressed).toHaveBeenCalledWith('user-1', 'x@y.com')
    expect(freqCanSend).toHaveBeenCalledWith('org-9', 'x@y.com')
    expect(prefCanReceive).toHaveBeenCalledWith('org-9', 'x@y.com')
    expect(grayCanSend).toHaveBeenCalledWith('org-9', 'x@y.com')
  })

  it('with null org_id, only suppression is checked (org gates skipped)', async () => {
    const res = await evaluateGates('u1', null, 'a@b.com')
    expect(res).toEqual({ allowed: true })
    expect(suppressed).toHaveBeenCalledWith('u1', 'a@b.com')
    expect(freqCanSend).not.toHaveBeenCalled()
    expect(prefCanReceive).not.toHaveBeenCalled()
    expect(grayCanSend).not.toHaveBeenCalled()
  })
})
