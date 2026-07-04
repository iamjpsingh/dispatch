import type { AuditAction } from '../../../src/services/audit/types'
export const channelsManifest = {
  // forms.ts
  'POST /forms': 'form.created',
  'PUT /forms/:id': 'form.updated',
  'DELETE /forms/:id': 'form.deleted',
  'POST /forms/:id/submit': { exempt: 'machine-public-ingestion: public form submission' },
  'POST /forms/:id/toggle': 'form.status_changed',
  'POST /forms/:id/webhook': { exempt: 'machine-public-ingestion: inbound form webhook' },
  // pages.ts
  'POST /pages': 'page.created',
  'PUT /pages/:id': 'page.updated',
  'DELETE /pages/:id': 'page.deleted',
  'POST /pages/:id/publish': 'page.published',
  'POST /pages/:id/unpublish': 'page.unpublished',
  // webhooks.ts
  'POST /webhooks': 'webhook.created',
  'PUT /webhooks/:id': 'webhook.updated',
  'DELETE /webhooks/:id': 'webhook.deleted',
  'POST /webhooks/:id/toggle': 'webhook.toggled',
  'POST /webhooks/:id/test': { exempt: 'preview-test-validate: sends a test webhook ping' },
  'DELETE /webhooks/:id/logs': 'webhook.logs_cleared',
  'POST /webhooks/bounce/ses': { exempt: 'machine-public-ingestion: inbound SES bounce' },
  'POST /webhooks/bounce/mailgun': { exempt: 'machine-public-ingestion: inbound Mailgun bounce' },
  'POST /webhooks/bounce/sendgrid': { exempt: 'machine-public-ingestion: inbound SendGrid bounce' },
  'POST /webhooks/bounce/postmark': { exempt: 'machine-public-ingestion: inbound Postmark bounce' },
  'POST /webhooks/bounce/sparkpost': { exempt: 'machine-public-ingestion: inbound SparkPost bounce' },
  'POST /webhooks/inbound/sendgrid': { exempt: 'machine-public-ingestion: inbound SendGrid parse' },
  'POST /webhooks/inbound/mailgun': { exempt: 'machine-public-ingestion: inbound Mailgun parse' },
  'POST /webhooks/inbound/postmark': { exempt: 'machine-public-ingestion: inbound Postmark parse' },
} satisfies Record<string, AuditAction | { exempt: string }>
