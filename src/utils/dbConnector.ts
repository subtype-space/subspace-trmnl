/**
 * I don't feel like messing around with postgres right now, so a file based lightweight db will do for now
 * If it's running in HA, then using postgres would be the better option
 * // TODO: implement postgres with support for rapid dev
 * also todo, stop switching back and forth on comment conventions
 */
import Database from 'better-sqlite3'
import { config } from '../config.js'
import { logger } from './logger.js'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
const DB_PATH = config.trmnl.dbPath

// to do - i dont like this in this file
export type TrmnlSettings = {
  user_uuid: string
  primary_line?: string | null
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
    primary_line text,
    lines text,
    plugin_setting_id integer,
    crass_level integer default 0,
    updated_at integer not null
  );
`)
}

// Everything below here is beyond me - like I know what's going on, but the syntax...
export async function storeTrmnlToken(tokenHash: string) {
  const db = getDb()
  logger.info('[ DB ] Storing token')
  db.prepare(
    `
    insert or ignore into trmnl_connections
      (access_token_hash, created_at)
    values (?, ?)
  `
  ).run(tokenHash, Date.now())
}

export async function isKnownTokenHash(tokenHash: string): Promise<boolean> {
  const db = getDb()
  logger.debug('[ DB ] Check if we know this incoming token hash')
  const row = db
    .prepare(
      `
    select revoked_at from trmnl_connections
    where access_token_hash = ?
  `
    )
    .get(tokenHash) as { revoked_at?: number | null } | undefined

  // Basically, if we know this person, the row should exist and revoked_at field shouldn't exist
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

export function getUserUuidByTokenHash(tokenHash: string): string | null {
  const db = getDb()
  logger.debug('[ DB ] Retrieving UUID for hash: ', tokenHash)
  const row = db
    .prepare(
      `
      select user_uuid
      from trmnl_connections
      where access_token_hash = ?
    `
    )
    .get(tokenHash) as { user_uuid: string | null } | undefined
  
  return row?.user_uuid ?? null
}

// bind once: only set if currently null/empty
export function bindUserUuidToToken(tokenHash: string, userUuid: string) {
  const db = getDb()
  logger.debug(`[ DB ] Binding ${userUuid} to ${tokenHash}`)
  db.prepare(
    `
    update trmnl_connections
    set user_uuid = ?
    where access_token_hash = ?
      and (user_uuid is null or user_uuid = '')
  `
  ).run(userUuid, tokenHash)
}

export async function revokeByUserUuid(userUuid: string) {
  const db = getDb()
  logger.info('[ DB ] Revoking by user UUID...')
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
  logger.info(`[ DB ] Getting settings for ${userUuid}`)
  const row = db
    .prepare(
      `
      select user_uuid, primary_line, lines, plugin_setting_id, crass_level, updated_at
      from trmnl_settings
      where user_uuid = ?
    `
    )
    .get(userUuid) as
    | {
        user_uuid: string
        primary_line: string | null
        lines: string | null
        plugin_setting_id: number | null
        crass_level: number | null
        updated_at: number
      }
    | undefined

  if (!row) return null

  return {
    user_uuid: row.user_uuid,
    primary_line: row.primary_line,
    lines: row.lines,
    plugin_setting_id: row.plugin_setting_id,
    crass_level: row.crass_level,
  }
}

// Insert or update settings (upsert)
export async function upsertSettings(input: TrmnlSettings) {
  const db = getDb()

  const userUuid = input.user_uuid
  const primaryLine = input.primary_line ?? null
  const lines = input.lines ?? null
  const pluginSettingId = input.plugin_setting_id ?? null
  const crassLevel = input.crass_level ?? 0

  db.prepare(
    `
    insert into trmnl_settings (
      user_uuid, primary_line, lines, plugin_setting_id, crass_level, updated_at
    )
    values (?, ?, ?, ?, ?, ?)
    on conflict(user_uuid) do update set
      primary_line = coalesce(excluded.primary_line, trmnl_settings.primary_line),
      lines = coalesce(excluded.lines, trmnl_settings.lines),
      plugin_setting_id = coalesce(excluded.plugin_setting_id, trmnl_settings.plugin_setting_id),
      crass_level = excluded.crass_level,
      updated_at = excluded.updated_at
  `
  ).run(userUuid, primaryLine, lines, pluginSettingId, crassLevel, Date.now())
}
