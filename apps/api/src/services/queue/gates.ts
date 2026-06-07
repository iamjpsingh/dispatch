// src/services/queue/gates.ts - send-time deliverability gate chain.
// Order (verified against the legacy worker): suppression -> frequency cap ->
// email preferences -> graymail. Suppression is user-scoped (always checked);
// the org-scoped gates run only when an org_id is present (null = no org context,
// so org policies can't be enforced — fail open, suppression still applies).
import { suppressionStore } from './suppressionStore'
import { frequencyCapService } from '../frequencyCapService'
import { preferenceCenterService } from '../preferenceCenterService'
import { graymailService } from '../graymailService'

export interface GateResult {
  allowed: boolean
  reason?: string
}

export async function evaluateGates(userId: string, orgId: string | null, email: string): Promise<GateResult> {
  if (await suppressionStore.isSuppressed(userId, email)) return { allowed: false, reason: 'suppressed' }
  if (orgId) {
    if (!(await frequencyCapService.canSend(orgId, email))) return { allowed: false, reason: 'frequency_cap' }
    if (!(await preferenceCenterService.canReceive(orgId, email))) return { allowed: false, reason: 'unsubscribed' }
    if (!(await graymailService.canSend(orgId, email))) return { allowed: false, reason: 'graymail' }
  }
  return { allowed: true }
}
