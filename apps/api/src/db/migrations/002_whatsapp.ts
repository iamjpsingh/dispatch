import type Database from 'bun:sqlite'
import { registerMigration } from '../migrate'

registerMigration({
  id: '002_whatsapp',
  up: (mainDb: Database, _logDb: Database) => {
    mainDb.exec(`
      -- WhatsApp Business API configurations
      CREATE TABLE IF NOT EXISTS whatsapp_configs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'twilio', '360dialog')),
        phone_number_id TEXT NOT NULL,
        business_account_id TEXT,
        access_token TEXT NOT NULL,
        phone_display TEXT,
        webhook_verify_token TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
        daily_limit INTEGER NOT NULL DEFAULT 1000,
        sent_today INTEGER NOT NULL DEFAULT 0,
        last_reset_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_wa_config_org ON whatsapp_configs(org_id);
      CREATE INDEX IF NOT EXISTS idx_wa_config_status ON whatsapp_configs(status);

      -- WhatsApp message templates (synced from Meta)
      CREATE TABLE IF NOT EXISTS whatsapp_templates (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        config_id TEXT NOT NULL REFERENCES whatsapp_configs(id) ON DELETE CASCADE,
        meta_template_name TEXT NOT NULL,
        meta_template_id TEXT,
        language TEXT NOT NULL DEFAULT 'en',
        category TEXT NOT NULL DEFAULT 'MARKETING' CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED')),
        components_json TEXT NOT NULL DEFAULT '[]',
        example_json TEXT,
        body_text TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_wa_tpl_org ON whatsapp_templates(org_id);
      CREATE INDEX IF NOT EXISTS idx_wa_tpl_config ON whatsapp_templates(config_id);
      CREATE INDEX IF NOT EXISTS idx_wa_tpl_status ON whatsapp_templates(status);

      -- WhatsApp messages
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        config_id TEXT NOT NULL,
        campaign_id TEXT,
        contact_id TEXT,
        phone_number TEXT NOT NULL,
        template_id TEXT,
        message_type TEXT NOT NULL DEFAULT 'template' CHECK (message_type IN ('template', 'text', 'media')),
        content_json TEXT NOT NULL DEFAULT '{}',
        wamid TEXT,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
        error_message TEXT,
        sent_at TEXT,
        delivered_at TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_wa_msg_org ON whatsapp_messages(org_id);
      CREATE INDEX IF NOT EXISTS idx_wa_msg_config ON whatsapp_messages(config_id);
      CREATE INDEX IF NOT EXISTS idx_wa_msg_campaign ON whatsapp_messages(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_wa_msg_wamid ON whatsapp_messages(wamid);
      CREATE INDEX IF NOT EXISTS idx_wa_msg_status ON whatsapp_messages(status);
      CREATE INDEX IF NOT EXISTS idx_wa_msg_created ON whatsapp_messages(created_at);
    `)

    // Update system roles with WhatsApp permissions
    const rolesToUpdate = [
      { name: 'org_owner', perms: ['whatsapp.view', 'whatsapp.manage'] },
      { name: 'org_admin', perms: ['whatsapp.view', 'whatsapp.manage'] },
      { name: 'org_manager', perms: ['whatsapp.view', 'whatsapp.manage'] },
      { name: 'org_member', perms: ['whatsapp.view'] },
      { name: 'readonly', perms: ['whatsapp.view'] },
    ]

    for (const role of rolesToUpdate) {
      const existing = mainDb.prepare('SELECT permissions FROM roles WHERE name = ? AND is_system = 1').get(role.name) as { permissions: string } | null
      if (existing) {
        const perms: string[] = JSON.parse(existing.permissions)
        for (const p of role.perms) {
          if (!perms.includes(p)) perms.push(p)
        }
        mainDb.prepare('UPDATE roles SET permissions = ? WHERE name = ? AND is_system = 1').run(JSON.stringify(perms), role.name)
      }
    }
  },
})
