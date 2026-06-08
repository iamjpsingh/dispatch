import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { STORAGE } from '../config'
import { logger } from '../utils/logger'

// Lazy singleton — the client is built on first use (never at import), so the API
// process boots without an S3 round-trip and tests can run without MinIO.
let _client: S3Client | null = null

function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: STORAGE.ENDPOINT,
      region: STORAGE.REGION,
      credentials: { accessKeyId: STORAGE.ACCESS_KEY, secretAccessKey: STORAGE.SECRET_KEY },
      forcePathStyle: true, // required for MinIO; harmless for R2
    })
  }
  return _client
}

export const storageService = {
  /** Upload bytes under `key`. Overwrites any existing object at that key. */
  async put(key: string, body: Uint8Array, contentType?: string): Promise<void> {
    await client().send(
      new PutObjectCommand({ Bucket: STORAGE.BUCKET, Key: key, Body: body, ContentType: contentType })
    )
  },

  /** Fetch bytes at `key`, or null if the object does not exist. */
  async get(key: string): Promise<Uint8Array | null> {
    try {
      const res = await client().send(new GetObjectCommand({ Bucket: STORAGE.BUCKET, Key: key }))
      if (!res.Body) return null
      return await res.Body.transformToByteArray()
    } catch (err) {
      const name = (err as { name?: string }).name
      if (name === 'NoSuchKey' || name === 'NotFound') return null
      throw err
    }
  },

  /** A time-limited GET URL for `key` (default 15 min). */
  async getSignedDownloadUrl(key: string, expiresInSec = 900): Promise<string> {
    return getSignedUrl(client(), new GetObjectCommand({ Bucket: STORAGE.BUCKET, Key: key }), {
      expiresIn: expiresInSec,
    })
  },

  /** Delete the object at `key` (no error if it was already absent). */
  async delete(key: string): Promise<void> {
    await client().send(new DeleteObjectCommand({ Bucket: STORAGE.BUCKET, Key: key }))
  },

  /** Idempotently ensure the configured bucket exists (MinIO starts empty). */
  async ensureBucket(): Promise<void> {
    try {
      await client().send(new HeadBucketCommand({ Bucket: STORAGE.BUCKET }))
    } catch {
      try {
        await client().send(new CreateBucketCommand({ Bucket: STORAGE.BUCKET }))
      } catch (err) {
        const name = (err as { name?: string }).name
        // Concurrent creation / already-owned is fine.
        if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
          logger.error('ensureBucket failed:', err)
          throw err
        }
      }
    }
  },
}
