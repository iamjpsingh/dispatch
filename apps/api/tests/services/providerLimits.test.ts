import { describe, it, expect } from 'vitest'
import { ProviderDetection } from '../../src/services/providerLimits'

// ============================================================================
// detectProvider
// ============================================================================

describe('ProviderDetection.detectProvider', () => {
  it('detects Gmail from smtp.gmail.com', () => {
    const result = ProviderDetection.detectProvider('smtp.gmail.com')
    expect(result.name).toBe('Gmail')
    expect(result.dailyLimit).toBe(100)
    expect(result.recommendedBatchSize).toBe(20)
    expect(result.recommendedDelay).toBe(45)
  })

  it('detects Gmail case-insensitively', () => {
    const result = ProviderDetection.detectProvider('SMTP.GMAIL.COM')
    expect(result.name).toBe('Gmail')
  })

  it('detects Outlook from smtp.outlook.com', () => {
    const result = ProviderDetection.detectProvider('smtp.outlook.com')
    expect(result.name).toBe('Outlook/Hotmail')
    expect(result.dailyLimit).toBe(300)
    expect(result.recommendedBatchSize).toBe(50)
    expect(result.recommendedDelay).toBe(30)
  })

  it('detects Hotmail from smtp.hotmail.com', () => {
    const result = ProviderDetection.detectProvider('smtp.hotmail.com')
    expect(result.name).toBe('Outlook/Hotmail')
  })

  it('detects Live from smtp.live.com', () => {
    const result = ProviderDetection.detectProvider('smtp.live.com')
    expect(result.name).toBe('Outlook/Hotmail')
  })

  it('detects Yahoo from smtp.mail.yahoo.com', () => {
    const result = ProviderDetection.detectProvider('smtp.mail.yahoo.com')
    expect(result.name).toBe('Yahoo')
    expect(result.dailyLimit).toBe(100)
    expect(result.recommendedBatchSize).toBe(20)
    expect(result.recommendedDelay).toBe(45)
  })

  it('returns Custom SMTP for unknown providers', () => {
    const result = ProviderDetection.detectProvider('mail.myserver.com')
    expect(result.name).toBe('Custom SMTP')
    expect(result.dailyLimit).toBe(10000)
    expect(result.recommendedBatchSize).toBe(100)
    expect(result.recommendedDelay).toBe(15)
  })

  it('returns Custom SMTP for empty string', () => {
    const result = ProviderDetection.detectProvider('')
    expect(result.name).toBe('Custom SMTP')
  })

  it('returns Custom SMTP for custom business SMTP', () => {
    const result = ProviderDetection.detectProvider('smtp.sendgrid.net')
    expect(result.name).toBe('Custom SMTP')
    expect(result.dailyLimit).toBe(10000)
  })
})

// ============================================================================
// calculateMaxContacts
// ============================================================================

describe('ProviderDetection.calculateMaxContacts', () => {
  it('reserves 1 email for Gmail when notifications enabled', () => {
    const max = ProviderDetection.calculateMaxContacts('smtp.gmail.com', true)
    expect(max).toBe(99) // 100 - 1
  })

  it('does not reserve for Gmail when notifications disabled', () => {
    const max = ProviderDetection.calculateMaxContacts('smtp.gmail.com', false)
    expect(max).toBe(100)
  })

  it('reserves 1 email for Yahoo when notifications enabled', () => {
    const max = ProviderDetection.calculateMaxContacts('smtp.mail.yahoo.com', true)
    expect(max).toBe(99) // 100 - 1
  })

  it('reserves 1 email for Outlook when notifications enabled', () => {
    const max = ProviderDetection.calculateMaxContacts('smtp.outlook.com', true)
    expect(max).toBe(299) // 300 - 1
  })

  it('does not reserve for Outlook when notifications disabled', () => {
    const max = ProviderDetection.calculateMaxContacts('smtp.outlook.com', false)
    expect(max).toBe(300)
  })

  it('does not limit custom SMTP (returns full limit)', () => {
    const max = ProviderDetection.calculateMaxContacts('mail.myserver.com', true)
    expect(max).toBe(10000)
  })

  it('does not limit custom SMTP without notifications', () => {
    const max = ProviderDetection.calculateMaxContacts('mail.myserver.com', false)
    expect(max).toBe(10000)
  })
})
