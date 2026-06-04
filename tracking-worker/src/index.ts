/**
 * Dispatch Worker - Complete D1 Backend
 * All data stored in Cloudflare D1
 *
 * Auth APIs:
 * - POST /api/auth/register - Create user
 * - POST /api/auth/login - Login user
 * - POST /api/auth/logout - Logout user
 * - GET /api/auth/validate - Validate session
 *
 * Config APIs:
 * - GET /api/configs - Get user's SMTP configs (authenticated)
 * - POST /api/configs - Create SMTP config
 * - PUT /api/configs/:id - Update SMTP config
 * - DELETE /api/configs/:id - Delete SMTP config (authenticated)
 *
 * Tracking APIs:
 * - GET /o/:id - Track open (returns pixel)
 * - GET /c/:id - Track click (redirects)
 * - POST /api/email - Register email for tracking (server-to-server)
 * - GET /api/stats - Get tracking stats (authenticated)
 * - GET /api/logs - Get email logs (authenticated)
 * - GET /api/dashboard - Get dashboard stats (authenticated)
 *
 * Suppression APIs:
 * - GET /api/suppressions - Get suppression list (authenticated)
 * - POST /api/suppressions/check - Check emails against suppression list (authenticated)
 */

export interface Env {
  DB: D1Database
  ALLOWED_ORIGINS?: string
  // Optional backend callback for fire-and-forget open/click notifications.
  // Both must be set for callbacks to fire; otherwise skipped silently (backward compatible).
  BACKEND_SYNC_URL?: string
  TRACKING_SYNC_SECRET?: string
}

// 1x1 transparent GIF
const PIXEL = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00,
  0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02,
  0x02, 0x44, 0x01, 0x00, 0x3b,
])

// =============================================================================
// CORS HELPERS
// =============================================================================

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || ''
  const allowedRaw = env.ALLOWED_ORIGINS || ''
  const allowedOrigins = allowedRaw
    ? allowedRaw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : []

  // If no ALLOWED_ORIGINS configured, fall back to wildcard (dev mode)
  const allowOrigin = allowedOrigins.length === 0 ? '*' : allowedOrigins.includes(origin) ? origin : allowedOrigins[0] // deny by returning a non-matching origin

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...(allowOrigin !== '*' ? { Vary: 'Origin' } : {}),
  }
}

// =============================================================================
// MAIN FETCH HANDLER
// =============================================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const corsHeaders = getCorsHeaders(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    try {
      // ========== TRACKING ENDPOINTS (public, no auth) ==========
      if (path.startsWith('/o/')) {
        const trackingId = path.slice(3)
        ctx.waitUntil(recordOpen(env, trackingId, request))
        return pixelResponse()
      }

      if (path.startsWith('/c/')) {
        const trackingId = path.slice(3)
        const targetUrl = url.searchParams.get('url')
        if (!targetUrl) return new Response('Missing URL', { status: 400 })
        ctx.waitUntil(recordClick(env, trackingId, decodeURIComponent(targetUrl), request))
        return Response.redirect(decodeURIComponent(targetUrl), 302)
      }

      // ========== UNSUBSCRIBE ENDPOINT (RFC 8058, public) ==========
      if (path.startsWith('/u/')) {
        const trackingId = path.slice(3)
        if (request.method === 'POST') {
          // One-click unsubscribe (List-Unsubscribe-Post)
          ctx.waitUntil(handleUnsubscribe(env.DB, trackingId, request))
          return new Response('You have been unsubscribed.', {
            status: 200,
            headers: { 'Content-Type': 'text/plain', ...corsHeaders },
          })
        }
        // GET — show confirmation page
        ctx.waitUntil(handleUnsubscribe(env.DB, trackingId, request))
        return new Response(unsubscribePageHtml(trackingId), {
          status: 200,
          headers: { 'Content-Type': 'text/html', ...corsHeaders },
        })
      }

      // ========== PREFERENCE CENTER (public) ==========
      if (path.startsWith('/preferences/')) {
        const trackingId = path.slice('/preferences/'.length)
        if (request.method === 'POST') {
          return handleSavePreferences(env.DB, trackingId, request, corsHeaders)
        }
        // GET — show preference page
        return handleShowPreferences(env.DB, trackingId, corsHeaders)
      }

      // ========== FORM SUBMISSION ENDPOINTS (public) ==========
      if (path.startsWith('/f/')) {
        const formPath = path.slice(3)
        // GET /f/:formId.js — embeddable JavaScript widget
        if (formPath.endsWith('.js') && request.method === 'GET') {
          const formId = formPath.slice(0, -3)
          return handleFormWidget(env.DB, formId, url.origin, corsHeaders)
        }
        // POST /f/:formId — receive form submission
        if (request.method === 'POST') {
          return handleFormSubmission(env.DB, formPath, request, corsHeaders)
        }
        // GET /f/:formId — show hosted form page
        return handleFormPage(env.DB, formPath, corsHeaders)
      }

      // ========== LANDING PAGES (public) ==========
      if (path.startsWith('/p/')) {
        const slug = path.slice(3)
        if (slug) {
          return handleLandingPage(env.DB, slug, url.origin, corsHeaders)
        }
      }

      // ========== BOUNCE WEBHOOK ==========
      if (path === '/api/bounce' && request.method === 'POST') {
        return handleBounceWebhook(env.DB, request, corsHeaders)
      }

      // ========== SUPPRESSION LIST (authenticated) ==========
      if (path === '/api/suppressions' && request.method === 'GET') {
        return handleGetSuppressions(env.DB, request, url, corsHeaders)
      }
      if (path === '/api/suppressions/check' && request.method === 'POST') {
        return handleCheckSuppression(env.DB, request, corsHeaders)
      }

      // ========== AUTH ENDPOINTS ==========
      if (path === '/api/auth/register' && request.method === 'POST') {
        return handleRegister(env.DB, request, corsHeaders)
      }
      if (path === '/api/auth/login' && request.method === 'POST') {
        return handleLogin(env.DB, request, corsHeaders)
      }
      if (path === '/api/auth/logout' && request.method === 'POST') {
        return handleLogout(env.DB, request, corsHeaders)
      }
      if (path === '/api/auth/validate') {
        return handleValidateSession(env.DB, request, corsHeaders)
      }

      // ========== CONFIG ENDPOINTS ==========
      if (path === '/api/configs' && request.method === 'GET') {
        return handleGetConfigs(env.DB, request, corsHeaders)
      }
      if (path === '/api/configs' && request.method === 'POST') {
        return handleCreateConfig(env.DB, request, corsHeaders)
      }
      if (path.startsWith('/api/configs/') && request.method === 'PUT') {
        const configId = path.split('/')[3]
        return handleUpdateConfig(env.DB, configId, request, corsHeaders)
      }
      if (path.startsWith('/api/configs/') && request.method === 'DELETE') {
        const configId = path.split('/')[3]
        return handleDeleteConfig(env.DB, configId, request, corsHeaders)
      }

      // ========== EMAIL/TRACKING ENDPOINTS ==========
      // NOTE: POST /api/email is server-to-server; should use API key auth in the future
      if (path === '/api/email' && request.method === 'POST') {
        return handleRegisterEmail(env.DB, request, corsHeaders)
      }
      if (path === '/api/stats') {
        return handleGetStats(env.DB, request, url, corsHeaders)
      }
      if (path === '/api/logs') {
        return handleGetLogs(env.DB, request, url, corsHeaders)
      }
      if (path === '/api/logs/bulk-delete' && request.method === 'POST') {
        return handleBulkDeleteLogs(env.DB, request, corsHeaders)
      }
      if (path.startsWith('/api/logs/') && request.method === 'DELETE') {
        const logId = path.split('/')[3]
        return handleDeleteLog(env.DB, logId, url, corsHeaders)
      }
      if (path === '/api/dashboard') {
        return handleGetDashboard(env.DB, request, url, corsHeaders)
      }

      if (path === '/health') {
        return json({ status: 'ok', timestamp: new Date().toISOString() }, 200, corsHeaders)
      }

      return new Response('Not Found', { status: 404 })
    } catch (error) {
      console.error('Worker error:', error)
      return json({ success: false, error: String(error) }, 500, corsHeaders)
    }
  },
}

// =============================================================================
// SESSION AUTHENTICATION HELPER
// =============================================================================

async function authenticateRequest(
  db: D1Database,
  request: Request
): Promise<{ userId: string; email: string } | null> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return null

  const session = (await db
    .prepare(
      `
    SELECT s.user_id, u.email, u.name FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `
    )
    .bind(token)
    .first()) as any

  if (!session) return null
  return { userId: session.user_id, email: session.email }
}

// =============================================================================
// AUTH HANDLERS
// =============================================================================

async function handleRegister(
  db: D1Database,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const { email, password, name } = (await request.json()) as any

    if (!email || !password) {
      return json({ success: false, error: 'Email and password required' }, 400, corsHeaders)
    }

    // Check if user exists
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first()
    if (existing) {
      return json({ success: false, error: 'Email already registered' }, 400, corsHeaders)
    }

    // Hash password with PBKDF2 + per-user salt
    const passwordHash = await hashPassword(password)
    const userId = generateId()

    await db
      .prepare(
        `
      INSERT INTO users (id, email, password_hash, name, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `
      )
      .bind(userId, email.toLowerCase(), passwordHash, name || '')
      .run()

    // Create session
    const token = generateToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    await db
      .prepare(
        `
      INSERT INTO sessions (id, user_id, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `
      )
      .bind(generateId(), userId, token, expiresAt)
      .run()

    return json(
      {
        success: true,
        user: { id: userId, email: email.toLowerCase(), name },
        token,
        expiresAt,
      },
      200,
      corsHeaders
    )
  } catch (e) {
    console.error('Register error:', e)
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleLogin(db: D1Database, request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { email, password } = (await request.json()) as any

    if (!email || !password) {
      return json({ success: false, error: 'Email and password required' }, 400, corsHeaders)
    }

    const user = (await db
      .prepare('SELECT id, email, password_hash, name FROM users WHERE email = ? AND is_active = 1')
      .bind(email.toLowerCase())
      .first()) as any

    if (!user) {
      return json({ success: false, error: 'Invalid credentials' }, 401, corsHeaders)
    }

    const validPassword = await verifyPassword(password, user.password_hash)
    if (!validPassword) {
      return json({ success: false, error: 'Invalid credentials' }, 401, corsHeaders)
    }

    // Update last login
    await db.prepare('UPDATE users SET last_login = datetime("now") WHERE id = ?').bind(user.id).run()

    // Create session
    const token = generateToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    await db
      .prepare(
        `
      INSERT INTO sessions (id, user_id, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `
      )
      .bind(generateId(), user.id, token, expiresAt)
      .run()

    return json(
      {
        success: true,
        user: { id: user.id, email: user.email, name: user.name },
        token,
        expiresAt,
      },
      200,
      corsHeaders
    )
  } catch (e) {
    console.error('Login error:', e)
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleLogout(db: D1Database, request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    if (token) {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
    }
    return json({ success: true }, 200, corsHeaders)
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleValidateSession(
  db: D1Database,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return json({ success: false, error: 'No token' }, 401, corsHeaders)
    }

    const session = (await db
      .prepare(
        `
      SELECT s.*, u.email, u.name FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > datetime('now')
    `
      )
      .bind(token)
      .first()) as any

    if (!session) {
      return json({ success: false, error: 'Invalid or expired session' }, 401, corsHeaders)
    }

    return json(
      {
        success: true,
        user: { id: session.user_id, email: session.email, name: session.name },
      },
      200,
      corsHeaders
    )
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

// =============================================================================
// CONFIG HANDLERS
// =============================================================================

async function handleGetConfigs(
  db: D1Database,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Authenticate request — no more trusting user_id from query params
    const auth = await authenticateRequest(db, request)
    if (!auth) return json({ success: false, error: 'Unauthorized' }, 401, corsHeaders)

    // Exclude sensitive columns: password, oauth_access_token, oauth_refresh_token
    const configs = await db
      .prepare(
        `
      SELECT id, user_id, name, host, port, secure, username, from_email, from_name,
             provider_type, oauth_email, oauth_expires_at,
             is_default, created_at, updated_at
      FROM smtp_configs WHERE user_id = ? ORDER BY is_default DESC, created_at DESC
    `
      )
      .bind(auth.userId)
      .all()

    return json({ success: true, configs: configs.results }, 200, corsHeaders)
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleCreateConfig(
  db: D1Database,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const data = (await request.json()) as any
    const {
      user_id,
      name,
      host,
      port,
      secure,
      username,
      password,
      from_email,
      from_name,
      provider_type,
      oauth_email,
      oauth_access_token,
      oauth_refresh_token,
      oauth_expires_at,
      is_default,
    } = data

    if (!user_id || !name) {
      return json({ success: false, error: 'user_id and name required' }, 400, corsHeaders)
    }

    const configId = generateId()

    // If setting as default, unset other defaults
    if (is_default) {
      await db.prepare('UPDATE smtp_configs SET is_default = 0 WHERE user_id = ?').bind(user_id).run()
    }

    await db
      .prepare(
        `
      INSERT INTO smtp_configs (id, user_id, name, host, port, secure, username, password, from_email, from_name,
                                provider_type, oauth_email, oauth_access_token, oauth_refresh_token, oauth_expires_at, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `
      )
      .bind(
        configId,
        user_id,
        name,
        host || '',
        port || 587,
        secure ? 1 : 0,
        username || '',
        password || '',
        from_email || '',
        from_name || '',
        provider_type || 'smtp',
        oauth_email || '',
        oauth_access_token || '',
        oauth_refresh_token || '',
        oauth_expires_at || '',
        is_default ? 1 : 0
      )
      .run()

    return json({ success: true, id: configId }, 200, corsHeaders)
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleUpdateConfig(
  db: D1Database,
  configId: string,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const data = (await request.json()) as any
    const {
      user_id,
      name,
      host,
      port,
      secure,
      username,
      password,
      from_email,
      from_name,
      provider_type,
      oauth_email,
      oauth_access_token,
      oauth_refresh_token,
      oauth_expires_at,
      is_default,
    } = data

    // Verify ownership
    const existing = (await db.prepare('SELECT user_id FROM smtp_configs WHERE id = ?').bind(configId).first()) as any
    if (!existing || existing.user_id !== user_id) {
      return json({ success: false, error: 'Config not found' }, 404, corsHeaders)
    }

    // If setting as default, unset other defaults
    if (is_default) {
      await db.prepare('UPDATE smtp_configs SET is_default = 0 WHERE user_id = ?').bind(user_id).run()
    }

    // Build update query dynamically
    const updates: string[] = ['updated_at = datetime("now")']
    const values: any[] = []

    if (name !== undefined) {
      updates.push('name = ?')
      values.push(name)
    }
    if (host !== undefined) {
      updates.push('host = ?')
      values.push(host)
    }
    if (port !== undefined) {
      updates.push('port = ?')
      values.push(port)
    }
    if (secure !== undefined) {
      updates.push('secure = ?')
      values.push(secure ? 1 : 0)
    }
    if (username !== undefined) {
      updates.push('username = ?')
      values.push(username)
    }
    if (password !== undefined) {
      updates.push('password = ?')
      values.push(password)
    }
    if (from_email !== undefined) {
      updates.push('from_email = ?')
      values.push(from_email)
    }
    if (from_name !== undefined) {
      updates.push('from_name = ?')
      values.push(from_name)
    }
    if (provider_type !== undefined) {
      updates.push('provider_type = ?')
      values.push(provider_type)
    }
    if (oauth_email !== undefined) {
      updates.push('oauth_email = ?')
      values.push(oauth_email)
    }
    if (oauth_access_token !== undefined) {
      updates.push('oauth_access_token = ?')
      values.push(oauth_access_token)
    }
    if (oauth_refresh_token !== undefined) {
      updates.push('oauth_refresh_token = ?')
      values.push(oauth_refresh_token)
    }
    if (oauth_expires_at !== undefined) {
      updates.push('oauth_expires_at = ?')
      values.push(oauth_expires_at)
    }
    if (is_default !== undefined) {
      updates.push('is_default = ?')
      values.push(is_default ? 1 : 0)
    }

    values.push(configId)
    await db
      .prepare(`UPDATE smtp_configs SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run()

    return json({ success: true }, 200, corsHeaders)
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleDeleteConfig(
  db: D1Database,
  configId: string,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Authenticate request — no more trusting user_id from query params
    const auth = await authenticateRequest(db, request)
    if (!auth) return json({ success: false, error: 'Unauthorized' }, 401, corsHeaders)

    const result = await db
      .prepare('DELETE FROM smtp_configs WHERE id = ? AND user_id = ?')
      .bind(configId, auth.userId)
      .run()

    return json({ success: true, deleted: result.meta.changes > 0 }, 200, corsHeaders)
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

// =============================================================================
// TRACKING HANDLERS
// =============================================================================

async function recordOpen(env: Env, trackingId: string, request: Request) {
  const db = env.DB
  try {
    const meta = getRequestMeta(request)

    await db
      .prepare(
        `
      UPDATE emails SET
        status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END,
        opened_at = COALESCE(opened_at, datetime('now')),
        open_count = open_count + 1
      WHERE tracking_id = ?
    `
      )
      .bind(trackingId)
      .run()

    const email = (await db
      .prepare('SELECT id, campaign_id, recipient_email, message_id FROM emails WHERE tracking_id = ?')
      .bind(trackingId)
      .first()) as any

    if (email) {
      await db
        .prepare(
          `
        INSERT INTO tracking_events (id, email_id, campaign_id, recipient_email, event_type, user_agent, ip_address, country, city, device_type, created_at)
        VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, datetime('now'))
      `
        )
        .bind(
          generateId(),
          email.id,
          email.campaign_id,
          email.recipient_email,
          meta.userAgent,
          meta.ip,
          meta.country,
          meta.city,
          meta.device
        )
        .run()

      await db
        .prepare('UPDATE campaigns SET opened_count = opened_count + 1 WHERE id = ?')
        .bind(email.campaign_id)
        .run()

      // Fire-and-forget callback to backend (additive, never blocks the pixel)
      await notifyBackend(env, {
        type: 'open',
        email: email.recipient_email,
        campaignId: email.campaign_id,
        messageId: email.message_id,
      })
    }
  } catch (e) {
    console.error('Record open error:', e)
  }
}

async function recordClick(env: Env, trackingId: string, linkUrl: string, request: Request) {
  const db = env.DB
  try {
    const meta = getRequestMeta(request)

    await db
      .prepare(
        `
      UPDATE emails SET
        status = 'clicked',
        clicked_at = COALESCE(clicked_at, datetime('now')),
        click_count = click_count + 1
      WHERE tracking_id = ?
    `
      )
      .bind(trackingId)
      .run()

    const email = (await db
      .prepare('SELECT id, campaign_id, recipient_email, message_id FROM emails WHERE tracking_id = ?')
      .bind(trackingId)
      .first()) as any

    if (email) {
      await db
        .prepare(
          `
        INSERT INTO tracking_events (id, email_id, campaign_id, recipient_email, event_type, link_url, user_agent, ip_address, country, city, device_type, created_at)
        VALUES (?, ?, ?, ?, 'click', ?, ?, ?, ?, ?, ?, datetime('now'))
      `
        )
        .bind(
          generateId(),
          email.id,
          email.campaign_id,
          email.recipient_email,
          linkUrl,
          meta.userAgent,
          meta.ip,
          meta.country,
          meta.city,
          meta.device
        )
        .run()

      await db
        .prepare('UPDATE campaigns SET clicked_count = clicked_count + 1 WHERE id = ?')
        .bind(email.campaign_id)
        .run()

      // Fire-and-forget callback to backend (additive, never blocks the redirect)
      await notifyBackend(env, {
        type: 'click',
        email: email.recipient_email,
        campaignId: email.campaign_id,
        messageId: email.message_id,
        url: linkUrl,
      })
    }
  } catch (e) {
    console.error('Record click error:', e)
  }
}

// =============================================================================
// BACKEND SYNC CALLBACK (fire-and-forget, additive, non-blocking)
// =============================================================================

interface BackendTrackingEvent {
  type: 'open' | 'click'
  email: string
  campaignId?: string | null
  messageId?: string | null
  url?: string
}

/**
 * Notifies the Dispatch backend of an open/click so it can react (scoring, automations).
 * No-op unless BOTH env.BACKEND_SYNC_URL and env.TRACKING_SYNC_SECRET are configured.
 * Always swallows errors — must never affect the user-facing pixel/redirect.
 */
async function notifyBackend(env: Env, event: BackendTrackingEvent): Promise<void> {
  if (!env.BACKEND_SYNC_URL || !env.TRACKING_SYNC_SECRET) return
  try {
    const body: Record<string, unknown> = {
      type: event.type,
      email: event.email,
      campaignId: event.campaignId ?? null,
      messageId: event.messageId ?? null,
    }
    if (event.type === 'click') body.url = event.url
    await fetch(`${env.BACKEND_SYNC_URL}/api/tracking/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tracking-Secret': env.TRACKING_SYNC_SECRET,
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    console.error('Backend sync error:', e)
  }
}

// NOTE: POST /api/email is server-to-server. Should use API key auth in the future.
async function handleRegisterEmail(
  db: D1Database,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = (await request.json()) as any
    const {
      user_id,
      campaign_id,
      campaign_name,
      subject,
      from_email,
      from_name,
      recipient_email,
      recipient_name,
      send_type,
      provider_type,
      config_name,
      message_id,
    } = body

    const trackingId = generateId()
    const emailId = generateId()

    await db
      .prepare(
        `
      INSERT INTO campaigns (id, user_id, name, subject, from_email, from_name, send_type, provider_type, config_name, total_recipients, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'sending', datetime('now'))
      ON CONFLICT(id) DO UPDATE SET total_recipients = total_recipients + 1
    `
      )
      .bind(
        campaign_id,
        user_id,
        campaign_name || 'Campaign',
        subject,
        from_email,
        from_name || '',
        send_type || 'direct',
        provider_type || 'smtp',
        config_name || ''
      )
      .run()

    await db
      .prepare(
        `
      INSERT INTO emails (id, tracking_id, campaign_id, user_id, recipient_email, recipient_name, subject, send_type, provider_type, config_name, message_id, status, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', datetime('now'))
    `
      )
      .bind(
        emailId,
        trackingId,
        campaign_id,
        user_id,
        recipient_email,
        recipient_name || '',
        subject,
        send_type || 'direct',
        provider_type || 'smtp',
        config_name || '',
        message_id || ''
      )
      .run()

    return json({ success: true, tracking_id: trackingId, email_id: emailId }, 200, corsHeaders)
  } catch (e) {
    console.error('Register email error:', e)
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleGetStats(
  db: D1Database,
  request: Request,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Authenticate request — derive userId from session, not query params
    const auth = await authenticateRequest(db, request)
    if (!auth) return json({ success: false, error: 'Unauthorized' }, 401, corsHeaders)
    const userId = auth.userId

    const campaignId = url.searchParams.get('campaign_id')

    if (campaignId) {
      const campaign = (await db.prepare('SELECT * FROM campaigns WHERE id = ?').bind(campaignId).first()) as any
      if (!campaign) return json({ success: false, error: 'Campaign not found' }, 404, corsHeaders)

      const openRate =
        campaign.total_recipients > 0 ? Math.round((campaign.opened_count / campaign.total_recipients) * 100) : 0
      const clickRate =
        campaign.opened_count > 0 ? Math.round((campaign.clicked_count / campaign.opened_count) * 100) : 0

      return json(
        { success: true, data: { ...campaign, open_rate: openRate, click_rate: clickRate } },
        200,
        corsHeaders
      )
    }

    const stats = (await db
      .prepare(
        `
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status IN ('sent', 'opened', 'clicked') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status IN ('opened', 'clicked') THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN status = 'clicked' THEN 1 ELSE 0 END) as clicked
      FROM emails WHERE user_id = ?
    `
      )
      .bind(userId)
      .first()) as any

    const campaigns = await db
      .prepare('SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(userId)
      .all()

    return json(
      {
        success: true,
        data: {
          stats: {
            ...stats,
            openRate: stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0,
            clickRate: stats.opened > 0 ? Math.round((stats.clicked / stats.opened) * 100) : 0,
          },
          campaigns: campaigns.results,
        },
      },
      200,
      corsHeaders
    )
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleGetLogs(
  db: D1Database,
  request: Request,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Authenticate request — derive userId from session, not query params
    const auth = await authenticateRequest(db, request)
    if (!auth) return json({ success: false, error: 'Unauthorized' }, 401, corsHeaders)
    const userId = auth.userId

    const status = url.searchParams.get('status')
    const sendType = url.searchParams.get('send_type')
    const provider = url.searchParams.get('provider')
    const campaignId = url.searchParams.get('campaign_id')
    const search = url.searchParams.get('search')
    const startDate = url.searchParams.get('start_date')
    const endDate = url.searchParams.get('end_date')
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    let where = 'user_id = ?'
    const params: any[] = [userId]

    if (status) {
      where += ' AND status = ?'
      params.push(status)
    }
    if (sendType) {
      where += ' AND send_type = ?'
      params.push(sendType)
    }
    if (provider) {
      where += ' AND provider_type = ?'
      params.push(provider)
    }
    if (campaignId) {
      where += ' AND campaign_id = ?'
      params.push(campaignId)
    }
    if (search) {
      where += ' AND (recipient_email LIKE ? OR recipient_name LIKE ? OR subject LIKE ?)'
      const s = `%${search}%`
      params.push(s, s, s)
    }
    if (startDate) {
      where += ' AND sent_at >= ?'
      params.push(startDate)
    }
    if (endDate) {
      where += ' AND sent_at <= ?'
      params.push(endDate)
    }

    const countResult = (await db
      .prepare(`SELECT COUNT(*) as count FROM emails WHERE ${where}`)
      .bind(...params)
      .first()) as any
    const total = countResult?.count || 0

    const logs = await db
      .prepare(`SELECT * FROM emails WHERE ${where} ORDER BY sent_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset)
      .all()

    const stats = (await db
      .prepare(
        `
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status IN ('sent', 'opened', 'clicked') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status IN ('opened', 'clicked') THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN status = 'clicked' THEN 1 ELSE 0 END) as clicked
      FROM emails WHERE ${where}
    `
      )
      .bind(...params)
      .first()) as any

    return json(
      {
        success: true,
        logs: logs.results,
        stats: {
          ...stats,
          openRate: stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0,
          clickRate: stats.opened > 0 ? Math.round((stats.clicked / stats.opened) * 100) : 0,
        },
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
      200,
      corsHeaders
    )
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleDeleteLog(
  db: D1Database,
  logId: string,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const userId = url.searchParams.get('user_id')
    if (!userId) return json({ success: false, error: 'user_id required' }, 400, corsHeaders)

    // First delete tracking events for this email
    await db.prepare('DELETE FROM tracking_events WHERE email_id = ?').bind(logId).run()

    // Then delete the email by id OR tracking_id
    await db
      .prepare('DELETE FROM emails WHERE (id = ? OR tracking_id = ?) AND user_id = ?')
      .bind(logId, logId, userId)
      .run()

    return json({ success: true, message: 'Log deleted' }, 200, corsHeaders)
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleBulkDeleteLogs(
  db: D1Database,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const { user_id, ids } = (await request.json()) as { user_id: string; ids: string[] }

    if (!user_id) return json({ success: false, error: 'user_id required' }, 400, corsHeaders)
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return json({ success: false, error: 'ids array required' }, 400, corsHeaders)
    }

    const placeholders = ids.map(() => '?').join(',')

    // First delete tracking events for these emails
    await db
      .prepare(`DELETE FROM tracking_events WHERE email_id IN (${placeholders})`)
      .bind(...ids)
      .run()

    // Then delete the emails by id OR tracking_id
    await db
      .prepare(`DELETE FROM emails WHERE (id IN (${placeholders}) OR tracking_id IN (${placeholders})) AND user_id = ?`)
      .bind(...ids, ...ids, user_id)
      .run()

    return json({ success: true, deleted: ids.length, message: `${ids.length} logs deleted` }, 200, corsHeaders)
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

async function handleGetDashboard(
  db: D1Database,
  request: Request,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Authenticate request — derive userId from session, not query params
    const auth = await authenticateRequest(db, request)
    if (!auth) return json({ success: false, error: 'Unauthorized' }, 401, corsHeaders)
    const userId = auth.userId

    // Get overall stats
    const stats = (await db
      .prepare(
        `
      SELECT 
        COUNT(*) as totalEmails,
        SUM(CASE WHEN status IN ('sent', 'opened', 'clicked') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status IN ('opened', 'clicked') THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN status = 'clicked' THEN 1 ELSE 0 END) as clicked
      FROM emails WHERE user_id = ?
    `
      )
      .bind(userId)
      .first()) as any

    // Get today's stats
    const today = new Date().toISOString().split('T')[0]
    const todayStats = (await db
      .prepare(
        `
      SELECT COUNT(*) as count FROM emails WHERE user_id = ? AND date(sent_at) = ?
    `
      )
      .bind(userId, today)
      .first()) as any

    // Get campaign count
    const campaignCount = (await db
      .prepare('SELECT COUNT(*) as count FROM campaigns WHERE user_id = ?')
      .bind(userId)
      .first()) as any

    // Get recent activity
    const recentEmails = await db
      .prepare(
        `
      SELECT recipient_email, subject, status, sent_at FROM emails 
      WHERE user_id = ? ORDER BY sent_at DESC LIMIT 10
    `
      )
      .bind(userId)
      .all()

    // Get config count
    const configCount = (await db
      .prepare('SELECT COUNT(*) as count FROM smtp_configs WHERE user_id = ?')
      .bind(userId)
      .first()) as any

    return json(
      {
        success: true,
        data: {
          stats: {
            totalEmails: stats?.totalEmails || 0,
            sent: stats?.sent || 0,
            failed: stats?.failed || 0,
            opened: stats?.opened || 0,
            clicked: stats?.clicked || 0,
            openRate: stats?.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0,
            clickRate: stats?.opened > 0 ? Math.round((stats.clicked / stats.opened) * 100) : 0,
            todaySent: todayStats?.count || 0,
            totalCampaigns: campaignCount?.count || 0,
            totalConfigs: configCount?.count || 0,
          },
          recentActivity: recentEmails.results,
        },
      },
      200,
      corsHeaders
    )
  } catch (e) {
    return json({ success: false, error: String(e) }, 500, corsHeaders)
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function pixelResponse(): Response {
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}

function json(data: any, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

// =============================================================================
// CRYPTOGRAPHIC ID & TOKEN GENERATION (crypto.getRandomValues)
// =============================================================================

function generateId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

function generateToken(): string {
  const bytes = new Uint8Array(48)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// =============================================================================
// PASSWORD HASHING — PBKDF2 with per-user random salt
// =============================================================================

function hexEncode(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)

  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 bytes
  )

  return `${hexEncode(salt)}:${hexEncode(derivedBits)}`
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const encoder = new TextEncoder()

  // Support legacy SHA-256 hashes (no colon separator) for backward compatibility
  if (!storedHash.includes(':')) {
    // Legacy format: plain SHA-256 with hardcoded salt
    const data = encoder.encode(password + 'dispatch_salt_2024')
    const hash = await crypto.subtle.digest('SHA-256', data)
    const computed = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return computed === storedHash
  }

  const [saltHex, hashHex] = storedHash.split(':')
  const salt = hexDecode(saltHex)

  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )

  const computed = hexEncode(derivedBits)
  return computed === hashHex
}

// =============================================================================
// REQUEST METADATA
// =============================================================================

function getRequestMeta(request: Request) {
  const ua = request.headers.get('user-agent') || ''
  return {
    userAgent: ua,
    ip: request.headers.get('cf-connecting-ip') || '',
    country: request.headers.get('cf-ipcountry') || '',
    city: request.headers.get('cf-ipcity') || '',
    device: detectDevice(ua),
  }
}

function detectDevice(ua: string): string {
  const l = ua.toLowerCase()
  if (l.includes('mobile') || l.includes('android') || l.includes('iphone')) return 'mobile'
  if (l.includes('tablet') || l.includes('ipad')) return 'tablet'
  if (l.includes('bot') || l.includes('crawler')) return 'bot'
  return 'desktop'
}

// =============================================================================
// UNSUBSCRIBE & BOUNCE HANDLERS (Phase 4 - Compliance)
// =============================================================================

async function handleUnsubscribe(db: D1Database, trackingId: string, request: Request) {
  try {
    // Fix: added .bind(trackingId) — was previously missing
    const email = (await db
      .prepare('SELECT id, campaign_id, user_id, recipient_email FROM emails WHERE tracking_id = ?')
      .bind(trackingId)
      .first()) as any

    if (!email) return

    // Record unsubscribe event
    const meta = getRequestMeta(request)
    await db
      .prepare(
        `INSERT INTO tracking_events (id, email_id, campaign_id, recipient_email, event_type, user_agent, ip_address, country, city, device_type)
       VALUES (?, ?, ?, ?, 'unsubscribe', ?, ?, ?, ?, ?)`
      )
      .bind(
        generateId(),
        email.id,
        email.campaign_id,
        email.recipient_email,
        meta.userAgent,
        meta.ip,
        meta.country,
        meta.city,
        meta.device
      )
      .run()

    // Add to suppression list
    try {
      await db
        .prepare(
          `INSERT OR IGNORE INTO suppressions (id, user_id, email, reason, source, campaign_id)
         VALUES (?, ?, ?, 'unsubscribe', 'one_click', ?)`
        )
        .bind(generateId(), email.user_id, email.recipient_email, email.campaign_id)
        .run()
    } catch {
      // Suppression table may not exist yet — ignore
    }

    // Update email status
    await db.prepare(`UPDATE emails SET status = 'unsubscribed' WHERE tracking_id = ?`).bind(trackingId).run()

    // Update campaign unsubscribe count
    await db
      .prepare(`UPDATE campaigns SET unsubscribed_count = COALESCE(unsubscribed_count, 0) + 1 WHERE id = ?`)
      .bind(email.campaign_id)
      .run()
  } catch (err) {
    console.error('Unsubscribe error:', err)
  }
}

function unsubscribePageHtml(trackingId: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title>
<style>body{margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;color:#18181b;text-align:center}
.card{max-width:480px;margin:60px auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:24px;margin:0 0 16px}p{color:#52525b;line-height:1.6}</style>
</head><body><div class="card"><h1>You've been unsubscribed</h1>
<p>You will no longer receive emails from this sender. This change may take up to 24 hours to take effect.</p>
<p style="color:#a1a1aa;font-size:13px;margin-top:24px">Tracking ID: ${trackingId}</p></div></body></html>`
}

async function handleBounceWebhook(
  db: D1Database,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = (await request.json()) as any

    if (!body.email || !body.user_id) {
      return json({ success: false, message: 'email and user_id required' }, 400, corsHeaders)
    }

    const bounceType = body.bounce_type === 'soft' ? 'soft_bounce' : 'hard_bounce'

    // Add to suppression list (only hard bounces suppress permanently)
    if (bounceType === 'hard_bounce') {
      try {
        await db
          .prepare(
            `INSERT OR IGNORE INTO suppressions (id, user_id, email, reason, source, campaign_id, bounce_code, bounce_message)
           VALUES (?, ?, ?, ?, 'webhook', ?, ?, ?)`
          )
          .bind(
            generateId(),
            body.user_id,
            body.email,
            bounceType,
            body.campaign_id || null,
            body.bounce_code || null,
            body.bounce_message || null
          )
          .run()
      } catch {
        // Table may not exist
      }
    }

    // Record bounce event if we can find the email
    if (body.tracking_id) {
      // Fix: added .bind(body.tracking_id) — was previously missing
      const email = (await db
        .prepare('SELECT id, campaign_id FROM emails WHERE tracking_id = ?')
        .bind(body.tracking_id)
        .first()) as any

      if (email) {
        await db
          .prepare(
            `INSERT INTO tracking_events (id, email_id, campaign_id, recipient_email, event_type)
           VALUES (?, ?, ?, ?, 'bounce')`
          )
          .bind(generateId(), email.id, email.campaign_id, body.email)
          .run()

        await db.prepare(`UPDATE emails SET status = 'bounced' WHERE tracking_id = ?`).bind(body.tracking_id).run()

        await db
          .prepare(`UPDATE campaigns SET bounced_count = COALESCE(bounced_count, 0) + 1 WHERE id = ?`)
          .bind(email.campaign_id)
          .run()
      }
    }

    return json({ success: true, message: `${bounceType} recorded for ${body.email}` }, 200, corsHeaders)
  } catch (err) {
    return json({ success: false, error: String(err) }, 500, corsHeaders)
  }
}

async function handleGetSuppressions(
  db: D1Database,
  request: Request,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Authenticate request — derive userId from session, not query params
    const auth = await authenticateRequest(db, request)
    if (!auth) return json({ success: false, error: 'Unauthorized' }, 401, corsHeaders)
    const userId = auth.userId

    const reason = url.searchParams.get('reason')
    const limit = parseInt(url.searchParams.get('limit') || '100')
    const offset = parseInt(url.searchParams.get('offset') || '0')

    let query = 'SELECT * FROM suppressions WHERE user_id = ?'
    const params: any[] = [userId]

    if (reason) {
      query += ' AND reason = ?'
      params.push(reason)
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const results = await db
      .prepare(query)
      .bind(...params)
      .all()
    return json({ success: true, suppressions: results.results || [] }, 200, corsHeaders)
  } catch (err) {
    return json({ success: false, error: String(err) }, 500, corsHeaders)
  }
}

async function handleCheckSuppression(
  db: D1Database,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Authenticate request — derive userId from session, not body
    const auth = await authenticateRequest(db, request)
    if (!auth) return json({ success: false, error: 'Unauthorized' }, 401, corsHeaders)
    const userId = auth.userId

    const { emails } = (await request.json()) as any
    if (!emails || !Array.isArray(emails)) {
      return json({ success: false, message: 'emails[] required' }, 400, corsHeaders)
    }

    const placeholders = emails.map(() => '?').join(',')
    const results = await db
      .prepare(`SELECT email, reason FROM suppressions WHERE user_id = ? AND email IN (${placeholders})`)
      .bind(userId, ...emails)
      .all()

    const suppressed = new Map<string, string>()
    for (const row of (results.results || []) as any[]) {
      suppressed.set(row.email, row.reason)
    }

    return json(
      {
        success: true,
        suppressed: Object.fromEntries(suppressed),
        clean: emails.filter((e: string) => !suppressed.has(e)),
      },
      200,
      corsHeaders
    )
  } catch (err) {
    return json({ success: false, error: String(err) }, 500, corsHeaders)
  }
}

// =============================================================================
// PREFERENCE CENTER HANDLERS
// =============================================================================

async function handleShowPreferences(
  db: D1Database,
  trackingId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const email = await db
    .prepare('SELECT user_id, recipient_email FROM emails WHERE tracking_id = ?')
    .bind(trackingId)
    .first<{ user_id: string; recipient_email: string }>()

  if (!email) {
    return new Response('Invalid tracking ID', { status: 404, headers: corsHeaders })
  }

  const pref = await db
    .prepare('SELECT preference, reason FROM email_preferences WHERE user_id = ? AND email = ?')
    .bind(email.user_id, email.recipient_email)
    .first<{ preference: string; reason: string }>()

  const currentPref = pref?.preference || 'subscribed'

  return new Response(preferencePageHtml(trackingId, email.recipient_email, currentPref), {
    status: 200,
    headers: { 'Content-Type': 'text/html', ...corsHeaders },
  })
}

async function handleSavePreferences(
  db: D1Database,
  trackingId: string,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const email = await db
    .prepare('SELECT user_id, recipient_email FROM emails WHERE tracking_id = ?')
    .bind(trackingId)
    .first<{ user_id: string; recipient_email: string }>()

  if (!email) {
    return new Response('Invalid tracking ID', { status: 404, headers: corsHeaders })
  }

  let preference: string
  let reason: string | null = null
  let pauseUntil: string | null = null

  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await request.json() as any
    preference = body.preference || 'unsubscribed'
    reason = body.reason || null
  } else {
    const formData = await request.formData()
    preference = (formData.get('preference') as string) || 'unsubscribed'
    reason = formData.get('reason') as string || null
  }

  const validPrefs = ['subscribed', 'campaign_only', 'digest_weekly', 'digest_monthly', 'paused', 'unsubscribed']
  if (!validPrefs.includes(preference)) preference = 'unsubscribed'

  if (preference === 'paused') {
    pauseUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }

  const id = crypto.randomUUID()
  await db
    .prepare(`INSERT INTO email_preferences (id, user_id, email, preference, pause_until, reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, email) DO UPDATE SET preference = ?, pause_until = ?, reason = ?, updated_at = datetime('now')`)
    .bind(id, email.user_id, email.recipient_email, preference, pauseUntil, reason, preference, pauseUntil, reason)
    .run()

  if (preference === 'unsubscribed') {
    const supId = crypto.randomUUID()
    await db
      .prepare(`INSERT OR IGNORE INTO suppressions (id, user_id, email, reason, source)
        VALUES (?, ?, ?, 'unsubscribe', 'preference_center')`)
      .bind(supId, email.user_id, email.recipient_email)
      .run()
  }

  return new Response(preferenceConfirmHtml(preference), {
    status: 200,
    headers: { 'Content-Type': 'text/html', ...corsHeaders },
  })
}

function preferencePageHtml(trackingId: string, emailAddr: string, current: string): string {
  const checked = (val: string) => current === val ? 'checked' : ''
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email Preferences</title>
<style>body{margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;color:#18181b}
.card{max-width:520px;margin:40px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:22px;margin:0 0 8px}p.sub{color:#71717a;margin:0 0 24px;font-size:14px}
label{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid #e4e4e7;border-radius:8px;margin-bottom:8px;cursor:pointer}
label:hover{background:#fafafa}input[type=radio]{margin-top:3px}
.title{font-weight:500;font-size:14px}.desc{color:#71717a;font-size:13px}
.reason{margin-top:16px}textarea{width:100%;padding:8px;border:1px solid #e4e4e7;border-radius:6px;font-size:14px;resize:vertical;min-height:60px;box-sizing:border-box}
button{margin-top:20px;width:100%;padding:12px;background:#18181b;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer}
button:hover{background:#27272a}</style>
</head><body><div class="card">
<h1>Email Preferences</h1>
<p class="sub">Manage how you receive emails at <strong>${emailAddr}</strong></p>
<form method="POST" action="/preferences/${trackingId}">
<label><input type="radio" name="preference" value="subscribed" ${checked('subscribed')}>
<div><div class="title">Keep receiving all emails</div><div class="desc">Continue receiving marketing emails as usual</div></div></label>
<label><input type="radio" name="preference" value="digest_weekly" ${checked('digest_weekly')}>
<div><div class="title">Weekly digest only</div><div class="desc">Receive a summary once per week instead of individual emails</div></div></label>
<label><input type="radio" name="preference" value="digest_monthly" ${checked('digest_monthly')}>
<div><div class="title">Monthly digest only</div><div class="desc">Receive a summary once per month</div></div></label>
<label><input type="radio" name="preference" value="paused" ${checked('paused')}>
<div><div class="title">Pause for 30 days</div><div class="desc">Stop emails temporarily, they resume automatically</div></div></label>
<label><input type="radio" name="preference" value="unsubscribed" ${checked('unsubscribed')}>
<div><div class="title">Unsubscribe from all</div><div class="desc">Stop all marketing emails from this sender</div></div></label>
<div class="reason"><label for="reason" style="display:block;border:none;padding:0;margin-bottom:6px;font-size:13px;color:#71717a">Reason (optional)</label>
<textarea id="reason" name="reason" placeholder="Too many emails, not relevant, etc."></textarea></div>
<button type="submit">Save Preferences</button>
</form></div></body></html>`
}

function preferenceConfirmHtml(preference: string): string {
  const messages: Record<string, string> = {
    subscribed: 'You will continue receiving emails as usual.',
    campaign_only: 'You will only receive campaign-specific emails.',
    digest_weekly: 'You will receive a weekly digest instead of individual emails.',
    digest_monthly: 'You will receive a monthly digest instead of individual emails.',
    paused: 'Your emails have been paused for 30 days.',
    unsubscribed: 'You have been unsubscribed from all marketing emails.',
  }
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preferences Updated</title>
<style>body{margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;color:#18181b;text-align:center}
.card{max-width:480px;margin:60px auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:24px;margin:0 0 16px}p{color:#52525b;line-height:1.6}</style>
</head><body><div class="card"><h1>Preferences Updated</h1>
<p>${messages[preference] || 'Your preferences have been saved.'}</p>
</div></body></html>`
}

// =============================================================================
// FORM SUBMISSION HANDLERS
// =============================================================================

async function handleFormSubmission(
  db: D1Database,
  formId: string,
  request: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const form = await db
      .prepare('SELECT * FROM form_endpoints WHERE id = ? AND status = ?')
      .bind(formId, 'active')
      .first() as any

    if (!form) {
      return json({ success: false, error: 'Form not found or inactive' }, 404, corsHeaders)
    }

    // Check allowed domains
    const allowedDomains: string[] = JSON.parse(form.allowed_domains || '[]')
    if (allowedDomains.length > 0) {
      const origin = request.headers.get('Origin') || request.headers.get('Referer') || ''
      const allowed = allowedDomains.some((d: string) => origin.startsWith(d))
      if (!allowed) {
        return json({ success: false, error: 'Origin not allowed' }, 403, corsHeaders)
      }
    }

    // Parse body
    let data: Record<string, string>
    const contentType = request.headers.get('Content-Type') || ''
    if (contentType.includes('application/json')) {
      data = await request.json() as Record<string, string>
    } else {
      const formData = await request.formData()
      data = {} as Record<string, string>
      formData.forEach((value, key) => { data[key] = String(value) })
    }

    // Validate required fields
    const requiredFields: string[] = JSON.parse(form.required_fields || '["email"]')
    for (const field of requiredFields) {
      if (!data[field] || String(data[field]).trim() === '') {
        if (contentType.includes('json')) {
          return json({ success: false, error: `Missing required field: ${field}` }, 400, corsHeaders)
        }
        return new Response(`Missing required field: ${field}`, { status: 400, headers: corsHeaders })
      }
    }

    // Record submission
    const subId = generateId()
    const ip = request.headers.get('CF-Connecting-IP') || ''
    const ua = request.headers.get('User-Agent') || ''

    await db.prepare(
      `INSERT INTO form_submissions (id, form_id, data, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`
    ).bind(subId, formId, JSON.stringify(data), ip, ua).run()

    // Increment submission count
    await db.prepare(
      'UPDATE form_endpoints SET submission_count = submission_count + 1 WHERE id = ?'
    ).bind(formId).run()

    // Redirect or return JSON
    if (form.redirect_url && !contentType.includes('json')) {
      return Response.redirect(form.redirect_url, 302)
    }

    return json({
      success: true,
      message: form.success_message || 'Thank you for subscribing!',
    }, 200, { ...corsHeaders, 'Access-Control-Allow-Origin': '*' })
  } catch (err) {
    return json({ success: false, error: String(err) }, 500, corsHeaders)
  }
}

async function handleFormPage(
  db: D1Database,
  formId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const form = await db
    .prepare('SELECT * FROM form_endpoints WHERE id = ? AND status = ?')
    .bind(formId, 'active')
    .first() as any

  if (!form) {
    return new Response('Form not found', { status: 404, headers: corsHeaders })
  }

  const fieldMapping: Record<string, string> = JSON.parse(form.field_mapping || '{}')
  const requiredFields: string[] = JSON.parse(form.required_fields || '["email"]')

  const inputFields = Object.keys(fieldMapping).map(f => {
    const required = requiredFields.includes(f) ? ' required' : ''
    const type = f === 'email' ? 'email' : 'text'
    return `<div class="field"><label for="${f}">${f.charAt(0).toUpperCase() + f.slice(1)}</label>
<input type="${type}" id="${f}" name="${f}" placeholder="Enter your ${f}"${required}></div>`
  }).join('\n')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(form.name)}</title>
<style>body{margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;color:#18181b}
.card{max-width:480px;margin:40px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{font-size:22px;margin:0 0 24px}.field{margin-bottom:16px}label{display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:#52525b}
input{width:100%;padding:10px 12px;border:1px solid #e4e4e7;border-radius:8px;font-size:14px;box-sizing:border-box}input:focus{outline:none;border-color:#18181b}
button{margin-top:8px;width:100%;padding:12px;background:#18181b;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer}
button:hover{background:#27272a}.msg{display:none;padding:12px;border-radius:8px;margin-top:16px;font-size:14px}
.msg.ok{display:block;background:#dcfce7;color:#166534}.msg.err{display:block;background:#fee2e2;color:#991b1b}</style>
</head><body><div class="card">
<h1>${escapeHtml(form.name)}</h1>
<form id="dispatch-form" action="/f/${formId}" method="POST">
${inputFields}
<button type="submit">Subscribe</button>
</form>
<div id="msg" class="msg"></div>
<script>
document.getElementById('dispatch-form').addEventListener('submit',function(e){
e.preventDefault();var f=this;var d=new FormData(f);
fetch(f.action,{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify(Object.fromEntries(d))}).then(function(r){return r.json()}).then(function(r){
var m=document.getElementById('msg');
if(r.success){m.className='msg ok';m.textContent=r.message;f.reset()}
else{m.className='msg err';m.textContent=r.error||'Something went wrong'}
}).catch(function(){document.getElementById('msg').className='msg err';
document.getElementById('msg').textContent='Network error'})})
</script></div></body></html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html', ...corsHeaders },
  })
}

async function handleFormWidget(
  db: D1Database,
  formId: string,
  origin: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const form = await db
    .prepare('SELECT * FROM form_endpoints WHERE id = ? AND status = ?')
    .bind(formId, 'active')
    .first() as any

  if (!form) {
    return new Response('// Form not found', {
      status: 404,
      headers: { 'Content-Type': 'application/javascript', ...corsHeaders },
    })
  }

  const fieldMapping: Record<string, string> = JSON.parse(form.field_mapping || '{}')
  const requiredFields: string[] = JSON.parse(form.required_fields || '["email"]')

  const fields = Object.keys(fieldMapping).map(f => {
    const req = requiredFields.includes(f) ? 'required' : ''
    const type = f === 'email' ? 'email' : 'text'
    return `{name:"${f}",type:"${type}",label:"${f.charAt(0).toUpperCase() + f.slice(1)}",required:${!!req}}`
  }).join(',')

  const js = `(function(){
var cid="dispatch-form-${formId}";
var el=document.getElementById(cid);if(!el)return;
var fields=[${fields}];
var form=document.createElement('form');
form.style.cssText='font-family:-apple-system,BlinkMacSystemFont,sans-serif';
fields.forEach(function(f){
var d=document.createElement('div');d.style.marginBottom='12px';
var l=document.createElement('label');l.textContent=f.label;l.style.cssText='display:block;font-size:13px;margin-bottom:4px';
var i=document.createElement('input');i.type=f.type;i.name=f.name;i.placeholder='Enter your '+f.name;
i.style.cssText='width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;font-size:14px';
if(f.required)i.required=true;d.appendChild(l);d.appendChild(i);form.appendChild(d)});
var btn=document.createElement('button');btn.type='submit';btn.textContent='Subscribe';
btn.style.cssText='width:100%;padding:10px;background:#18181b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px';
form.appendChild(btn);
var msg=document.createElement('div');msg.style.cssText='display:none;padding:10px;border-radius:6px;margin-top:12px;font-size:13px';
form.appendChild(msg);
form.addEventListener('submit',function(e){e.preventDefault();
var d=new FormData(form);
fetch('${origin}/f/${formId}',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify(Object.fromEntries(d))}).then(function(r){return r.json()}).then(function(r){
if(r.success){msg.style.display='block';msg.style.background='#dcfce7';msg.style.color='#166534';msg.textContent=r.message;form.reset()}
else{msg.style.display='block';msg.style.background='#fee2e2';msg.style.color='#991b1b';msg.textContent=r.error||'Error'}
}).catch(function(){msg.style.display='block';msg.style.background='#fee2e2';msg.style.color='#991b1b';msg.textContent='Network error'})});
el.appendChild(form)})();`

  return new Response(js, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=300',
      ...corsHeaders,
      'Access-Control-Allow-Origin': '*',
    },
  })
}

// =============================================================================
// LANDING PAGE HANDLER
// =============================================================================

async function handleLandingPage(
  db: D1Database,
  slug: string,
  origin: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const page = await db
    .prepare('SELECT * FROM landing_pages WHERE slug = ? AND published = 1')
    .bind(slug)
    .first() as any

  if (!page) {
    return new Response('Page not found', { status: 404, headers: corsHeaders })
  }

  // Increment visit count
  await db.prepare('UPDATE landing_pages SET visit_count = visit_count + 1 WHERE id = ?').bind(page.id).run()

  // Build form embed if configured
  let formEmbed = ''
  if (page.form_id) {
    formEmbed = `<script src="${origin}/f/${page.form_id}.js"></script>`
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)}</title>
  ${page.meta_description ? `<meta name="description" content="${escapeHtml(page.meta_description)}">` : ''}
  ${page.meta_image ? `<meta property="og:image" content="${escapeHtml(page.meta_image)}">` : ''}
  <meta property="og:title" content="${escapeHtml(page.title)}">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;background:#fff;line-height:1.6}
    a{color:#3b82f6}
    ${page.css_content || ''}
  </style>
</head>
<body>
  ${page.html_content || ''}
  ${formEmbed}
  ${page.tracking_enabled ? `<img src="${origin}/o/${page.id}" width="1" height="1" style="display:none" alt="">` : ''}
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=60', ...corsHeaders },
  })
}

function escapeHtml(str: string): string {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
