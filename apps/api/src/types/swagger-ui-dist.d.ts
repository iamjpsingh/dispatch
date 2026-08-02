// swagger-ui-dist ships no type declarations. It exposes the on-disk asset directory via
// absolutePath()/getAbsoluteFSPath() (both aliases of the same function). We serve the CSS +
// bundle from that directory same-origin (no CDN) — see app.ts /docs.
declare module 'swagger-ui-dist' {
  export function absolutePath(): string
  export function getAbsoluteFSPath(): string
}
