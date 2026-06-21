import { AppError } from './validate'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** CAN-SPAM footer: sender identity + valid physical postal address + unsubscribe link. */
export function buildComplianceFooter(
  org: { sender_company_name: string | null; name: string; postal_address: string | null },
  unsubscribeUrl: string
): string {
  const who = escapeHtml(org.sender_company_name || org.name)
  const where = escapeHtml(org.postal_address || '')
  return (
    `<div style="font-size:12px;color:#666;margin-top:24px;border-top:1px solid #ddd;padding-top:12px;">` +
    `${who}<br>${where}<br>` +
    `<a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a>` +
    `</div>`
  )
}

/** Hard-gate: a marketing send requires a valid physical postal address (CAN-SPAM). */
export function assertSenderIdentity(org: { postal_address: string | null }): void {
  if (!org.postal_address || !org.postal_address.trim()) {
    throw new AppError(400, 'Set your organization physical mailing address (Settings → Org) before sending campaigns')
  }
}
