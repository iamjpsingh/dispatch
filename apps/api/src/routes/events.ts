// src/routes/events.ts - Server-Sent Events (SSE) Streaming

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { requireAuth } from '../middleware/auth'
import { eventBus, type EventPayload } from '../services/eventBus'

const app = new Hono()

/**
 * GET /events/stream - SSE endpoint for real-time updates
 * Streams events for the authenticated user
 */
app.get('/events/stream', async (c) => {
  const user = requireAuth(c)

  return streamSSE(c, async (stream) => {
    // Send initial heartbeat
    await stream.writeSSE({ data: JSON.stringify({ type: 'connected', userId: user.id }), event: 'connected' })

    // Register SSE client
    const unsubscribe = eventBus.addSSEClient(user.id, (event: EventPayload) => {
      stream.writeSSE({
        data: JSON.stringify(event),
        event: event.type,
        id: `${Date.now()}`,
      }).catch(() => {
        // Client disconnected
        unsubscribe()
      })
    })

    // Heartbeat every 30 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      stream.writeSSE({
        data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }),
        event: 'heartbeat',
      }).catch(() => {
        clearInterval(heartbeat)
        unsubscribe()
      })
    }, 30000)

    // Clean up on disconnect
    stream.onAbort(() => {
      clearInterval(heartbeat)
      unsubscribe()
    })

    // Keep the stream open
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  })
})

/**
 * GET /events/status - Get SSE connection stats
 */
app.get('/events/status', (c) => {
  return c.json({
    success: true,
    data: {
      activeClients: eventBus.getSSEClientCount(),
    },
  })
})

export default app
