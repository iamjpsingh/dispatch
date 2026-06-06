import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/pg/schema/index.ts',
  out: './src/db/pg/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://dispatch:dispatch@localhost:5432/dispatch',
  },
})
