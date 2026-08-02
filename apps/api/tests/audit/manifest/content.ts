import type { AuditAction } from '../../../src/services/audit/types'
export const contentManifest = {
  // templates.ts
  'POST /templates': 'template.created',
  'PUT /templates/:id': 'template.updated',
  'DELETE /templates/:id': 'template.deleted',
  'POST /templates/:id/duplicate': 'template.duplicated',
  'POST /templates/:id/preview': { exempt: 'preview-test-validate: renders a preview' },
  'POST /templates/preview': { exempt: 'preview-test-validate: renders a preview' },
  'POST /templates/:id/test-send': { exempt: 'preview-test-validate: sends a test to self' },
  'POST /templates/sections': 'section.created',
  'PUT /templates/sections/:id': 'section.updated',
  'DELETE /templates/sections/:id': 'section.deleted',
  'POST /templates/sections/:id/use': { exempt: 'derived-recompute: increments a use counter' },
  'POST /templates/compile': { exempt: 'preview-test-validate: compiles MJML, no persistence' },
  'POST /templates/from-mjml': 'template.created',
  // automations.ts
  'POST /automations': 'automation.created',
  'PUT /automations/:id': 'automation.updated',
  'DELETE /automations/:id': 'automation.deleted',
  'POST /automations/:id/activate': 'automation.activated',
  'POST /automations/:id/pause': 'automation.paused',
  'POST /automations/:id/deactivate': 'automation.deactivated',
  'POST /automations/:id/enroll': 'automation.contact_enrolled',
  'DELETE /automations/:id/enrollments/:contactId': 'automation.contact_unenrolled',
  'PUT /automations/:id/goal': 'automation.goal_updated',
  'DELETE /automations/:id/goal': 'automation.goal_removed',
  // segments.ts
  'POST /segments': 'segment.created',
  'PUT /segments/:id': 'segment.updated',
  'DELETE /segments/:id': 'segment.deleted',
  'POST /segments/:id/contacts': 'segment.members_added',
  'DELETE /segments/:id/contacts': 'segment.members_removed',
} satisfies Record<string, AuditAction | { exempt: string }>
