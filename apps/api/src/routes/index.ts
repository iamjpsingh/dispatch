/**
 * Root Routes
 * API information and documentation endpoint
 */
import { Hono } from 'hono'
import { API, SERVER } from '../config'
import { ROUTE_GROUPS } from '../config/routes'

/**
 * GET /
 * API information and available endpoints
 */
const indexRoutes = new Hono()
  .get('/', (c) => {
    return c.json({
      success: true,
      name: API.NAME,
      version: API.VERSION,
      documentation: {
        message: 'API is running. Use the Vue frontend for the UI.',
        frontend: SERVER.FRONTEND_URL,
      },
      endpoints: Object.fromEntries(
        Object.entries(ROUTE_GROUPS).map(([key, group]) => [
          key.toLowerCase(),
          `${group.prefix}/*`,
        ])
      ),
    })
  })

export default indexRoutes
export type IndexRoutes = typeof indexRoutes
