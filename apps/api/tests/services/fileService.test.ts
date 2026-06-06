import { describe, it, expect, vi } from 'vitest'

// Mock dependencies before importing
vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    startup: vi.fn(),
  },
}))

import { FileService } from '../../src/services/fileService'

// ============================================================================
// replacePlaceholders
// ============================================================================

describe('FileService.replacePlaceholders', () => {
  it('replaces single placeholder', () => {
    const template = 'Hello {{FirstName}}'
    const contact = { Email: 'alice@test.com', FirstName: 'Alice' }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Hello Alice')
  })

  it('replaces multiple placeholders', () => {
    const template = 'Hi {{FirstName}} from {{Company}}'
    const contact = { Email: 'bob@test.com', FirstName: 'Bob', Company: 'Acme' }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Hi Bob from Acme')
  })

  it('replaces Email placeholder', () => {
    const template = 'Your email is {{Email}}'
    const contact = { Email: 'test@test.com' }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Your email is test@test.com')
  })

  it('leaves unmatched placeholders intact', () => {
    const template = 'Hello {{FirstName}}, your title is {{Title}}'
    const contact = { Email: 'test@test.com', FirstName: 'Alice' }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Hello Alice, your title is {{Title}}')
  })

  it('handles empty contact values', () => {
    const template = 'Hello {{FirstName}}'
    const contact = { Email: 'test@test.com', FirstName: '' }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Hello ')
  })

  it('handles undefined contact values by leaving placeholder', () => {
    const template = 'Hello {{FirstName}}'
    const contact = { Email: 'test@test.com' }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Hello {{FirstName}}')
  })

  it('handles template with no placeholders', () => {
    const template = 'Hello World'
    const contact = { Email: 'test@test.com', FirstName: 'Alice' }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Hello World')
  })

  it('handles empty template', () => {
    const contact = { Email: 'test@test.com' }
    expect(FileService.replacePlaceholders('', contact)).toBe('')
  })

  it('handles null template', () => {
    const contact = { Email: 'test@test.com' }
    expect(FileService.replacePlaceholders(null as unknown as string, contact)).toBe('')
  })

  it('handles null contact', () => {
    const template = 'Hello {{FirstName}}'
    expect(FileService.replacePlaceholders(template, null as any)).toBe('Hello {{FirstName}}')
  })

  it('replaces repeated placeholders', () => {
    const template = '{{FirstName}} and {{FirstName}} again'
    const contact = { Email: 'test@test.com', FirstName: 'Alice' }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Alice and Alice again')
  })

  it('handles complex HTML with placeholders', () => {
    const template = '<h1>Hello {{FirstName}}</h1><p>Your company: {{Company}}</p>'
    const contact = { Email: 'test@test.com', FirstName: 'Bob', Company: 'Corp' }
    expect(FileService.replacePlaceholders(template, contact)).toBe('<h1>Hello Bob</h1><p>Your company: Corp</p>')
  })

  it('replaces placeholders with numeric values', () => {
    const template = 'Score: {{Score}}'
    const contact = { Email: 'test@test.com', Score: 42 }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Score: 42')
  })

  it('replaces placeholder with value 0', () => {
    const template = 'Count: {{Count}}'
    const contact = { Email: 'test@test.com', Count: 0 }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Count: ')
  })

  it('handles LastName placeholder', () => {
    const template = '{{FirstName}} {{LastName}}'
    const contact = { Email: 'test@test.com', FirstName: 'Jane', LastName: 'Doe' }
    expect(FileService.replacePlaceholders(template, contact)).toBe('Jane Doe')
  })
})
