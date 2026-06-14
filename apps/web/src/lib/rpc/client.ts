// Typed RPC client factory. Wraps fetch with credentials + CSRF, matching the
// behavior of the legacy ApiClient. Per-domain clients are built as hc<Routes>(rpcBase(), { fetch: rpcFetch }).
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

function csrfToken(): string | undefined {
  return document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1]
}

export const rpcFetch: typeof fetch = (input, init = {}) => {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (!SAFE.has(method)) {
    const tok = csrfToken()
    if (tok) headers.set('X-CSRF-Token', tok)
  }
  return fetch(input, { ...init, credentials: 'include', headers })
}

export function rpcBase(): string {
  const root = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
  return `${root}/api/v1`
}
