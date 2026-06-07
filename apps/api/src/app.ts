/**
 * Main Application Entry Point
 * Clean, modular architecture following enterprise standards
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { logger as honoLogger } from 'hono/logger'
import { serveStatic } from 'hono/bun'
import { getCookie } from 'hono/cookie'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'

// Configuration
import { SERVER, CORS, AUTH, API, DIRECTORIES, ENV, COOKIE, WORKERS } from './config'
import { logger } from './utils/logger'

// Database initialization (must run before services)

// Middleware
import { authMiddleware } from './middleware/auth'
import { authRateLimit, sendRateLimit, uploadRateLimit } from './middleware/rateLimit'
import { csrfTokenIssuer, csrfProtection } from './middleware/csrf'

// Services
import { d1Service } from './services/d1Service'
import { authLocalService } from './services/authLocalService'

// Routes
import indexRoutes from './routes/index'
import authRoutes from './routes/auth'
import oauthRoutes from './routes/oauth'
import sendRoutes from './routes/send'
import reportRoutes from './routes/report'
import configRoutes from './routes/config'
import dashboardRoutes from './routes/dashboard'
import trackingRoutes from './routes/tracking'
import queueRoutes from './routes/queue'
import contactsRoutes from './routes/contacts'
import eventsRoutes from './routes/events'
import templatesRoutes from './routes/templates'
import campaignsRoutes from './routes/campaigns'
import segmentsRoutes from './routes/segments'
import webhooksRoutes from './routes/webhooks'
import automationsRoutes from './routes/automations'
import apikeysRoutes from './routes/apikeys'
import routingRoutes from './routes/routing'
import warmupRoutes from './routes/warmup'
import analyticsRoutes from './routes/analytics'
import formsRoutes from './routes/forms'
import pagesRoutes from './routes/pages'
import pluginsRoutes from './routes/plugins'
import adminRoutes from './routes/admin'
import whatsappRoutes from './routes/whatsapp'

// Phase 2 Services (auto-initialize on import)
import { automationService } from './services/automationService'

// Phase 3 Services (auto-initialize on import)
import { warmupService } from './services/warmupService'

// ============================================================================
// Application Setup
// ============================================================================

const app = new Hono()

// ============================================================================
// Middleware
// ============================================================================

// CORS
app.use(
  '*',
  cors({
    origin: (origin) => {
      return CORS.ALLOWED_ORIGINS.includes(origin) ? origin : CORS.ALLOWED_ORIGINS[0]
    },
    credentials: true,
  })
)

// Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
app.use('*', secureHeaders())

// Request logging
app.use('*', honoLogger())

// CSRF token issuer (sets cookie on all responses)
app.use('*', csrfTokenIssuer)

// CSRF protection on mutation endpoints
app.use('*', csrfProtection)

// Rate limiting on sensitive endpoints
app.use('/api/auth/login', authRateLimit)
app.use('/api/auth/register', authRateLimit)
app.use('/api/send', sendRateLimit)
app.use('/api/parse-excel', uploadRateLimit)

// Authentication — only protect /api routes; SPA routes are handled by the frontend
app.use('*', async (c, next) => {
  const path = c.req.path

  // Skip auth for non-API routes (SPA pages, static assets)
  if (!path.startsWith('/api') && path !== '/health') {
    return next()
  }

  const isPublic = AUTH.PUBLIC_PATHS.some((p) => path.startsWith(p)) || path === '/'

  // Public form submission endpoints (POST /api/forms/:id/submit)
  if (path.match(/^\/api\/forms\/[^/]+\/submit$/) && c.req.method === 'POST') {
    return next()
  }

  if (isPublic) {
    return next()
  }

  return authMiddleware(c, next)
})

// ============================================================================
// Static Files
// ============================================================================

app.use('/public/*', serveStatic({ root: './' }))

// ============================================================================
// Routes
// ============================================================================

const routes = [
  indexRoutes,
  authRoutes,
  oauthRoutes,
  sendRoutes,
  reportRoutes,
  configRoutes,
  dashboardRoutes,
  trackingRoutes,
  queueRoutes,
  contactsRoutes,
  eventsRoutes,
  templatesRoutes,
  campaignsRoutes,
  segmentsRoutes,
  webhooksRoutes,
  automationsRoutes,
  apikeysRoutes,
  routingRoutes,
  warmupRoutes,
  analyticsRoutes,
  formsRoutes,
  pagesRoutes,
  pluginsRoutes,
  adminRoutes,
  whatsappRoutes,
]

// Mount all API routes under /api prefix to avoid conflicts with frontend SPA routes
routes.forEach((route) => app.route('/api', route))

// ============================================================================
// Health & User Endpoints
// ============================================================================

app.get('/health', (c) =>
  c.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: API.VERSION,
  })
)

app.get('/api/user/info', async (c) => {
  const token = getCookie(c, COOKIE.SESSION_NAME)
  if (!token) {
    return c.json({ success: false, message: 'Not authenticated' }, 401)
  }

  const session = await authLocalService.validateSession(token)
  if (!session) {
    return c.json({ success: false, message: 'Session expired' }, 401)
  }

  return c.json({
    success: true,
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
  })
})

// ============================================================================
// SPA Fallback — serve frontend/dist in production
// ============================================================================

// Serve built frontend assets (JS, CSS, images, etc.)
app.use('/*', serveStatic({ root: './frontend/dist' }))

// SPA catch-all: any non-API GET that didn't match a static file → index.html
app.get('*', async (c) => {
  const path = c.req.path
  // Don't catch API routes or health endpoint
  if (path.startsWith('/api') || path === '/health') {
    return c.json({ success: false, message: `Not found: ${path}` }, 404)
  }
  // Serve index.html for SPA client-side routing
  try {
    const html = await Bun.file('./frontend/dist/index.html').text()
    return c.html(html)
  } catch {
    // Frontend not built yet — return helpful message
    return c.json({ success: false, message: 'Frontend not built. Run: cd frontend && npm run build' }, 404)
  }
})

// ============================================================================
// Error Handlers
// ============================================================================

app.notFound((c) => {
  logger.debug(`404: ${c.req.method} ${c.req.path}`)
  return c.json({ success: false, message: `Not found: ${c.req.path}` }, 404)
})

app.onError((err, c) => {
  // AppError: expected errors thrown from routes/services
  if (err.name === 'AppError' && 'status' in err) {
    const status = (err as any).status as number
    return c.json({ success: false, message: err.message }, status)
  }

  // Unexpected errors
  logger.error('Unhandled error:', err)
  return c.json(
    {
      success: false,
      message: 'Internal Server Error',
      ...(ENV.isDev && { error: err.message }),
    },
    500
  )
})

// ============================================================================
// Initialization
// ============================================================================

export async function startBackgroundWorkers() {
  // Create required directories
  const dirs = Object.values(DIRECTORIES)
  await Promise.all(dirs.map((dir) => !existsSync(dir) && mkdir(dir, { recursive: true })))

  // Postgres migrations + seeds run at boot in index.ts (runMigrations / seedSystemRoles
  // / seedStarterTemplates / systemSettingsService.init). The old SQLite initDatabase()
  // is retired — all identity/content/deliverability domains live in Postgres now.

  // Initialize tracking service
  const trackingConfigured = d1Service.initialize()

  // Queue sending runs in the separate BullMQ worker process (worker.ts); the API
  // process only enqueues. BullMQ recovers stalled jobs natively — nothing to do here.

  // Start automation worker (processes due drip sequence actions)
  automationService.startWorker(WORKERS.AUTOMATION_POLL_INTERVAL)

  // Start warmup worker (advances warmup plans daily)
  warmupService.startWorker(WORKERS.WARMUP_POLL_INTERVAL)

  // Log startup info
  logger.startup(`\n🚀 ${API.NAME} v${API.VERSION}`)
  logger.startup(`   Tracking: ${trackingConfigured ? '✅' : '⚠️  (configure via Settings → Tracking or set TRACKING_WORKER_URL)'}`)
  logger.startup(`   Queue: ✅ BullMQ (sending runs in the worker process)`)
  logger.startup(`   OAuth: Configure via Platform Settings → System Mailer`)
  logger.startup(`   API: http://localhost:${SERVER.PORT}`)
  logger.startup(`   Frontend: ${SERVER.FRONTEND_URL}`)
  logger.startup('✅ Ready\n')
}

// ============================================================================
// Background worker lifecycle (started/stopped by index.ts; never at import)
// ============================================================================

export function stopBackgroundWorkers() {
  // Stop workers first (no new jobs picked up). Queue sending lives in worker.ts.
  automationService.stopWorker()
  warmupService.stopWorker()

  logger.info('All workers stopped.')
}

// ============================================================================
// Export
// ============================================================================

export default {
  port: SERVER.PORT,
  fetch: app.fetch,
}
