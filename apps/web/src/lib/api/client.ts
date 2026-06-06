/**
 * API Client
 * Centralized HTTP client with type-safe responses
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

// ============================================================================
// API Client
// ============================================================================

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

class ApiClient {
  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    const options: RequestInit = {
      method,
      credentials: 'include',
      headers: {},
    }

    // Attach CSRF token for mutation requests
    if (!['GET', 'HEAD'].includes(method)) {
      const csrfToken = document.cookie
        .split('; ')
        .find((c) => c.startsWith('csrf_token='))
        ?.split('=')[1]
      if (csrfToken) {
        ;(options.headers as Record<string, string>)['X-CSRF-Token'] = csrfToken
      }
    }

    if (body && !(body instanceof FormData)) {
      ;(options.headers as Record<string, string>)['Content-Type'] = 'application/json'
      options.body = JSON.stringify(body)
    } else if (body instanceof FormData) {
      options.body = body
    }

    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, options)

      // Handle non-JSON responses
      const contentType = res.headers.get('content-type')
      if (!contentType?.includes('application/json')) {
        if (!res.ok) {
          return { success: false, message: `HTTP Error: ${res.status}` }
        }
        return { success: true } as ApiResponse<T>
      }

      const json = await res.json()
      return this.normalizeResponse<T>(json)
    } catch (err) {
      console.error('API request failed:', err)
      return { success: false, message: 'Network error - check if backend is running' }
    }
  }

  /**
   * Normalize response to consistent format
   * Handles both { success, data } and legacy { success, configs/logs/etc }
   */
  private normalizeResponse<T>(json: any): ApiResponse<T> {
    // Already in correct format
    if (json.data !== undefined) {
      return json as ApiResponse<T>
    }

    // Legacy format - extract data from root
    const { success, message, error, meta, ...rest } = json
    return {
      success,
      message,
      error,
      meta,
      data: Object.keys(rest).length > 0 ? (rest as T) : undefined,
    }
  }

  // HTTP Methods
  get<T>(endpoint: string) {
    return this.request<T>('GET', endpoint)
  }

  post<T>(endpoint: string, body?: unknown) {
    return this.request<T>('POST', endpoint, body)
  }

  put<T>(endpoint: string, body?: unknown) {
    return this.request<T>('PUT', endpoint, body)
  }

  delete<T>(endpoint: string) {
    return this.request<T>('DELETE', endpoint)
  }

  upload<T>(endpoint: string, formData: FormData) {
    return this.request<T>('POST', endpoint, formData)
  }
}

export const api = new ApiClient()
