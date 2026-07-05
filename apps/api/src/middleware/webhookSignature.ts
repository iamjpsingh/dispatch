// src/middleware/webhookSignature.ts — Verify inbound webhook signatures from email providers

import { createHmac, createVerify, timingSafeEqual } from 'crypto'
import { systemSettingsService } from '../services/systemSettingsService'
import { logger } from '../utils/logger'

// ============================================================================
// Mailgun — HMAC-SHA256 of (timestamp + token) with signing key
// ============================================================================

export function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  signingKey: string,
): boolean {
  try {
    const computed = createHmac('sha256', signingKey)
      .update(timestamp + token)
      .digest('hex')
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch {
    return false
  }
}

// ============================================================================
// SendGrid — ECDSA signature with public verification key
// Signature = ECDSA(timestamp + body) using their public key
// ============================================================================

export function verifySendGridSignature(
  publicKey: string,
  payload: string,
  signature: string,
  timestamp: string,
): boolean {
  try {
    const pemKey = publicKey.includes('BEGIN') ? publicKey : `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`
    const verifier = createVerify('sha256')
    verifier.update(timestamp + payload)
    return verifier.verify(pemKey, signature, 'base64')
  } catch {
    return false
  }
}

// ============================================================================
// SparkPost — HMAC-SHA1 of request body with auth_token
// ============================================================================

export function verifySparkPostSignature(
  body: string,
  signature: string,
  authToken: string,
): boolean {
  try {
    const computed = createHmac('sha1', authToken)
      .update(body)
      .digest('hex')
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch {
    return false
  }
}

// ============================================================================
// AWS SNS — X.509 certificate-based signature verification
// ============================================================================

export async function verifySNSSignature(payload: any): Promise<boolean> {
  try {
    // 1. Validate SigningCertURL is from *.amazonaws.com
    if (!payload.SigningCertURL || !payload.Signature) return false

    const certUrl = new URL(payload.SigningCertURL)
    if (!certUrl.hostname.endsWith('.amazonaws.com')) {
      logger.warn('[WebhookSig] SNS: SigningCertURL is not from amazonaws.com')
      return false
    }
    if (certUrl.protocol !== 'https:') {
      logger.warn('[WebhookSig] SNS: SigningCertURL is not HTTPS')
      return false
    }

    // 2. Download certificate
    const certRes = await fetch(payload.SigningCertURL)
    if (!certRes.ok) return false
    const cert = await certRes.text()

    // 3. Build string to sign based on message type
    const fields = payload.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']

    let stringToSign = ''
    for (const field of fields) {
      if (payload[field] !== undefined) {
        stringToSign += `${field}\n${payload[field]}\n`
      }
    }

    // 4. Verify RSA-SHA1 signature
    const verifier = createVerify('SHA1')
    verifier.update(stringToSign)
    return verifier.verify(cert, payload.Signature, 'base64')
  } catch (e: any) {
    logger.error('[WebhookSig] SNS verification error:', e.message)
    return false
  }
}

// ============================================================================
// SNS SubscribeURL allowlist — reused by webhooks.ts before auto-confirming a
// subscription, to prevent SSRF via an attacker-controlled SubscribeURL.
// ============================================================================

export function isAllowedSnsUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return u.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)
  } catch {
    return false
  }
}

// ============================================================================
// Helpers for webhook routes
// ============================================================================

export async function getMailgunSigningKey(): Promise<string | null> {
  return (await systemSettingsService.getSecret('mailgun_webhook_signing_key')) || null
}

export async function getSendGridVerificationKey(): Promise<string | null> {
  return (await systemSettingsService.getSecret('sendgrid_webhook_verification_key')) || null
}

export async function getSparkPostAuthToken(): Promise<string | null> {
  return (await systemSettingsService.getSecret('sparkpost_webhook_auth_token')) || null
}
