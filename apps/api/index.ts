/**
 * API Entry Point
 * Runs shared boot prerequisites (migrations/seeds/encryption/config), starts the
 * background workers, then exports the Hono app for the Bun runtime. Queue SENDING
 * runs in the separate worker.ts process — this process only enqueues + serves HTTP.
 *
 * Tests never import this file — they import src/* directly and inject a PGlite db —
 * and the NODE_ENV guard keeps the bun-sql driver out of the test runtime.
 */
import app, { startBackgroundWorkers, stopBackgroundWorkers } from './src/app'
import { boot } from './src/boot'
import { logger } from './src/utils/logger'

if (process.env.NODE_ENV !== 'test') {
  await boot()
  await startBackgroundWorkers()

  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully...`)
    stopBackgroundWorkers()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

export default app
