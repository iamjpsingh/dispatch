// src/utils/userAgentParser.ts — Parse User-Agent strings into structured device/browser/OS data

export interface ParsedUA {
  browser: string
  browserVersion: string
  os: string
  osVersion: string
  deviceType: 'desktop' | 'mobile' | 'tablet'
  emailClient: string | null
}

export function parseUserAgent(ua: string): ParsedUA {
  if (!ua) return { browser: 'Unknown', browserVersion: '', os: 'Unknown', osVersion: '', deviceType: 'desktop', emailClient: null }

  const result: ParsedUA = {
    browser: 'Unknown',
    browserVersion: '',
    os: 'Unknown',
    osVersion: '',
    deviceType: 'desktop',
    emailClient: null,
  }

  // Email clients (check first — they often mimic browsers)
  if (/GoogleImageProxy/i.test(ua)) { result.emailClient = 'Gmail'; result.browser = 'Gmail' }
  else if (/Outlook/i.test(ua) || /Microsoft Office/i.test(ua)) { result.emailClient = 'Outlook'; result.browser = 'Outlook' }
  else if (/Thunderbird/i.test(ua)) { result.emailClient = 'Thunderbird'; result.browser = 'Thunderbird' }
  else if (/YahooMailProxy/i.test(ua) || /Yahoo/i.test(ua)) { result.emailClient = 'Yahoo Mail'; result.browser = 'Yahoo Mail' }
  else if (/AppleWebKit.*Mobile/i.test(ua) && /Mail/i.test(ua)) { result.emailClient = 'Apple Mail'; result.browser = 'Apple Mail' }
  else if (/Postbox/i.test(ua)) { result.emailClient = 'Postbox'; result.browser = 'Postbox' }

  // OS detection
  if (/Windows NT 10/i.test(ua)) { result.os = 'Windows'; result.osVersion = '10/11' }
  else if (/Windows NT 6\.3/i.test(ua)) { result.os = 'Windows'; result.osVersion = '8.1' }
  else if (/Windows NT 6\.1/i.test(ua)) { result.os = 'Windows'; result.osVersion = '7' }
  else if (/Windows/i.test(ua)) { result.os = 'Windows'; result.osVersion = '' }
  else if (/Mac OS X (\d+[._]\d+)/i.test(ua)) { result.os = 'macOS'; result.osVersion = ua.match(/Mac OS X (\d+[._]\d+)/i)?.[1]?.replace(/_/g, '.') || '' }
  else if (/iPhone|iPad/i.test(ua)) { result.os = 'iOS'; result.osVersion = ua.match(/OS (\d+[._]\d+)/i)?.[1]?.replace(/_/g, '.') || '' }
  else if (/Android (\d+\.?\d*)/i.test(ua)) { result.os = 'Android'; result.osVersion = ua.match(/Android (\d+\.?\d*)/i)?.[1] || '' }
  else if (/Linux/i.test(ua)) { result.os = 'Linux'; result.osVersion = '' }
  else if (/CrOS/i.test(ua)) { result.os = 'Chrome OS'; result.osVersion = '' }

  // Browser detection (if not an email client)
  if (!result.emailClient) {
    if (/Edg\/(\d+)/i.test(ua)) { result.browser = 'Edge'; result.browserVersion = ua.match(/Edg\/(\d+)/i)?.[1] || '' }
    else if (/OPR\/(\d+)/i.test(ua) || /Opera/i.test(ua)) { result.browser = 'Opera'; result.browserVersion = ua.match(/OPR\/(\d+)/i)?.[1] || '' }
    else if (/Brave/i.test(ua)) { result.browser = 'Brave'; result.browserVersion = '' }
    else if (/Chrome\/(\d+)/i.test(ua)) { result.browser = 'Chrome'; result.browserVersion = ua.match(/Chrome\/(\d+)/i)?.[1] || '' }
    else if (/Firefox\/(\d+)/i.test(ua)) { result.browser = 'Firefox'; result.browserVersion = ua.match(/Firefox\/(\d+)/i)?.[1] || '' }
    else if (/Safari\/(\d+)/i.test(ua) && !/Chrome/i.test(ua)) { result.browser = 'Safari'; result.browserVersion = ua.match(/Version\/(\d+)/i)?.[1] || '' }
  }

  // Device type
  if (/Mobile|Android.*Mobile|iPhone/i.test(ua)) { result.deviceType = 'mobile' }
  else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) { result.deviceType = 'tablet' }
  else { result.deviceType = 'desktop' }

  return result
}

export function detectReferralSource(referrer: string): { source: string; medium: string; detail: string } {
  if (!referrer) return { source: 'Direct', medium: 'none', detail: 'Direct Entry' }

  const url = referrer.toLowerCase()

  // Search engines
  if (/google\./i.test(url)) return { source: 'Google', medium: 'search', detail: 'Google Search' }
  if (/bing\./i.test(url)) return { source: 'Bing', medium: 'search', detail: 'Bing Search' }
  if (/duckduckgo/i.test(url)) return { source: 'DuckDuckGo', medium: 'search', detail: 'DuckDuckGo Search' }
  if (/yahoo\./i.test(url)) return { source: 'Yahoo', medium: 'search', detail: 'Yahoo Search' }
  if (/baidu\./i.test(url)) return { source: 'Baidu', medium: 'search', detail: 'Baidu Search' }

  // Social networks
  if (/twitter\.com|t\.co|x\.com/i.test(url)) return { source: 'Twitter/X', medium: 'social', detail: 'Twitter' }
  if (/linkedin\.com|lnkd\.in/i.test(url)) return { source: 'LinkedIn', medium: 'social', detail: 'LinkedIn' }
  if (/facebook\.com|fb\.com|fb\.me/i.test(url)) return { source: 'Facebook', medium: 'social', detail: 'Facebook' }
  if (/reddit\.com/i.test(url)) return { source: 'Reddit', medium: 'social', detail: 'Reddit' }
  if (/instagram\.com/i.test(url)) return { source: 'Instagram', medium: 'social', detail: 'Instagram' }
  if (/youtube\.com|youtu\.be/i.test(url)) return { source: 'YouTube', medium: 'social', detail: 'YouTube' }

  // Email clients (web)
  if (/mail\.google\.com/i.test(url)) return { source: 'Gmail', medium: 'email', detail: 'Gmail Web' }
  if (/outlook\.live\.com|outlook\.office/i.test(url)) return { source: 'Outlook', medium: 'email', detail: 'Outlook Web' }
  if (/mail\.yahoo\.com/i.test(url)) return { source: 'Yahoo Mail', medium: 'email', detail: 'Yahoo Mail Web' }

  // Generic website
  try {
    const domain = new URL(referrer).hostname
    return { source: domain, medium: 'website', detail: domain }
  } catch {
    return { source: 'Unknown', medium: 'other', detail: referrer.substring(0, 50) }
  }
}
