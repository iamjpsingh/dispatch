// src/services/queue/types.ts - canonical queue types (post-sqlite).
// QueueJob/DeadLetter alias the Postgres-inferred row shapes (the durable mirror is
// now the source of truth). Re-exported from queueEngine for backward compatibility.
import type { JobRow, DeadLetterRow } from '../../db/pg/schema'

export type JobType = 'direct' | 'batch' | 'scheduled' | 'automation'
export type JobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export type QueueJob = JobRow
export type DeadLetter = DeadLetterRow

export interface QueueStats {
  pending: number
  running: number
  paused: number
  completed: number
  failed: number
  cancelled: number
  total_sent: number
  total_failed: number
  dead_letters: number
}

export interface EnqueueOptions {
  campaignId?: string
  orgId?: string
  type?: JobType
  priority?: number
  batchSize?: number
  emailDelaySec?: number
  batchDelayMin?: number
  scheduledAt?: string
  htmlContent: string
  subject: string
  fromEmail: string
  fromName: string
  configId?: string
  configName?: string
  notifyEmail?: string
}
