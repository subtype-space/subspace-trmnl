import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'

const dbPath = join(mkdtempSync(join(tmpdir(), 'trmnl-db-')), 'trmnl.sqlite')
process.env.PUBLIC_BASE_URL = 'http://localhost'
process.env.TRMNL_DB_PATH = dbPath
const { initTrmnlDB, pruneStaleTokens } = await import('../../src/utils/dbConnector.js')

const DAY = 24 * 60 * 60 * 1000

describe('pruneStaleTokens', () => {
  it('removes tokens idle or never seen for 90+ days and keeps active ones', () => {
    initTrmnlDB()
    const now = Date.now()
    const db = new Database(dbPath)
    const insert = db.prepare(
      'insert into trmnl_connections (access_token_hash, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?)'
    )
    insert.run('active', now - 400 * DAY, now - DAY, null)
    insert.run('idle', now - 200 * DAY, now - 100 * DAY, null)
    insert.run('never-seen-old', now - 100 * DAY, null, null)
    insert.run('never-seen-new', now - DAY, null, null)
    insert.run('revoked-recent', now - 200 * DAY, now - 100 * DAY, now - 10 * DAY)
    insert.run('revoked-old', now - 200 * DAY, now - 150 * DAY, now - 100 * DAY)

    pruneStaleTokens()

    const left = db.prepare('select access_token_hash from trmnl_connections order by 1').pluck().all()
    expect(left).toEqual(['active', 'never-seen-new', 'revoked-recent'])
  })
})
