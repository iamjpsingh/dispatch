/**
 * Application Configuration
 * Centralized configuration management
 */
import { config as loadEnv } from 'dotenv'

// Load environment variables
loadEnv()

// Environment
export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',
  isProd: process.env.NODE_ENV === 'production',
} as const

// Server Configuration
export const SERVER = {
  PORT: parseInt(process.env.PORT || '5500', 10),
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  BASE_URL: process.env.BASE_URL || 'http://localhost:5500',
} as const

// CORS Configuration
export const CORS = {
  ALLOWED_ORIGINS: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5500',
    process.env.FRONTEND_URL,
  ].filter(Boolean) as string[],
} as const

// Authentication Configuration
export const AUTH = {
  SESSION_SECRET: process.env.SESSION_SECRET,
  SESSION_EXPIRY_HOURS: 24,
  COOKIE_MAX_AGE: 7 * 24 * 60 * 60, // 7 days in seconds
  PUBLIC_PATHS: [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/google/callback',
    '/api/auth/microsoft/callback',
    '/api/oauth/status',
    '/api/track/open/',
    '/api/track/click/',
    '/api/track/unsubscribe/',
    '/api/track/status',
    '/api/tracking/', // Inbound tracking events from the CF worker (secret-auth, no session)
    '/health',
    '/public/',
    '/api/events/stream',
    '/api/webhooks/bounce/',
    '/api/whatsapp/webhook',
    // Platform mailer OAuth now uses unified /api/auth/google/callback & /api/auth/microsoft/callback
    '/api/admin/cloudflare/callback',
    '/api/contacts/preferences/public/',
    '/api/webhooks/inbound/',
    '/api/forms/',
  ],
} as const

// OAuth Configuration
export const OAUTH = {
  GOOGLE: {
    CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || `${SERVER.BASE_URL}/api/auth/google/callback`,
    SCOPES: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    isConfigured: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  },
  MICROSOFT: {
    CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI || `${SERVER.BASE_URL}/api/auth/microsoft/callback`,
    SCOPES: ['https://graph.microsoft.com/Mail.Send', 'https://graph.microsoft.com/User.Read', 'offline_access'],
    isConfigured: () => !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
  },
} as const

// Email Provider Limits
export const EMAIL_LIMITS = {
  GOOGLE: { daily: 500, batchSize: 50, delayMs: 2000 },
  MICROSOFT: { daily: 300, batchSize: 30, delayMs: 3000 },
  SMTP: { daily: 500, batchSize: 20, delayMs: 5000 },
} as const

// Database Paths
export const DATABASE = {
  USERS_PATH: './data/users.db',
  SCHEDULER_PATH: './data/scheduler.db',
} as const

// Directory Paths
export const DIRECTORIES = {
  UPLOADS: './uploads',
  LOGS: './logs',
  PUBLIC: './public',
  DATA: './data',
} as const

// API Configuration
export const API = {
  VERSION: '3.0.0',
  NAME: 'Dispatch API',
} as const

// Cloudflare Tracking Worker Configuration
export const TRACKING = {
  WORKER_URL: process.env.TRACKING_WORKER_URL || '',
  isConfigured: () => !!process.env.TRACKING_WORKER_URL,
  // Shared secret for the inbound /api/tracking/event endpoint. The worker
  // POSTs tracking events server-to-server with header X-Tracking-Secret.
  // Empty string = NOT configured -> the endpoint fails closed (rejects all).
  TRACKING_SYNC_SECRET: process.env.TRACKING_SYNC_SECRET || '',
} as const

// Cookie Configuration
export const COOKIE = {
  SESSION_NAME: 'session_token',
  OPTIONS: {
    httpOnly: true,
    secure: ENV.isProd,
    sameSite: 'Lax' as const,
    maxAge: AUTH.COOKIE_MAX_AGE,
    path: '/',
  },
} as const

// Worker/Timing Constants
export const WORKERS = {
  QUEUE_POLL_INTERVAL: 5000,
  AUTOMATION_POLL_INTERVAL: 60000,
  WARMUP_POLL_INTERVAL: 86400000,
} as const

export const BATCH_DEFAULTS = {
  DELAY_SECONDS: 20,
  BATCH_SIZE: 20,
  EMAIL_DELAY: 60,
  BATCH_DELAY: 45,
  JOB_CLEAR_TIMEOUT: 30000,
  MAX_RETRY_ATTEMPTS: 4,
  MAX_CONCURRENT_JOBS: 3,
  SSE_HEARTBEAT_INTERVAL: 30000,
  SESSION_CACHE_TTL: 5 * 60 * 1000,
  VALIDATION_BATCH_LIMIT: 100,
} as const

/**
 * Get provider limits by type
 */
export function getProviderLimits(provider: 'google' | 'microsoft' | 'smtp') {
  switch (provider) {
    case 'google':
      return EMAIL_LIMITS.GOOGLE
    case 'microsoft':
      return EMAIL_LIMITS.MICROSOFT
    default:
      return EMAIL_LIMITS.SMTP
  }
}

/**
 * Check if request is HTTPS
 */
export function isHttps(headers: { get: (key: string) => string | null | undefined }, url: string): boolean {
  return headers.get('x-forwarded-proto') === 'https' || url.startsWith('https://')
}
