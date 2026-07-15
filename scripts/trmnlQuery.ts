// Ad hoc reporting/housekeeping CLI against the TRMNL sqlite DB.
// Opens its own connection directly (independent of dbConnector's server-lifecycle singleton)
// so it can run standalone against a dev or prod db file. Run via `npm run trmnl:query -- <command>`.
import Database from 'better-sqlite3'
import { config } from '../src/config.js'

const db = new Database(config.trmnl.dbPath, { fileMustExist: true })

type ConnectionRow = {
  access_token_hash: string
  user_uuid: string | null
  created_at: number
  last_seen_at: number | null
  revoked_at: number | null
}

function fmtDate(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString() : '--'
}

function shortHash(hash: string): string {
  return hash.slice(0, 12) + '…'
}

function printRows(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log('(no rows)')
    return
  }
  console.table(rows)
}

function cmdSummary(): void {
  const totals = db
    .prepare(
      `
    select
      count(*) as total,
      sum(case when user_uuid is null then 1 else 0 end) as unbound,
      sum(case when revoked_at is not null then 1 else 0 end) as revoked,
      sum(case when user_uuid is not null and revoked_at is null then 1 else 0 end) as active
    from trmnl_connections
  `
    )
    .get() as { total: number; unbound: number; revoked: number; active: number }

  const metro = db.prepare(`select count(*) as total from trmnl_settings`).get() as { total: number }
  const flight = db.prepare(`select count(*) as total from trmnl_flight_settings`).get() as { total: number }

  console.log('Connections:', totals)
  console.log('Metro plugin settings rows:', metro.total)
  console.log('Flight plugin settings rows:', flight.total)
}

function cmdUuid(uuid: string): void {
  const connection = db.prepare(`select * from trmnl_connections where user_uuid = ?`).get(uuid) as
    | ConnectionRow
    | undefined
  const metro = db.prepare(`select * from trmnl_settings where user_uuid = ?`).get(uuid)
  const flight = db.prepare(`select * from trmnl_flight_settings where user_uuid = ?`).get(uuid)

  console.log('Connection:')
  printRows(
    connection
      ? [
          {
            access_token_hash: shortHash(connection.access_token_hash),
            created_at: fmtDate(connection.created_at),
            last_seen_at: fmtDate(connection.last_seen_at),
            revoked_at: fmtDate(connection.revoked_at),
          },
        ]
      : []
  )

  console.log('Metro settings:')
  printRows(metro ? [metro as Record<string, unknown>] : [])

  console.log('Flight settings:')
  printRows(flight ? [flight as Record<string, unknown>] : [])
}

// Settings rows left behind after their connection was revoked/never bound - not cleaned up
// automatically since revoking only touches trmnl_connections.
function cmdOrphans(): void {
  const metroOrphans = db
    .prepare(
      `
    select s.* from trmnl_settings s
    left join trmnl_connections c on c.user_uuid = s.user_uuid and c.revoked_at is null
    where c.user_uuid is null
  `
    )
    .all() as Record<string, unknown>[]

  const flightOrphans = db
    .prepare(
      `
    select s.* from trmnl_flight_settings s
    left join trmnl_connections c on c.user_uuid = s.user_uuid and c.revoked_at is null
    where c.user_uuid is null
  `
    )
    .all() as Record<string, unknown>[]

  console.log('Orphaned metro settings (no live connection):')
  printRows(metroOrphans)

  console.log('Orphaned flight settings (no live connection):')
  printRows(flightOrphans)
}

// Bound connections where install_success ran but no plugin_setting_id ever landed on either
// plugin's settings table - these installs can't deep-link back to trmnl.com/plugin_settings.
function cmdStuck(): void {
  const rows = db
    .prepare(
      `
    select c.user_uuid, c.created_at, c.last_seen_at
    from trmnl_connections c
    left join trmnl_settings ms on ms.user_uuid = c.user_uuid
    left join trmnl_flight_settings fs on fs.user_uuid = c.user_uuid
    where c.user_uuid is not null
      and c.revoked_at is null
      and coalesce(ms.plugin_setting_id, fs.plugin_setting_id) is null
  `
    )
    .all() as { user_uuid: string; created_at: number; last_seen_at: number | null }[]

  printRows(
    rows.map((r) => ({
      user_uuid: r.user_uuid,
      created_at: fmtDate(r.created_at),
      last_seen_at: fmtDate(r.last_seen_at),
    }))
  )
}

function cmdStale(days: number): void {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const rows = db
    .prepare(
      `
    select access_token_hash, user_uuid, created_at, last_seen_at
    from trmnl_connections
    where revoked_at is null
      and (
        (last_seen_at is not null and last_seen_at < ?)
        or (last_seen_at is null and created_at < ?)
      )
    order by coalesce(last_seen_at, created_at) asc
  `
    )
    .all(cutoff, cutoff) as { access_token_hash: string; user_uuid: string | null; created_at: number; last_seen_at: number | null }[]

  printRows(
    rows.map((r) => ({
      access_token_hash: shortHash(r.access_token_hash),
      user_uuid: r.user_uuid ?? '(unbound)',
      created_at: fmtDate(r.created_at),
      last_seen_at: fmtDate(r.last_seen_at),
    }))
  )
}

function cmdRevoke(uuid: string, confirmed: boolean): void {
  if (!confirmed) {
    console.error('Refusing to revoke without --yes. Re-run as: revoke <uuid> --yes')
    process.exitCode = 1
    return
  }

  const result = db
    .prepare(`update trmnl_connections set revoked_at = ? where user_uuid = ? and revoked_at is null`)
    .run(Date.now(), uuid)

  console.log(`Revoked ${result.changes} connection(s) for uuid ${uuid}`)
}

function usage(): void {
  console.log(`
Usage: npm run trmnl:query -- <command> [args]

Commands:
  summary                    Counts of connections (active/revoked/unbound) and settings rows
  uuid <user_uuid>            Everything known about one uuid across all three tables
  orphans                     Settings rows with no matching live (non-revoked) connection
  stuck                       Bound connections with no plugin_setting_id on either plugin's settings
  stale [days=30]              Non-revoked connections not seen in <days>
  revoke <user_uuid> --yes    Revoke all active connections bound to a uuid

Reads TRMNL_DB_PATH from the environment (same as the server); defaults to ./trmnl.sqlite.
`)
}

function main(): void {
  const [, , cmd, ...rest] = process.argv

  switch (cmd) {
    case 'summary':
      cmdSummary()
      break
    case 'uuid': {
      const uuid = rest[0]
      if (!uuid) {
        console.error('Missing <user_uuid>')
        process.exitCode = 1
        break
      }
      cmdUuid(uuid)
      break
    }
    case 'orphans':
      cmdOrphans()
      break
    case 'stuck':
      cmdStuck()
      break
    case 'stale': {
      const days = rest[0] ? Number(rest[0]) : 30
      if (!Number.isFinite(days) || days <= 0) {
        console.error('days must be a positive number')
        process.exitCode = 1
        break
      }
      cmdStale(days)
      break
    }
    case 'revoke': {
      const uuid = rest[0]
      if (!uuid) {
        console.error('Missing <user_uuid>')
        process.exitCode = 1
        break
      }
      cmdRevoke(uuid, rest.includes('--yes'))
      break
    }
    default:
      usage()
      if (cmd) process.exitCode = 1
  }
}

main()
db.close()
