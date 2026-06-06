// src/services/spamScanner.ts - Spam Content Pre-Scanner

export interface SpamScanResult {
  score: number       // 0-10 (0 = clean, 10 = definitely spam)
  warnings: string[]
  pass: boolean       // true if score <= 5
}

const SPAM_PHRASES = [
  /\bfree money\b/i, /\bcash prize\b/i, /\bclick here now\b/i,
  /\bact now\b/i, /\blimited time offer\b/i, /\bno obligation\b/i,
  /\brisk.?free\b/i, /\b100% free\b/i, /\bbuy now\b/i,
  /\bdouble your\b/i, /\bmillion dollars\b/i, /\bengineered\b/i,
  /\bcongratulations.*won\b/i, /\bno catch\b/i, /\bguaranteed\b/i,
  /\bspecial promotion\b/i, /\bonce in a lifetime\b/i,
  /\bwork from home\b/i, /\bno experience\b/i,
]

export function scanForSpam(subject: string, html: string): SpamScanResult {
  const warnings: string[] = []
  let score = 0

  // Strip tags for content analysis
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  // 1. Subject line checks
  if (subject === subject.toUpperCase() && subject.length > 5) {
    warnings.push('Subject is ALL CAPS')
    score += 2
  }

  if (/!{2,}/.test(subject)) {
    warnings.push('Subject contains excessive exclamation marks')
    score += 1
  }

  if (/\$+/.test(subject) || /\bfree\b/i.test(subject)) {
    warnings.push('Subject contains $ or "free" — may trigger filters')
    score += 1
  }

  if (/re:|fw:/i.test(subject) && !/^(re|fw):/i.test(subject)) {
    warnings.push('Deceptive RE:/FW: in subject')
    score += 2
  }

  // 2. Content checks
  for (const pattern of SPAM_PHRASES) {
    if (pattern.test(text)) {
      warnings.push(`Contains spam phrase: "${text.match(pattern)?.[0]}"`)
      score += 0.5
    }
  }

  if (/!{3,}/.test(text)) {
    warnings.push('Excessive exclamation marks in body')
    score += 1
  }

  // 3. Image-only email (no real text content)
  const textLength = text.length
  const imgCount = (html.match(/<img/gi) || []).length
  if (textLength < 50 && imgCount > 0) {
    warnings.push('Email appears to be image-only (low text-to-image ratio)')
    score += 2
  }

  // 4. Missing unsubscribe link
  if (!html.includes('unsubscribe') && !html.includes('Unsubscribe') && !html.includes('UNSUBSCRIBE')) {
    warnings.push('No unsubscribe link found in email body')
    score += 1
  }

  // 5. Too many links
  const linkCount = (html.match(/<a /gi) || []).length
  if (linkCount > 20) {
    warnings.push(`Too many links (${linkCount}) — may trigger spam filters`)
    score += 1
  }

  // 6. URL shorteners
  if (/bit\.ly|tinyurl|goo\.gl|t\.co|ow\.ly/i.test(html)) {
    warnings.push('Contains URL shorteners — may trigger spam filters')
    score += 1
  }

  // 7. Large font / red text (common spam patterns)
  if (/<font[^>]*size=["']?[5-9]|font-size:\s*(2[4-9]|[3-9]\d)px/i.test(html)) {
    warnings.push('Contains very large font sizes')
    score += 0.5
  }

  if (/color:\s*#?f{2}0{4}|color:\s*red/i.test(html)) {
    warnings.push('Contains red-colored text')
    score += 0.5
  }

  score = Math.min(10, Math.round(score * 10) / 10)

  return { score, warnings, pass: score <= 5 }
}
