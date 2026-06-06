// src/utils/htmlToText.ts - Convert HTML to plain text for email fallback

/**
 * Convert HTML email to plain text.
 * Preserves links, headings, and basic structure.
 */
export function htmlToText(html: string): string {
  let text = html

  // Convert line breaks
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/p>/gi, '\n\n')
  text = text.replace(/<\/div>/gi, '\n')
  text = text.replace(/<\/h[1-6]>/gi, '\n\n')
  text = text.replace(/<\/li>/gi, '\n')
  text = text.replace(/<\/tr>/gi, '\n')

  // Convert links: <a href="url">text</a> → text (url)
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, url, linkText) => {
    const cleanText = linkText.replace(/<[^>]+>/g, '').trim()
    return cleanText === url ? url : `${cleanText} (${url})`
  })

  // Convert headings to uppercase with underline effect
  text = text.replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi, (_, content) => {
    const clean = content.replace(/<[^>]+>/g, '').trim().toUpperCase()
    return `\n${clean}\n${'='.repeat(clean.length)}\n`
  })

  // Convert list items
  text = text.replace(/<li[^>]*>/gi, '  - ')

  // Convert horizontal rules
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n')

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode HTML entities
  text = text.replace(/&nbsp;/gi, ' ')
  text = text.replace(/&amp;/gi, '&')
  text = text.replace(/&lt;/gi, '<')
  text = text.replace(/&gt;/gi, '>')
  text = text.replace(/&quot;/gi, '"')
  text = text.replace(/&#39;/gi, "'")
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))

  // Clean up whitespace
  text = text.replace(/\t/g, ' ')
  text = text.replace(/ {2,}/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.trim()

  return text
}
