import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'

const dbPath = join(mkdtempSync(join(tmpdir(), 'trmnl-db-')), 'trmnl.sqlite')
process.env.PUBLIC_BASE_URL ??= 'http://localhost'
process.env.TRMNL_CLIENT_ID ??= 'test'
process.env.TRMNL_CLIENT_SECRET ??= 'test'
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

  it('removes settings whose connection has no live token', () => {
    const now = Date.now()
    const db = new Database(dbPath)
    db.exec('delete from trmnl_connections; delete from trmnl_settings; delete from trmnl_flight_settings')
    const token = db.prepare(
      'insert into trmnl_connections (access_token_hash, user_uuid, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?)'
    )
    token.run('live', 'live-uuid', now, now, null)
    token.run('uninstalled', 'gone-uuid', now, now, now)
    for (const uuid of ['live-uuid', 'gone-uuid', 'orphan-uuid']) {
      db.prepare('insert into trmnl_settings (user_uuid, updated_at) values (?, ?)').run(uuid, now)
      db.prepare('insert into trmnl_flight_settings (user_uuid, updated_at) values (?, ?)').run(uuid, now)
    }

    pruneStaleTokens()

    expect(db.prepare('select user_uuid from trmnl_settings').pluck().all()).toEqual(['live-uuid'])
    expect(db.prepare('select user_uuid from trmnl_flight_settings').pluck().all()).toEqual(['live-uuid'])
  })
})
