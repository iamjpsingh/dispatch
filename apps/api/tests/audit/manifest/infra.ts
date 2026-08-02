import type { AuditAction } from '../../../src/services/audit/types'
export const infraManifest = {
  // whatsapp.ts
  'POST /whatsapp/configs': 'whatsapp.config_created',
  'PUT /whatsapp/configs/:id': 'whatsapp.config_updated',
  'DELETE /whatsapp/configs/:id': 'whatsapp.config_deleted',
  'POST /whatsapp/templates/sync': { exempt: 'derived-recompute: syncs templates from provider' },
  'POST /whatsapp/templates': 'whatsapp.template_created',
  'DELETE /whatsapp/templates/:id': 'whatsapp.template_deleted',
  'POST /whatsapp/send': 'whatsapp.message_sent',
  'POST /whatsapp/send-text': 'whatsapp.message_sent',
  'POST /whatsapp/send-bulk': 'whatsapp.bulk_sent',
  'POST /whatsapp/webhook': { exempt: 'machine-public-ingestion: inbound WhatsApp webhook' },
  // warmup.ts
  'POST /warmup': 'warmup.created',
  'POST /warmup/:id/pause': 'warmup.paused',
  'POST /warmup/:id/resume': 'warmup.resumed',
  'POST /warmup/:id/cancel': 'warmup.cancelled',
  'DELETE /warmup/:id': 'warmup.deleted',
  // routing.ts
  'PUT /routing/config': 'routing.updated',
  'POST /routing/providers/init': 'routing.provider_initialized',
  'POST /routing/providers/:configId/health': 'routing.provider_health_changed',
  'POST /routing/failover': 'routing.failover_triggered',
  // plugins.ts
  'POST /plugins': 'plugin.installed',
  'POST /plugins/:id/activate': 'plugin.enabled',
  'POST /plugins/:id/disable': 'plugin.disabled',
  'PUT /plugins/:id/settings': 'plugin.settings_updated',
  'DELETE /plugins/:id': 'plugin.uninstalled',
  // queue.ts
  'POST /queue/jobs/:id/pause': 'job.paused',
  'POST /queue/jobs/:id/resume': 'job.resumed',
  'DELETE /queue/jobs/:id': 'job.cancelled',
  'POST /queue/suppression': 'suppression.added',
  'DELETE /queue/suppression/:email': 'suppression.removed',
  // send.ts
  'POST /send': 'send.enqueued',
  'POST /send/spam-check': { exempt: 'preview-test-validate: scores content, no send' },
  'POST /test-notification': { exempt: 'preview-test-validate: sends a test notification' },
  'POST /provider-info': { exempt: 'preview-test-validate: reads provider metadata' },
  'POST /parse-excel': { exempt: 'preview-test-validate: parses an upload, no persistence' },
  'DELETE /scheduled-jobs/:id': 'job.cancelled',
  'POST /batch-pause': 'job.paused',
  'POST /batch-resume': 'job.resumed',
  'DELETE /batch-cancel': 'job.cancelled',
  // report.ts
  'DELETE /report/logs/:id': 'send.log_deleted',
  'POST /report/logs/delete-bulk': 'send.logs_bulk_deleted',
  // analytics.ts
  'POST /analytics/events': { exempt: 'machine-public-ingestion: analytics event ingestion' },
  'POST /analytics/seed': { exempt: 'derived-recompute: seeds/recomputes analytics' },
  'POST /analytics/custom-report': { exempt: 'preview-test-validate: builds an ad-hoc report' },
  // tracking.ts
  'POST /tracking/event': { exempt: 'machine-public-ingestion: open/click tracking event' },
} satisfies Record<string, AuditAction | { exempt: string }>
