/**
 * I don't feel like messing around with postgres right now, so a file based lightweight db will do for now
 * If it's running in HA, then using postgres would be the better option
 * // TODO: implement postgres with support for rapid dev
 * also todo, stop switching back and forth on comment conventions
 */
import Database from 'better-sqlite3'
import { logger } from './logger.js'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
const DB_PATH = process.env.TRMNL_DB_PATH || './trmnl.sqlite'

export type TrmnlSettings = {
  user_uuid: string
  metro_station?: string | null
  lines?: string | null
  crass_level?: number | null
  plugin_setting_id?: number | null
}

// Let this file manage the lifecycle of the db
let db: Database.Database | null = null
function getDb(): Database.Database {
  if (!db) {
    mkdirSync(dirname(DB_PATH), { recursive: true })
    db = new Database(DB_PATH)
  }
  return db
}

// Am I smart? Extensible maybe? Time will tell
// multiple init functions maybe?
export function initTrmnlDB() {
  logger.info('[ DB ] Init DB')
  const db = getDb()
  db.exec(`
  create table if not exists trmnl_connections (
    access_token_hash text primary key,
    user_uuid text,
    created_at integer not null,
    last_seen_at integer,
    revoked_at integer
  );
  create table if not exists trmnl_settings (
    user_uuid text primary key,
    metro_station text,
    lines text,
    plugin_setting_id integer,
    crass_level integer,
    updated_at integer not null
  );
`)
}

// Everything below here is beyond me - like I know what's going on, but the syntax...
export async function storeTrmnlToken(tokenHash: string) {
  const db = getDb()
  logger.debug('[ DB ] Storing token')
  db.prepare(
    `
    insert or ignore into trmnl_connections
      (access_token_hash, created_at)
    values (?, ?)
  `
  ).run(tokenHash, Date.now())
}

export async function isKnownTrmnlToken(tokenHash: string): Promise<boolean> {
  const db = getDb()
  logger.debug('[ DB ] Check if token is known')
  const row = db
    .prepare(
      `
    select revoked_at from trmnl_connections
    where access_token_hash = ?
  `
    )
    .get(tokenHash) as { revoked_at?: number | null } | undefined

  // Basically, if we know this person coming in, we return null because revoked_at shouldn't exist
  return !!row && row.revoked_at == null
}

export async function touchTrmnlToken(tokenHash: string) {
  const db = getDb()
  logger.debug('[ DB ] Refreshing user token')
  db.prepare(
    `
    update trmnl_connections
    set last_seen_at = ?
    where access_token_hash = ?
  `
  ).run(Date.now(), tokenHash)
}

export async function attachUserUuid(tokenHash: string, userUuid: string) {
  const db = getDb()
  logger.debug('[ DB ] Associating user UUID to token')
  db.prepare(
    `
    update trmnl_connections
    set user_uuid = ?
    where access_token_hash = ?
  `
  ).run(userUuid, tokenHash)
}

export async function revokeTrmnlToken(tokenHash: string) {
  const db = getDb()
  logger.debug('[ DB ] Revoking token...')
  db.prepare(
    `
    update trmnl_connections
    set revoked_at = ?
    where access_token_hash = ?
  `
  ).run(Date.now(), tokenHash)
}

export async function revokeByUserUuid(userUuid: string) {
  const db = getDb()
  logger.debug('[ DB ] Revoking by user UUID...')
  db.prepare(
    `
    update trmnl_connections
    set revoked_at = ?
    where user_uuid = ?
  `
  ).run(Date.now(), userUuid)
}

export async function getSettingsByUuid(userUuid: string): Promise<TrmnlSettings | null> {
  const db = getDb()
  const row = db
    .prepare(
      `
      select user_uuid, metro_station, lines, plugin_setting_id, crass_level, updated_at
      from trmnl_settings
      where user_uuid = ?
    `
    )
    .get(userUuid) as
    | {
        user_uuid: string
        metro_station: string | null
        lines: string | null
        plugin_setting_id: number | null
        crass_level: number | null
        updated_at: number
      }
    | undefined

  if (!row) return null

  return {
    user_uuid: row.user_uuid,
    metro_station: row.metro_station,
    lines: row.lines,
    plugin_setting_id: row.plugin_setting_id,
    crass_level: row.crass_level,
  }
}

// Insert or update settings (upsert)
export async function upsertSettings(input: TrmnlSettings) {
  const db = getDb()

  const userUuid = input.user_uuid
  const metroStation = input.metro_station ?? null
  const lines = input.lines ?? null
  const pluginSettingId = input.plugin_setting_id ?? null
  const crassLevel = input.crass_level ?? 0

  db.prepare(
    `
    insert into trmnl_settings (user_uuid, metro_station, lines, plugin_setting_id, crass_level, updated_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(user_uuid) do update set
      metro_station = excluded.metro_station,
      lines = excluded.lines,
      plugin_setting_id = excluded.plugin_setting_id,
      crass_level = excluded.crass_level,
      updated_at = excluded.updated_at
  `
  ).run(userUuid, metroStation, lines, pluginSettingId, crassLevel, Date.now())
}
