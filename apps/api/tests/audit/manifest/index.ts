import type { AuditAction } from '../../../src/services/audit/types'
import { campaignsManifest } from './campaigns'
import { contactsManifest } from './contacts'
import { configKeysOauthManifest } from './config-keys-oauth'
import { contentManifest } from './content'
import { channelsManifest } from './channels'
import { infraManifest } from './infra'
import { adminAuthManifest } from './admin-auth'

export type ManifestValue = AuditAction | { exempt: string }
export const AUDIT_MANIFEST: Record<string, ManifestValue> = {
  ...campaignsManifest, ...contactsManifest, ...configKeysOauthManifest,
  ...contentManifest, ...channelsManifest, ...infraManifest, ...adminAuthManifest,
}
