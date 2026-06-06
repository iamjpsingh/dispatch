import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fs before importing logService
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('[]'),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}))

vi.mock('csv-stringify/sync', () => ({
  stringify: vi.fn((data: any[], opts: any) => {
    if (!data || data.length === 0) return ''
    const cols = opts.columns as string[]
    const header = cols.join(',')
    const rows = data.map((row: any) => cols.map((c: string) => row[c] ?? '').join(','))
    return [header, ...rows].join('\n')
  }),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    startup: vi.fn(),
  },
}))

// We need to dynamically import to pick up mocks
let LogServiceModule: any

beforeEach(async () => {
  vi.resetModules()
  // Re-apply mocks after reset
  vi.doMock('fs/promises', () => ({
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('[]'),
    mkdir: vi.fn().mockResolvedValue(undefined),
  }))
  vi.doMock('fs', () => ({
    existsSync: vi.fn().mockReturnValue(true),
  }))
  vi.doMock('csv-stringify/sync', () => ({
    stringify: vi.fn((data: any[], opts: any) => {
      if (!data || data.length === 0) return ''
      const cols = opts.columns as string[]
      const header = cols.join(',')
      const rows = data.map((row: any) => cols.map((c: string) => row[c] ?? '').join(','))
      return [header, ...rows].join('\n')
    }),
  }))
  vi.doMock('../../src/utils/logger', () => ({
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      startup: vi.fn(),
    },
  }))

  LogServiceModule = await import('../../src/services/logService')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LogService', () => {
  it('adds a log entry and retrieves it', () => {
    const { logService } = LogServiceModule

    logService.addLog({
      id: 'test_1',
      email: 'alice@example.com',
      status: 'Sent',
      timestamp: new Date().toISOString(),
      messageId: 'msg_1',
      firstName: 'Alice',
      company: 'Acme',
      subject: 'Hello',
    })

    const logs = logService.getLogs()
    expect(logs.length).toBeGreaterThanOrEqual(1)
    const found = logs.find((l: any) => l.id === 'test_1')
    expect(found).toBeDefined()
    expect(found.email).toBe('alice@example.com')
    expect(found.status).toBe('Sent')
  })

  it('clears all logs', () => {
    const { logService } = LogServiceModule

    logService.addLog({
      id: 'test_2',
      email: 'bob@example.com',
      status: 'Sent',
      timestamp: new Date().toISOString(),
    })

    logService.clearLogs()
    expect(logService.getLogs()).toHaveLength(0)
  })

  it('deletes a specific log by id', () => {
    const { logService } = LogServiceModule

    logService.addLog({
      id: 'test_del_1',
      email: 'del1@example.com',
      status: 'Sent',
      timestamp: new Date().toISOString(),
    })
    logService.addLog({
      id: 'test_del_2',
      email: 'del2@example.com',
      status: 'Failed',
      timestamp: new Date().toISOString(),
    })

    logService.deleteLog('test_del_1')
    const logs = logService.getLogs()
    expect(logs.find((l: any) => l.id === 'test_del_1')).toBeUndefined()
    expect(logs.find((l: any) => l.id === 'test_del_2')).toBeDefined()
  })

  it('returns correct stats', () => {
    const { logService } = LogServiceModule

    logService.clearLogs()

    logService.addLog({ id: '1', email: 'a@b.com', status: 'Sent', timestamp: '' })
    logService.addLog({ id: '2', email: 'b@b.com', status: 'Sent', timestamp: '' })
    logService.addLog({ id: '3', email: 'c@b.com', status: 'Failed', timestamp: '' })
    logService.addLog({ id: '4', email: 'd@b.com', status: 'Error', timestamp: '' })

    const stats = logService.getStats()
    expect(stats.total).toBe(4)
    expect(stats.sent).toBe(2)
    expect(stats.failed).toBe(1)
    expect(stats.errors).toBe(1)
  })

  it('returns logs as JSON string', () => {
    const { logService } = LogServiceModule
    logService.clearLogs()

    logService.addLog({ id: 'json_1', email: 'x@y.com', status: 'Sent', timestamp: '2024-01-01' })

    const jsonStr = logService.getLogsAsJSON()
    const parsed = JSON.parse(jsonStr)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0].id).toBe('json_1')
  })

  it('returns logs as CSV string', () => {
    const { logService } = LogServiceModule
    logService.clearLogs()

    logService.addLog({ id: 'csv_1', email: 'x@y.com', status: 'Sent', timestamp: '2024-01-01' })

    const csv = logService.getLogsAsCSV()
    expect(typeof csv).toBe('string')
    // CSV should contain header and at least one row
    expect(csv).toContain('id')
    expect(csv).toContain('email')
  })

  it('getStats returns zeros when no logs exist', () => {
    const { logService } = LogServiceModule
    logService.clearLogs()

    const stats = logService.getStats()
    expect(stats.total).toBe(0)
    expect(stats.sent).toBe(0)
    expect(stats.failed).toBe(0)
    expect(stats.errors).toBe(0)
  })
})
