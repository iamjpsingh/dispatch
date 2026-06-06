import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { freshDb } from '../helpers/pg'

describe('P2.0 — Postgres/Drizzle foundation (PGlite under vitest)', () => {
  it('executes SQL on an in-memory Postgres', async () => {
    const db = freshDb()
    const res = (await db.execute(sql`select 1 as one`)) as { rows?: { one: number }[] }
    const rows = res.rows ?? (res as unknown as { one: number }[])
    expect(Number(rows[0].one)).toBe(1)
  }, 30_000) // PGlite WASM init is slow under parallel load; generous timeout avoids flake

  it('isolates each freshDb() instance', async () => {
    const a = freshDb()
    await a.execute(sql`create table t (id int)`)
    await a.execute(sql`insert into t (id) values (1)`)

    const b = freshDb()
    const res = (await b.execute(
      sql`select to_regclass('public.t') as t`
    )) as { rows?: { t: string | null }[] }
    const rows = res.rows ?? (res as unknown as { t: string | null }[])
    expect(rows[0].t).toBeNull()
  }, 30_000)
})
