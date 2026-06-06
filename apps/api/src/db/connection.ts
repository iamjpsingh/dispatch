import Database from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'

const DATA_DIR = './data'
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

function createDb(path: string): Database {
  const instance = new Database(path)
  instance.exec('PRAGMA journal_mode=WAL')
  instance.exec('PRAGMA busy_timeout=5000')
  instance.exec('PRAGMA foreign_keys=ON')
  return instance
}

export const db = createDb(`${DATA_DIR}/dispatch.db`)
export const logsDb = createDb(`${DATA_DIR}/logs.db`)
