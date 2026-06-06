import { describe, it, expect, vi } from 'vitest'
import { eventBus } from '../../src/services/eventBus'

describe('EventBus', () => {
  it('emits and receives events', async () => {
    const handler = vi.fn()
    const unsub = eventBus.on('email_sent', handler)

    await eventBus.emit('email_sent', 'user_1', { subject: 'Hello' })

    expect(handler).toHaveBeenCalledTimes(1)
    const payload = handler.mock.calls[0][0]
    expect(payload.type).toBe('email_sent')
    expect(payload.userId).toBe('user_1')
    expect(payload.data?.subject).toBe('Hello')
    expect(payload.timestamp).toBeTruthy()

    unsub()
  })

  it('returns unsubscribe function', async () => {
    const handler = vi.fn()
    const unsub = eventBus.on('email_failed', handler)

    await eventBus.emit('email_failed', 'user_2')
    expect(handler).toHaveBeenCalledTimes(1)

    unsub()

    await eventBus.emit('email_failed', 'user_2')
    expect(handler).toHaveBeenCalledTimes(1) // still 1, not 2
  })

  it('wildcard handler receives all events', async () => {
    const handler = vi.fn()
    const unsub = eventBus.on('*', handler)

    await eventBus.emit('email_opened', 'user_3')
    await eventBus.emit('email_clicked', 'user_3')

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[0][0].type).toBe('email_opened')
    expect(handler.mock.calls[1][0].type).toBe('email_clicked')

    unsub()
  })

  it('passes campaignId and contactId through events', async () => {
    const handler = vi.fn()
    const unsub = eventBus.on('contact_scored', handler)

    await eventBus.emit('contact_scored', 'user_4', { score: 85 }, 'camp_1', 'contact_1')

    const payload = handler.mock.calls[0][0]
    expect(payload.campaignId).toBe('camp_1')
    expect(payload.contactId).toBe('contact_1')
    expect(payload.data?.score).toBe(85)

    unsub()
  })

  it('handles emit with no listeners gracefully', async () => {
    // Should not throw even with no listeners
    await expect(eventBus.emit('batch_completed', 'user_5')).resolves.toBeUndefined()
  })

  it('SSE client receives events for its user', async () => {
    const callback = vi.fn()
    const unsub = eventBus.addSSEClient('user_6', callback)

    await eventBus.emit('stats_update', 'user_6', { total: 100 })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].type).toBe('stats_update')

    unsub()
  })

  it('SSE client does not receive events for other users', async () => {
    const callback = vi.fn()
    const unsub = eventBus.addSSEClient('user_7', callback)

    await eventBus.emit('stats_update', 'user_8', { total: 50 })

    expect(callback).not.toHaveBeenCalled()

    unsub()
  })

  it('getSSEClientCount returns correct count', () => {
    const unsub1 = eventBus.addSSEClient('user_9', () => {})
    const unsub2 = eventBus.addSSEClient('user_10', () => {})
    const unsub3 = eventBus.addSSEClient('user_9', () => {})

    const count = eventBus.getSSEClientCount()
    expect(count).toBeGreaterThanOrEqual(3)

    unsub1()
    unsub2()
    unsub3()
  })

  it('handler errors do not crash other handlers', async () => {
    const badHandler = vi.fn(() => { throw new Error('boom') })
    const goodHandler = vi.fn()

    const unsub1 = eventBus.on('campaign_launched', badHandler)
    const unsub2 = eventBus.on('campaign_launched', goodHandler)

    // Should not throw despite the bad handler
    await expect(eventBus.emit('campaign_launched', 'user_11')).resolves.toBeUndefined()

    expect(badHandler).toHaveBeenCalled()
    expect(goodHandler).toHaveBeenCalled()

    unsub1()
    unsub2()
  })
})
