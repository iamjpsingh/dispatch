import type { AuditAction } from '../../../src/services/audit/types'
export const contactsManifest = {
  'POST /contacts/lists': 'list.created',
  'PUT /contacts/lists/:id': 'list.updated',
  'DELETE /contacts/lists/:id': 'list.deleted',
  'POST /contacts/merge': 'contacts.merged',
  'POST /contacts/validate': { exempt: 'preview-test-validate: validates addresses, no persistence' },
  'POST /contacts/validate-single': { exempt: 'preview-test-validate: single-address check' },
  'POST /contacts/bulk/delete': 'contacts.deleted',
  'POST /contacts/bulk/tag': 'contacts.tagged',
  'POST /contacts/bulk/move': 'contacts.moved',
  'POST /contacts/preferences/public/:email': { exempt: 'machine-public-ingestion: public unauth preference update' },
  'PUT /contacts/preferences/:contactId': 'contact.preference_updated',
  'POST /contacts/:listId': 'contacts.created',
  'PUT /contacts/item/:id': 'contacts.updated',
  'POST /contacts/:listId/import': 'contacts.imported',
} satisfies Record<string, AuditAction | { exempt: string }>
