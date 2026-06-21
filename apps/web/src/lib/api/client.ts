/**
 * API shared types
 *
 * The HTTP transport (formerly the `ApiClient` class + `api` singleton) was
 * retired in P6 — every domain module now uses the typed hono/client RPC layer
 * (see ../rpc/client.ts). This file keeps only the cross-module response/entity
 * types those modules still import.
 */

// ============================================================================
// Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
  error?: string
  meta?: {
    pagination?: {
      page: number
      limit: number
      total: number
      totalPages: number
      hasMore: boolean
    }
  }
}

export interface User {
  id: string
  email: string
  name: string
  is_platform_admin?: boolean
}

export interface OrgInfo {
  id: string
  name: string
  slug: string
  role: string
}

export interface AuthContext {
  user: User
  orgId: string | null
  role: string | null
  orgs: OrgInfo[]
}

export interface SMTPConfig {
  id: string
  name: string
  provider_type: 'smtp' | 'google' | 'microsoft' | 'ses' | 'sendgrid' | 'mailgun' | 'postmark' | 'sparkpost'
  host?: string
  port?: number
  secure?: boolean
  user?: string
  from_email: string
  from_name?: string
  is_default: boolean
  oauth_email?: string
  created_at?: string
  api_key?: string
  api_region?: string
  api_domain?: string
}

export interface EmailLog {
  id: string
  tracking_id?: string
  recipient_email: string
  recipient_name?: string
  subject: string
  status: 'sent' | 'failed' | 'opened' | 'clicked'
  send_type: 'direct' | 'batch' | 'scheduled'
  provider_type: 'smtp' | 'google' | 'microsoft'
  config_name?: string
  sent_at: string
  opened_at?: string
  open_count?: number
  click_count?: number
}

export interface EmailStats {
  total: number
  sent: number
  failed: number
  opened?: number
  clicked?: number
  openRate?: number
  clickRate?: number
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore?: boolean
}

export interface BatchStatus {
  isRunning: boolean
  currentJob: {
    id: string
    totalContacts: number
    currentBatch: number
    totalBatches: number
    emailsSent: number
    emailsFailed: number
    status: string
    nextBatchTime?: string
  } | null
}

export interface ScheduledJob {
  id: string
  scheduled_time: string
  status: 'scheduled' | 'running' | 'completed' | 'cancelled'
  contact_count: number
  subject: string
  use_batch: boolean
}

export interface ProviderStatus {
  configured: boolean
  name: string
  description: string
}

export interface QueueJobSummary {
  id: string
  type: 'direct' | 'batch' | 'scheduled' | 'automation'
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  subject: string
  from_email: string
  config_name: string | null
  total_count: number
  sent_count: number
  failed_count: number
  last_processed_index: number
  progress: number
  created_at: string
  started_at: string | null
  last_error: string | null
  updated_at?: string
}

export interface QueueStats {
  pending: number
  running: number
  paused: number
  completed: number
  failed: number
  cancelled: number
  total_sent: number
  total_failed: number
  dead_letters: number
}

export interface QueueDashboard {
  stats: QueueStats
  activeJobs: QueueJobSummary[]
  pendingJobs: QueueJobSummary[]
  recentJobs: QueueJobSummary[]
}

export interface DashboardStats {
  stats: EmailStats
  queue: QueueDashboard
  scheduledJobs: ScheduledJob[]
  recentLogs: EmailLog[]
  timestamp: string
}
