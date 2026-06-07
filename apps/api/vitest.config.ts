import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Many service nets each spin up an in-process PGlite (WASM, ~3.5s init) and
    // apply the full migration set per test. Running every file's forks at once
    // (12-core default) saturates the box and trips the 30s hook timeout. Cap
    // concurrency so only a few PGlite instances boot at a time, and give hooks
    // generous headroom.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
    testTimeout: 60000,
    hookTimeout: 60000,
    // drizzle-orm/bun-sql is Bun-only; under vitest (Node) tests inject a PGlite db instead.
    // (The bun:sqlite shim + better-sqlite3 were removed in P4.E — no sqlite remains.)
    alias: {
      'drizzle-orm/bun-sql': fileURLToPath(new URL('./tests/helpers/bun-sql-shim.ts', import.meta.url)),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/templates/**'],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
})
