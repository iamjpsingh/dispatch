/**
 * Centralized Logger
 * Replaces scattered console.log/error calls with a structured logger
 * that respects log levels based on environment.
 *
 * In production, only warn/error are shown.
 * In development, all levels are shown.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const currentLevel: LogLevel =
  process.env.NODE_ENV === 'production' ? 'warn' : (process.env.LOG_LEVEL as LogLevel) || 'info'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]
}

export const logger = {
  debug(...args: unknown[]) {
    if (shouldLog('debug')) console.log(...args)
  },
  info(...args: unknown[]) {
    if (shouldLog('info')) console.log(...args)
  },
  warn(...args: unknown[]) {
    if (shouldLog('warn')) console.warn(...args)
  },
  error(...args: unknown[]) {
    if (shouldLog('error')) console.error(...args)
  },
  /** Always logs regardless of level — use for startup banners only */
  startup(...args: unknown[]) {
    console.log(...args)
  },
}
