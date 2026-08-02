// src/routes/docs.ts - Public API documentation: OpenAPI spec + self-contained Swagger UI.
// Mounted at the root (not under /api) so /docs, /openapi.yaml, /docs-assets/* are reachable
// without auth. The spec exposes the API shape only — no secrets. No external CDN: the Swagger
// UI assets are served same-origin from the installed swagger-ui-dist package.

import { Hono } from 'hono'
import type { Context } from 'hono'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { absolutePath as swaggerUiAssetPath } from 'swagger-ui-dist'

// The canonical spec is the hand-maintained repo-root docs/openapi.yaml. The API runs with
// CWD = apps/api (dev: `bun run index.ts`; Docker WORKDIR /app/apps/api), so it resolves at
// ../../docs/openapi.yaml. A missing file returns a clean 404 — it never breaks boot.
const OPENAPI_PATH = '../../docs/openapi.yaml'

const serveSwaggerAsset = (file: string, contentType: string) => (c: Context) => {
  try {
    return c.body(readFileSync(join(swaggerUiAssetPath(), file), 'utf-8'), 200, { 'Content-Type': contentType })
  } catch {
    return c.json({ success: false, message: `asset not found: ${file}` }, 404)
  }
}

const docsRoutes = new Hono()
  .get('/openapi.yaml', (c) => {
    if (!existsSync(OPENAPI_PATH)) return c.json({ success: false, message: 'openapi.yaml not found' }, 404)
    return c.body(readFileSync(OPENAPI_PATH, 'utf-8'), 200, { 'Content-Type': 'application/yaml; charset=utf-8' })
  })
  .get('/docs-assets/swagger-ui.css', serveSwaggerAsset('swagger-ui.css', 'text/css; charset=utf-8'))
  .get('/docs-assets/swagger-ui-bundle.js', serveSwaggerAsset('swagger-ui-bundle.js', 'application/javascript; charset=utf-8'))
  .get('/docs', (c) =>
    c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dispatch API</title>
<link rel="stylesheet" href="/docs-assets/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="/docs-assets/swagger-ui-bundle.js"></script>
<script>window.onload = () => SwaggerUIBundle({ url: '/openapi.yaml', dom_id: '#swagger-ui' })</script>
</body></html>`)
  )

export default docsRoutes
export type DocsRoutes = typeof docsRoutes
