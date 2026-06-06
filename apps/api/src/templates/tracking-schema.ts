// src/templates/tracking-schema.ts — D1 schema for email tracking database
// Enhanced with geo, device, browser, email client columns

export const TRACKING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  recipient TEXT NOT NULL,
  subject TEXT,
  sent_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  email_id TEXT,
  original_url TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('open', 'click', 'unsubscribe')),
  link_id TEXT,
  ip TEXT,
  ua TEXT,
  country TEXT,
  city TEXT,
  device_type TEXT,
  browser TEXT,
  os TEXT,
  email_client TEXT,
  referrer TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_email ON events(email_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_country ON events(country);
CREATE INDEX IF NOT EXISTS idx_events_device ON events(device_type);
CREATE INDEX IF NOT EXISTS idx_links_email ON links(email_id);
`
