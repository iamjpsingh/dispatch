/**
 * Route Configuration
 * Single source of truth for all API routes
 */

// API Route Prefixes - used by both backend and frontend proxy
export const API_ROUTES = [
  '/auth',
  '/oauth',
  '/user',
  '/config',
  '/send',
  '/report',
  '/dashboard',
  '/track',
  '/batch-status',
  '/batch-pause',
  '/batch-resume',
  '/batch-cancel',
  '/scheduled-jobs',
  '/parse-excel',
  '/provider-info',
  '/test-notification',
  '/public',
  '/health',
  // Phase 2/3 routes
  '/queue',
  '/contacts',
  '/events',
  '/templates',
  '/campaigns',
  '/segments',
  '/webhooks',
  '/automations',
  '/api-keys',
  '/routing',
  '/warmup',
  '/analytics',
  '/plugins',
] as const

// Route Groups for documentation
export const ROUTE_GROUPS = {
  AUTH: {
    prefix: '/auth',
    endpoints: [
      { method: 'POST', path: '/login', description: 'User login' },
      { method: 'POST', path: '/register', description: 'User registration' },
      { method: 'POST', path: '/logout', description: 'User logout' },
      { method: 'GET', path: '/me', description: 'Get current user' },
    ],
  },
  OAUTH: {
    prefix: '/oauth',
    endpoints: [
      { method: 'GET', path: '/status', description: 'OAuth provider status' },
      { method: 'GET', path: '/google/connect', description: 'Initiate Google OAuth' },
      { method: 'GET', path: '/microsoft/connect', description: 'Initiate Microsoft OAuth' },
      { method: 'POST', path: '/:configId/test', description: 'Test OAuth connection' },
      { method: 'DELETE', path: '/:configId/disconnect', description: 'Disconnect OAuth' },
    ],
  },
  CONFIG: {
    prefix: '/config',
    endpoints: [
      { method: 'GET', path: '/list', description: 'List all configs' },
      { method: 'GET', path: '/smtp', description: 'Get SMTP configs' },
      { method: 'POST', path: '/create', description: 'Create config' },
      { method: 'POST', path: '/smtp/test', description: 'Test SMTP connection' },
      { method: 'DELETE', path: '/delete/:id', description: 'Delete config' },
    ],
  },
  SEND: {
    prefix: '/send',
    endpoints: [
      { method: 'POST', path: '/', description: 'Send emails' },
      { method: 'POST', path: '/parse-excel', description: 'Parse Excel file' },
      { method: 'POST', path: '/provider-info', description: 'Get provider info' },
    ],
  },
  BATCH: {
    prefix: '/batch',
    endpoints: [
      { method: 'GET', path: '-status', description: 'Get batch status' },
      { method: 'POST', path: '-pause', description: 'Pause batch job' },
      { method: 'POST', path: '-resume', description: 'Resume batch job' },
      { method: 'DELETE', path: '-cancel', description: 'Cancel batch job' },
    ],
  },
  SCHEDULE: {
    prefix: '/scheduled-jobs',
    endpoints: [
      { method: 'GET', path: '/', description: 'List scheduled jobs' },
      { method: 'DELETE', path: '/:id', description: 'Cancel scheduled job' },
    ],
  },
  REPORT: {
    prefix: '/report',
    endpoints: [
      { method: 'GET', path: '/', description: 'Get reports' },
      { method: 'GET', path: '/logs', description: 'Get logs with filtering' },
      { method: 'GET', path: '/stats', description: 'Get email statistics' },
      { method: 'GET', path: '/campaigns', description: 'Get campaigns list' },
      { method: 'GET', path: '/campaigns/:id', description: 'Get campaign details' },
      { method: 'GET', path: '/export/csv', description: 'Export as CSV' },
      { method: 'GET', path: '/export/json', description: 'Export as JSON' },
      { method: 'DELETE', path: '/clear', description: 'Clear local logs' },
    ],
  },
  DASHBOARD: {
    prefix: '/dashboard',
    endpoints: [
      { method: 'GET', path: '/stats', description: 'Dashboard stats' },
      { method: 'GET', path: '/poll-status', description: 'Polling status' },
      { method: 'GET', path: '/data', description: 'Dashboard data' },
    ],
  },
  TRACKING: {
    prefix: '/track',
    endpoints: [
      { method: 'GET', path: '/status', description: 'Tracking status' },
      { method: 'GET', path: '/open/:emailLogId', description: 'Track email open (pixel)' },
      { method: 'GET', path: '/click/:emailLogId', description: 'Track link click' },
    ],
  },
  // Phase 2 route groups
  QUEUE: {
    prefix: '/queue',
    endpoints: [
      { method: 'GET', path: '/jobs', description: 'List queue jobs' },
      { method: 'POST', path: '/jobs/:id/pause', description: 'Pause a queue job' },
      { method: 'POST', path: '/jobs/:id/resume', description: 'Resume a queue job' },
      { method: 'DELETE', path: '/jobs/:id', description: 'Delete a queue job' },
      { method: 'GET', path: '/stats', description: 'Get queue statistics' },
      { method: 'GET', path: '/dead-letters', description: 'List dead-letter jobs' },
      { method: 'GET', path: '/suppression', description: 'List suppressed emails' },
      { method: 'POST', path: '/suppression', description: 'Add email to suppression list' },
      { method: 'DELETE', path: '/suppression/:email', description: 'Remove email from suppression list' },
    ],
  },
  CONTACTS: {
    prefix: '/contacts',
    endpoints: [
      { method: 'GET', path: '/', description: 'List contacts' },
      { method: 'POST', path: '/', description: 'Create contact' },
      { method: 'PUT', path: '/:id', description: 'Update contact' },
      { method: 'DELETE', path: '/:id', description: 'Delete contact' },
      { method: 'POST', path: '/import', description: 'Import contacts from file' },
      { method: 'POST', path: '/validate', description: 'Validate contact emails' },
    ],
  },
  EVENTS: {
    prefix: '/events',
    endpoints: [{ method: 'GET', path: '/stream', description: 'SSE real-time event stream' }],
  },
  TEMPLATES: {
    prefix: '/templates',
    endpoints: [
      { method: 'GET', path: '/', description: 'List templates' },
      { method: 'POST', path: '/', description: 'Create template' },
      { method: 'GET', path: '/:id', description: 'Get template by ID' },
      { method: 'PUT', path: '/:id', description: 'Update template' },
      { method: 'DELETE', path: '/:id', description: 'Delete template' },
    ],
  },
  CAMPAIGNS: {
    prefix: '/campaigns',
    endpoints: [
      { method: 'GET', path: '/', description: 'List campaigns' },
      { method: 'POST', path: '/', description: 'Create campaign' },
      { method: 'GET', path: '/:id', description: 'Get campaign by ID' },
      { method: 'PUT', path: '/:id', description: 'Update campaign' },
      { method: 'DELETE', path: '/:id', description: 'Delete campaign' },
      { method: 'GET', path: '/:id/stats', description: 'Get campaign statistics' },
    ],
  },
  SEGMENTS: {
    prefix: '/segments',
    endpoints: [
      { method: 'GET', path: '/', description: 'List segments' },
      { method: 'POST', path: '/', description: 'Create segment' },
      { method: 'GET', path: '/:id', description: 'Get segment by ID' },
      { method: 'PUT', path: '/:id', description: 'Update segment' },
      { method: 'DELETE', path: '/:id', description: 'Delete segment' },
      { method: 'GET', path: '/:id/contacts', description: 'List contacts in segment' },
    ],
  },
  WEBHOOKS: {
    prefix: '/webhooks',
    endpoints: [
      { method: 'GET', path: '/', description: 'List webhooks' },
      { method: 'POST', path: '/', description: 'Create webhook' },
      { method: 'PUT', path: '/:id', description: 'Update webhook' },
      { method: 'DELETE', path: '/:id', description: 'Delete webhook' },
    ],
  },
  AUTOMATIONS: {
    prefix: '/automations',
    endpoints: [
      { method: 'GET', path: '/', description: 'List automations' },
      { method: 'POST', path: '/', description: 'Create automation' },
      { method: 'GET', path: '/:id', description: 'Get automation by ID' },
      { method: 'PUT', path: '/:id', description: 'Update automation' },
      { method: 'DELETE', path: '/:id', description: 'Delete automation' },
      { method: 'POST', path: '/:id/activate', description: 'Activate automation' },
      { method: 'POST', path: '/:id/deactivate', description: 'Deactivate automation' },
    ],
  },
  APIKEYS: {
    prefix: '/api-keys',
    endpoints: [
      { method: 'GET', path: '/', description: 'List API keys' },
      { method: 'POST', path: '/', description: 'Create API key' },
      { method: 'DELETE', path: '/:id', description: 'Delete API key' },
      { method: 'POST', path: '/:id/revoke', description: 'Revoke API key' },
    ],
  },
  // Phase 3 route groups
  ROUTING: {
    prefix: '/routing',
    endpoints: [
      { method: 'GET', path: '/config', description: 'Get routing configuration' },
      { method: 'PUT', path: '/config', description: 'Update routing configuration' },
      { method: 'GET', path: '/stats', description: 'Get routing statistics' },
    ],
  },
  WARMUP: {
    prefix: '/warmup',
    endpoints: [
      { method: 'GET', path: '/plans', description: 'List warmup plans' },
      { method: 'POST', path: '/plans', description: 'Create warmup plan' },
      { method: 'GET', path: '/plans/:id', description: 'Get warmup plan by ID' },
      { method: 'DELETE', path: '/plans/:id', description: 'Delete warmup plan' },
    ],
  },
  ANALYTICS: {
    prefix: '/analytics',
    endpoints: [
      { method: 'GET', path: '/summary', description: 'Get analytics summary' },
      { method: 'GET', path: '/campaigns/:id', description: 'Get campaign analytics' },
      { method: 'GET', path: '/reports', description: 'Get analytics reports' },
    ],
  },
  PLUGINS: {
    prefix: '/plugins',
    endpoints: [
      { method: 'GET', path: '/', description: 'List plugins' },
      { method: 'POST', path: '/:id/enable', description: 'Enable plugin' },
      { method: 'POST', path: '/:id/disable', description: 'Disable plugin' },
      { method: 'GET', path: '/:id/config', description: 'Get plugin configuration' },
      { method: 'PUT', path: '/:id/config', description: 'Update plugin configuration' },
    ],
  },
} as const

export type ApiRoute = (typeof API_ROUTES)[number]
