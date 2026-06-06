// src/services/conditionEngine.ts - Condition Evaluation Engine for Automations

import { contactService, type Contact } from './contactService'
import { logger } from '../utils/logger'

export interface Condition {
  field: string
  operator: string
  value: string
}

/**
 * Evaluate a condition against a contact.
 * Returns true if the condition passes.
 */
export function evaluateCondition(contact: Contact, condition: Condition): boolean {
  const contactValue = getFieldValue(contact, condition.field)

  switch (condition.operator) {
    case 'equals':
      return String(contactValue).toLowerCase() === condition.value.toLowerCase()
    case 'not_equals':
      return String(contactValue).toLowerCase() !== condition.value.toLowerCase()
    case 'contains':
      return String(contactValue).toLowerCase().includes(condition.value.toLowerCase())
    case 'not_contains':
      return !String(contactValue).toLowerCase().includes(condition.value.toLowerCase())
    case 'starts_with':
      return String(contactValue).toLowerCase().startsWith(condition.value.toLowerCase())
    case 'ends_with':
      return String(contactValue).toLowerCase().endsWith(condition.value.toLowerCase())
    case 'greater_than':
      return Number(contactValue) > Number(condition.value)
    case 'less_than':
      return Number(contactValue) < Number(condition.value)
    case 'greater_equal':
      return Number(contactValue) >= Number(condition.value)
    case 'less_equal':
      return Number(contactValue) <= Number(condition.value)
    case 'exists':
      return contactValue != null && contactValue !== ''
    case 'not_exists':
      return contactValue == null || contactValue === ''
    case 'has_tag': {
      const tags: string[] = parseJsonArray(contact.tags)
      return tags.includes(condition.value)
    }
    case 'not_has_tag': {
      const tags: string[] = parseJsonArray(contact.tags)
      return !tags.includes(condition.value)
    }
    case 'score_above':
      return contact.engagement_score > Number(condition.value)
    case 'score_below':
      return contact.engagement_score < Number(condition.value)
    default:
      logger.warn(`Unknown condition operator: ${condition.operator}`)
      return false
  }
}

/**
 * Get a field value from a contact object.
 * Supports nested custom_fields via dot notation.
 */
function getFieldValue(contact: Contact, field: string): string | number | null {
  // Direct contact fields
  switch (field) {
    case 'email': return contact.email
    case 'first_name': return contact.first_name
    case 'last_name': return contact.last_name
    case 'company': return contact.company
    case 'phone': return contact.phone
    case 'status': return contact.status
    case 'engagement_score': return contact.engagement_score
    case 'source': return contact.source
    case 'created_at': return contact.created_at
    case 'updated_at': return contact.updated_at
  }

  // Custom fields (stored as JSON string)
  if (field.startsWith('custom.')) {
    const customKey = field.slice(7)
    const customFields: Record<string, string> = parseJsonObject(contact.custom_fields)
    return customFields[customKey] ?? null
  }

  return null
}

function parseJsonArray(json: string): string[] {
  try { return JSON.parse(json || '[]') } catch { return [] }
}

function parseJsonObject(json: string): Record<string, string> {
  try { return JSON.parse(json || '{}') } catch { return {} }
}
