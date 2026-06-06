import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('logger', () => {
  let originalEnv: string | undefined
  let originalLogLevel: string | undefined

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV
    originalLogLevel = process.env.LOG_LEVEL
  })

  afterEach(() => {
    // Restore env
    if (originalEnv !== undefined) {
      process.env.NODE_ENV = originalEnv
    } else {
      delete process.env.NODE_ENV
    }
    if (originalLogLevel !== undefined) {
      process.env.LOG_LEVEL = originalLogLevel
    } else {
      delete process.env.LOG_LEVEL
    }
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('info() calls console.log in development', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.LOG_LEVEL

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    vi.resetModules()
    const { logger } = await import('../../src/utils/logger')
    logger.info('test info message')

    expect(consoleSpy).toHaveBeenCalledWith('test info message')
  })

  it('error() calls console.error', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.LOG_LEVEL

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.resetModules()
    const { logger } = await import('../../src/utils/logger')
    logger.error('test error message')

    expect(consoleSpy).toHaveBeenCalledWith('test error message')
  })

  it('warn() calls console.warn', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.LOG_LEVEL

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.resetModules()
    const { logger } = await import('../../src/utils/logger')
    logger.warn('test warn message')

    expect(consoleSpy).toHaveBeenCalledWith('test warn message')
  })

  it('debug() does not log when level is info (default)', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.LOG_LEVEL

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    vi.resetModules()
    const { logger } = await import('../../src/utils/logger')
    logger.debug('debug message')

    // Default level is 'info', so debug should NOT log
    expect(consoleSpy).not.toHaveBeenCalledWith('debug message')
  })

  it('debug() logs when LOG_LEVEL=debug', async () => {
    process.env.NODE_ENV = 'development'
    process.env.LOG_LEVEL = 'debug'

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    vi.resetModules()
    const { logger } = await import('../../src/utils/logger')
    logger.debug('debug message')

    expect(consoleSpy).toHaveBeenCalledWith('debug message')
  })

  it('startup() always logs regardless of level', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.LOG_LEVEL

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    vi.resetModules()
    const { logger } = await import('../../src/utils/logger')
    logger.startup('startup banner')

    expect(consoleSpy).toHaveBeenCalledWith('startup banner')
  })

  it('production mode suppresses info and debug', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.LOG_LEVEL

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.resetModules()
    const { logger } = await import('../../src/utils/logger')

    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error')

    // In production, level is 'warn', so debug and info should not log
    expect(logSpy).not.toHaveBeenCalledWith('debug')
    expect(logSpy).not.toHaveBeenCalledWith('info')
    expect(warnSpy).toHaveBeenCalledWith('warn')
    expect(errorSpy).toHaveBeenCalledWith('error')
  })

  it('passes multiple arguments through', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.LOG_LEVEL

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    vi.resetModules()
    const { logger } = await import('../../src/utils/logger')
    logger.info('message', { detail: 'value' }, 42)

    expect(consoleSpy).toHaveBeenCalledWith('message', { detail: 'value' }, 42)
  })
})
