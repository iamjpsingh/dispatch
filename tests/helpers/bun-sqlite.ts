/**
 * Test shim: resolves Bun's built-in `bun:sqlite` to better-sqlite3 so Vitest
 * (which runs under the Node/Vite transform pipeline) can load modules that
 * `import Database from 'bun:sqlite'`.
 *
 * The codebase only uses the API subset shared by both drivers:
 *   new Database(path), db.prepare(sql), stmt.get/all/run(...params),
 *   db.exec(sql), db.transaction(fn), db.close().
 * (Verified across src/: zero db.query(), zero bare db.run(), zero stmt.values(),
 *  zero named params, zero .pragma() — all positional `?` prepared statements,
 *  so better-sqlite3 is a faithful stand-in for the test environment.)
 *
 * Wired via `test.alias` in vitest.config.ts. Production still uses real bun:sqlite.
 */
import BetterSqlite3 from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

// `new Database(path)` -> returns the better-sqlite3 instance. Calling `new` on a
// function that returns an object yields that object, so this matches the
// `import Database from 'bun:sqlite'; new Database(path)` usage exactly.
export default function Database(filename: string, options?: BetterSqlite3.Options) {
  if (filename && filename !== ':memory:') {
    const dir = dirname(filename)
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  return new BetterSqlite3(filename, options)
}
