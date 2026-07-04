import type { AuditAction } from '../../../src/services/audit/types'
export const configKeysOauthManifest = {
  // config.ts (SMTP / provider secrets)
  'POST /config/smtp': 'smtp.created',
  'POST /config/create': 'smtp.created',
  'PUT /config/smtp/:configId': 'smtp.updated',
  'POST /config/update/:configId': 'smtp.updated',
  'DELETE /config/smtp/:configId': 'smtp.deleted',
  'DELETE /config/delete/:configId': 'smtp.deleted',
  'POST /config/smtp/:configId/default': 'smtp.updated',
  'POST /config/smtp/test': { exempt: 'preview-test-validate: SMTP connection test' },
  'POST /config/test/:configId': { exempt: 'preview-test-validate: SMTP connection test' },
  'POST /config/provider': 'smtp.created',
  'POST /config/provider/test/:configId': { exempt: 'preview-test-validate: provider connection test' },
  'POST /config/fetch-domains': { exempt: 'preview-test-validate: reads provider domains, no state change' },
  // apikeys.ts
  'POST /api-keys': 'apikey.created',
  'DELETE /api-keys/:id': 'apikey.revoked',
  'POST /api-keys/:id/toggle': 'apikey.toggled',
  'PUT /api-keys/:id/scopes': 'apikey.scopes_updated',
  // oauth.ts
  'DELETE /oauth/:configId/disconnect': 'provider.disconnected',
  'POST /oauth/:configId/test': { exempt: 'preview-test-validate: OAuth connection test' },
} satisfies Record<string, AuditAction | { exempt: string }>
