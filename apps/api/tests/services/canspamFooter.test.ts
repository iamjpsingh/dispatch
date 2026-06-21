import { describe, it, expect } from 'vitest'
import { buildComplianceFooter } from '../../src/utils/canspam'

describe('buildComplianceFooter', () => {
  it('includes company name, postal address, and an unsubscribe link', () => {
    const html = buildComplianceFooter(
      { sender_company_name: 'Acme Inc', name: 'Acme', postal_address: '1 A St, NY' },
      'mailto:x@y.z?subject=unsubscribe'
    )
    expect(html).toContain('Acme Inc')
    expect(html).toContain('1 A St, NY')
    expect(html).toContain('unsubscribe')
  })
  it('falls back to org name when company name is blank, and escapes HTML', () => {
    const html = buildComplianceFooter(
      { sender_company_name: null, name: 'A<b>', postal_address: '1 St & 2nd' },
      'mailto:x@y.z'
    )
    expect(html).toContain('A&lt;b&gt;')
    expect(html).toContain('1 St &amp; 2nd')
  })
})
