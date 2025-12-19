/**
 * I don't feel like messing around with postgres right now, so a file based lightweight db will do for now
 * If it's running in HA, then using postgres would be the better option
 * // TODO: implement postgres with support for rapid dev
 * also todo, stop switching back and forth on comment conventions
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

const DB_PATH = process.env.TRMNL_DB_PATH || '/data/trmnl.sqlite'

// Ensure dir exists (important in Docker)
mkdirSync(dirname(DB_PATH), { recursive: true })

// Model a connection row
type TrmnlConnectionRow = {
  access_token_hash: string
  user_uuid: string | null
  created_at: number
  last_seen_at: number | null
  revoked_at: number | null
}

const db = new Database(DB_PATH)

db.exec(`
  create table if not exists trmnl_connections (
    access_token_hash text primary key,
    user_uuid text,
    created_at integer not null,
    last_seen_at integer,
    revoked_at integer
  );
`)

// Everything below here is beyond me - like I know what's going on, but the syntax...
export async function storeTrmnlToken(tokenHash: string) {
  db.prepare(`
    insert or ignore into trmnl_connections
      (access_token_hash, created_at)
    values (?, ?)
  `).run(tokenHash, Date.now())
}

export async function isKnownTrmnlToken(tokenHash: string): Promise<boolean> {
  const row = db.prepare(`
    select revoked_at from trmnl_connections
    where access_token_hash = ?
  `).get(tokenHash) as { revoked_at?: number | null }

  return !!row && !row.revoked_at
}

export async function touchTrmnlToken(tokenHash: string) {
  db.prepare(`
    update trmnl_connections
    set last_seen_at = ?
    where access_token_hash = ?
  `).run(Date.now(), tokenHash)
}

export async function attachUserUuid(tokenHash: string, userUuid: string) {
  db.prepare(`
    update trmnl_connections
    set user_uuid = ?
    where access_token_hash = ?
  `).run(userUuid, tokenHash)
}

export async function revokeTrmnlToken(tokenHash: string) {
  db.prepare(`
    update trmnl_connections
    set revoked_at = ?
    where access_token_hash = ?
  `).run(Date.now(), tokenHash)
}