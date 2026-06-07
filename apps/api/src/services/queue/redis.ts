// src/services/queue/redis.ts - Valkey/Redis connection factory for BullMQ.
// No module-level singleton: the API and worker are separate processes, each
// builds its own connection. maxRetriesPerRequest:null is required by BullMQ.
import IORedis from 'ioredis'
import { REDIS } from '../../config'

export function createRedisConnection(url?: string): IORedis {
  return new IORedis(url ?? REDIS.URL, { maxRetriesPerRequest: null })
}
