-- Dispatch D1 Schema - Complete Database
-- Run: wrangler d1 execute dispatch --file=schema.sql --remote

-- ============================================================================
-- USER MANAGEMENT
-- ============================================================================

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_login TEXT,
  is_active INTEGER DEFAULT 1
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- SMTP / Provider Configurations
CREATE TABLE IF NOT EXISTS smtp_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  host TEXT,
  port INTEGER DEFAULT 587,
  secure INTEGER DEFAULT 0,
  username TEXT,
  password TEXT,
  from_email TEXT,
  from_name TEXT,
  provider_type TEXT DEFAULT 'smtp',
  api_key TEXT,
  api_secret TEXT,
  api_region TEXT,
  api_domain TEXT,
  oauth_email TEXT,
  oauth_access_token TEXT,
  oauth_refresh_token TEXT,
  oauth_expires_at TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================================
-- EMAIL TRACKING
-- ============================================================================

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT,
  send_type TEXT DEFAULT 'direct',
  provider_type TEXT DEFAULT 'smtp',
  config_name TEXT,
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'sending',
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Emails (each email sent)
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  tracking_id TEXT UNIQUE NOT NULL,
  campaign_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  send_type TEXT DEFAULT 'direct',
  provider_type TEXT DEFAULT 'smtp',
  config_name TEXT,
  message_id TEXT,
  status TEXT DEFAULT 'sent',
  sent_at TEXT DEFAULT (datetime('now')),
  opened_at TEXT,
  clicked_at TEXT,
  open_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Tracking Events (detailed log of opens/clicks)
CREATE TABLE IF NOT EXISTS tracking_events (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  event_type TEXT NOT NULL,
  link_url TEXT,
  user_agent TEXT,
  ip_address TEXT,
  country TEXT,
  city TEXT,
  device_type TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (email_id) REFERENCES emails(id)
);

-- ============================================================================
-- COMPLIANCE & SUPPRESSION
-- ============================================================================

-- Suppression List (unsubscribes, bounces, complaints)
CREATE TABLE IF NOT EXISTS suppressions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe', 'hard_bounce', 'soft_bounce', 'complaint', 'manual')),
  source TEXT DEFAULT 'system',
  campaign_id TEXT,
  bounce_code TEXT,
  bounce_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, email, reason)
);

CREATE INDEX IF NOT EXISTS idx_suppressions_user ON suppressions(user_id);
CREATE INDEX IF NOT EXISTS idx_suppressions_email ON suppressions(email);
CREATE INDEX IF NOT EXISTS idx_suppressions_reason ON suppressions(reason);

-- ============================================================================
-- EMAIL PREFERENCES
-- ============================================================================

-- Email Preferences (unsubscribe preference center)
CREATE TABLE IF NOT EXISTS email_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  preference TEXT NOT NULL CHECK (preference IN
    ('subscribed', 'campaign_only', 'digest_weekly', 'digest_monthly', 'paused', 'unsubscribed')),
  pause_until TEXT,
  reason TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_prefs_user ON email_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_prefs_email ON email_preferences(email);

-- ============================================================================
-- FORM ENDPOINTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS form_endpoints (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  list_id TEXT NOT NULL,
  field_mapping TEXT DEFAULT '{}',
  required_fields TEXT DEFAULT '["email"]',
  allowed_domains TEXT DEFAULT '[]',
  redirect_url TEXT,
  actions TEXT DEFAULT '[]',
  double_optin INTEGER DEFAULT 0,
  success_message TEXT DEFAULT 'Thank you for subscribing!',
  submission_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fe_org ON form_endpoints(org_id);
CREATE INDEX IF NOT EXISTS idx_fe_status ON form_endpoints(status);

CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  data TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (form_id) REFERENCES form_endpoints(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fs_form ON form_submissions(form_id);

-- ============================================================================
-- LANDING PAGES
-- ============================================================================

CREATE TABLE IF NOT EXISTS landing_pages (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'lead_capture',
  html_content TEXT NOT NULL DEFAULT '',
  css_content TEXT NOT NULL DEFAULT '',
  meta_description TEXT,
  meta_image TEXT,
  form_id TEXT,
  tracking_enabled INTEGER DEFAULT 1,
  published INTEGER DEFAULT 0,
  visit_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_lp_org ON landing_pages(org_id);
CREATE INDEX IF NOT EXISTS idx_lp_slug ON landing_pages(slug);
CREATE INDEX IF NOT EXISTS idx_lp_published ON landing_pages(published);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_smtp_configs_user ON smtp_configs(user_id);

-- Add compliance columns to emails (safe to re-run)
-- ALTER TABLE emails ADD COLUMN unsubscribed_at TEXT;
-- ALTER TABLE emails ADD COLUMN bounced_at TEXT;
-- ALTER TABLE emails ADD COLUMN bounce_reason TEXT;

-- Add compliance columns to campaigns (safe to re-run)
-- ALTER TABLE campaigns ADD COLUMN bounced_count INTEGER DEFAULT 0;
-- ALTER TABLE campaigns ADD COLUMN unsubscribed_count INTEGER DEFAULT 0;

-- Email tracking indexes
CREATE INDEX IF NOT EXISTS idx_emails_tracking ON emails(tracking_id);
CREATE INDEX IF NOT EXISTS idx_emails_campaign ON emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_emails_user ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS idx_emails_sent ON emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_events_email ON tracking_events(email_id);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON tracking_events(campaign_id);
