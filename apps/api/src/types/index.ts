/**
 * Type Definitions
 * Centralized type definitions for the application
 */

// ============================================================================
// Email Types
// ============================================================================

export interface Contact {
  Email: string
  FirstName?: string
  LastName?: string
  Company?: string
  Subject?: string
  [key: string]: unknown
}

export interface EmailConfig {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
}

export interface EmailJob {
  contacts: Contact[]
  htmlContent: string
  subject: string
  fromEmail: string
  fromName: string
  config: EmailConfig
  delay: number
}

export interface EmailLog {
  id: string
  email: string
  status: EmailStatus
  message?: string
  timestamp: string
  messageId?: string
  firstName?: string
  company?: string
  subject?: string
}

export type EmailStatus = 'Sent' | 'Failed' | 'Error'
export type EmailProvider = 'google' | 'microsoft' | 'smtp'

// ============================================================================
// SMTP Types
// ============================================================================

export interface SMTPDefaults {
  host?: string
  port?: number
  secure?: boolean
  user?: string
  pass?: string
  fromEmail?: string
  fromName?: string
}

// ============================================================================
// Batch Processing Types
// ============================================================================

export interface BatchConfig {
  batchSize: number
  emailDelay: number
  batchDelay: number
  enabled: boolean
}

export interface BatchJob {
  id: string
  totalContacts: number
  currentBatch: number
  totalBatches: number
  emailsSent: number
  emailsFailed: number
  status: BatchStatus
  startTime: string
  config: BatchConfig
  emailJob: EmailJob
  nextBatchTime?: string
  notificationSettings?: NotificationSettings
  userId?: string
  configName?: string
}

export interface BatchStatusInfo {
  isRunning: boolean
  currentJob: BatchJob | null
  totalJobs: number
  completedJobs: number
}

export type BatchStatus = 'Running' | 'Paused' | 'Completed' | 'Failed'

// ============================================================================
// Scheduling Types
// ============================================================================

export interface ScheduledJob {
  id: string
  userId: string
  emailJob: EmailJob
  batchConfig?: BatchConfig
  scheduledTime: string
  notifyEmail?: string
  notifyBrowser?: boolean
  status: ScheduleStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  contactCount: number
  subject: string
  useBatch: boolean
  configName?: string
}

export type ScheduleStatus = 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled'

// ============================================================================
// Notification Types
// ============================================================================

export interface NotificationSettings {
  email?: string
  browser?: boolean
  userId?: string
  configName?: string
}

export interface NotificationConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  fromName: string
}

// ============================================================================
// Provider Types
// ============================================================================

export interface ProviderLimits {
  dailyLimit: number
  name: string
  recommendedBatchSize: number
  recommendedDelay: number
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
  error?: string
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number
  page: number
  limit: number
}

// ============================================================================
// Tracking Types (Cloudflare D1)
// ============================================================================

export interface TrackingEvent {
  id: string
  campaign_id: string
  email_id: string
  recipient_email: string
  event_type: TrackingEventType
  link_url?: string
  user_agent?: string
  ip_address?: string
  country?: string
  city?: string
  device_type?: DeviceType
  timestamp: string
}

export type TrackingEventType = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'unsubscribed'
export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot'

export interface Campaign {
  id: string
  user_id: string
  name: string
  subject: string
  from_email: string
  from_name?: string
  total_recipients: number
  config_id?: string
  config_name?: string
  status: CampaignStatus
  created_at: string
  sent_at?: string
  completed_at?: string
}

export type CampaignStatus = 'draft' | 'sending' | 'completed' | 'failed'

// ============================================================================
// Queue Types
// ============================================================================

export type JobType = 'direct' | 'batch' | 'scheduled' | 'automation'
export type JobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type SmtpErrorType = 'rate_limit' | 'temporary' | 'permanent' | 'network'

export interface CampaignStats {
  campaign_id: string
  total_sent: number
  total_delivered: number
  total_opened: number
  unique_opens: number
  total_clicks: number
  unique_clicks: number
  bounces: number
  unsubscribes: number
  open_rate: number
  click_rate: number
  created_at: string
}

export interface TrackedEmail {
  id: string
  campaign_id: string
  recipient_email: string
  recipient_name?: string
  subject: string
  status: string
  message_id?: string
  sent_at?: string
  delivered_at?: string
  opened_at?: string
  clicked_at?: string
  bounced_at?: string
  open_count: number
  click_count: number
}
