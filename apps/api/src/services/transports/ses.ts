// src/services/transports/ses.ts - AWS SES Transport (native fetch + SigV4)

import type { EmailTransport, SendOptions, SendResult, SesConfig } from './types'

export class SesTransport implements EmailTransport {
  readonly name = 'ses'
  private config: SesConfig

  constructor(config: SesConfig) {
    this.config = config
  }

  async send(options: SendOptions): Promise<SendResult> {
    const params = new URLSearchParams({
      Action: 'SendEmail',
      'Source': `${options.from.name} <${options.from.email}>`,
      'Destination.ToAddresses.member.1': options.to,
      'Message.Subject.Data': options.subject,
      'Message.Subject.Charset': 'UTF-8',
      'Message.Body.Html.Data': options.html,
      'Message.Body.Html.Charset': 'UTF-8',
    })

    if (options.text) {
      params.set('Message.Body.Text.Data', options.text)
      params.set('Message.Body.Text.Charset', 'UTF-8')
    }

    if (options.replyTo) {
      params.set('ReplyToAddresses.member.1', options.replyTo)
    }

    // Add custom headers via raw message if present, otherwise use simple API
    const endpoint = `https://email.${this.config.region}.amazonaws.com/`
    const now = new Date()
    const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    const shortDate = dateStamp.substring(0, 8)

    const body = params.toString()

    // AWS SigV4 signing
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': `email.${this.config.region}.amazonaws.com`,
      'X-Amz-Date': dateStamp,
    }

    const canonicalHeaders = Object.entries(headers)
      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
      .join('\n') + '\n'

    const signedHeaders = Object.keys(headers)
      .map(k => k.toLowerCase())
      .sort()
      .join(';')

    const payloadHash = await this.sha256(body)
    const canonicalRequest = [
      'POST', '/', '', canonicalHeaders, signedHeaders, payloadHash
    ].join('\n')

    const credentialScope = `${shortDate}/${this.config.region}/ses/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256', dateStamp, credentialScope, await this.sha256(canonicalRequest)
    ].join('\n')

    const signingKey = await this.getSigningKey(shortDate)
    const signature = await this.hmacHex(signingKey, stringToSign)

    headers['Authorization'] = [
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ')

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`SES error ${response.status}: ${errorText}`)
    }

    const xml = await response.text()
    const messageIdMatch = xml.match(/<MessageId>(.*?)<\/MessageId>/)
    const messageId = messageIdMatch ? messageIdMatch[1] : `ses_${Date.now()}`

    return { messageId, provider: 'ses' }
  }

  async verify(): Promise<boolean> {
    try {
      // Use GetSendQuota as a health check
      const params = new URLSearchParams({ Action: 'GetSendQuota' })
      const endpoint = `https://email.${this.config.region}.amazonaws.com/`
      const now = new Date()
      const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
      const shortDate = dateStamp.substring(0, 8)
      const body = params.toString()

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Host': `email.${this.config.region}.amazonaws.com`,
        'X-Amz-Date': dateStamp,
      }

      const canonicalHeaders = Object.entries(headers)
        .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
        .join('\n') + '\n'

      const signedHeaders = Object.keys(headers).map(k => k.toLowerCase()).sort().join(';')
      const payloadHash = await this.sha256(body)
      const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
      const credentialScope = `${shortDate}/${this.config.region}/ses/aws4_request`
      const stringToSign = ['AWS4-HMAC-SHA256', dateStamp, credentialScope, await this.sha256(canonicalRequest)].join('\n')
      const signingKey = await this.getSigningKey(shortDate)
      const signature = await this.hmacHex(signingKey, stringToSign)

      headers['Authorization'] = [
        `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}`,
        `SignedHeaders=${signedHeaders}`,
        `Signature=${signature}`,
      ].join(', ')

      const response = await fetch(endpoint, { method: 'POST', headers, body })
      return response.ok
    } catch {
      return false
    }
  }

  // AWS SigV4 helpers using Web Crypto API (works in Bun)
  private async sha256(data: string): Promise<string> {
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data))
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
      // key is always ArrayBuffer-backed here; cast past the TS 5.7 typed-array/SharedArrayBuffer union.
      'raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  }

  private async hmacHex(key: ArrayBuffer, data: string): Promise<string> {
    const sig = await this.hmac(key, data)
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async getSigningKey(shortDate: string): Promise<ArrayBuffer> {
    const kDate = await this.hmac(new TextEncoder().encode(`AWS4${this.config.secretAccessKey}`), shortDate)
    const kRegion = await this.hmac(kDate, this.config.region)
    const kService = await this.hmac(kRegion, 'ses')
    return this.hmac(kService, 'aws4_request')
  }
}
