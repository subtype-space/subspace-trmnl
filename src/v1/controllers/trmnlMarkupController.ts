import { RequestHandler } from 'express'
import { logger } from '../../utils/logger.js'
import { attachUserUuid, getSettingsByUuid } from '../../utils/dbConnector.js'

// Main logic builder
export const trmnlMarkupController: RequestHandler = async (req, res) => {
  const tokenHash = (req as any).trmnl?.tokenHash as string | undefined
  const userUuid = req.body?.user_uuid
  const trmnlRaw = req.body?.trmnl

  if (!tokenHash) {
    res.status(500).json({ error: 'missing trmnl auth context' })
    return
  }

  if (typeof userUuid !== 'string' || !userUuid) {
    res.status(400).json({ error: 'missing user_uuid' })
    return
  }

  // keep link between token and uuid fresh
  await attachUserUuid(tokenHash, userUuid)

  // parse TRMNL meta (optional)
  let meta: TrmnlMeta | null = null
  if (typeof trmnlRaw === 'string' && trmnlRaw) {
    try {
      meta = JSON.parse(trmnlRaw)
    } catch {
      logger.warn('[TRMNL] Failed to parse trmnl metadata JSON')
    }
  }
  const instanceName = meta?.plugin_settings?.instance_name ?? 'Metro Commute'

  // load settings for this plugin instance
  const settings = await getSettingsByUuid(userUuid)
  const crass = (settings?.crass_level ?? 0) === 1
  const selected = (settings?.lines ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .filter((s) => VALID_LINES.has(s))

  // pick line to display (rotate if multiple)
  let displayLine = selected[0] ?? 'GR'
  if (selected.length > 1) {
    const ts = meta?.system?.timestamp_utc ?? Math.floor(Date.now() / 1000)
    displayLine = selected[ts % selected.length]
  }

  // fetch WMATA incidents
  const apiKey = process.env.WMATA_PRIMARY_KEY
  if (!apiKey) {
    logger.error('[TRMNL] missing WMATA_PRIMARY_KEY')
    res.status(500).json({ error: 'Internal Server Error' })
    return
  }

  let incidents: WmataIncident[] = []
  try {
    incidents = await fetchWmataIncidentsCached(apiKey)
    logger.debug('[TRMNL] WMATA incidents fetched', { count: incidents.length })
  } catch (e) {
    logger.warn('[WMATA] incidents fetch failed', String(e))
  }

  const { bad, headsUp } = countCommuteIssuesByLine(incidents)
  const badCount = bad[displayLine] ?? 0
  const headsUpCount = headsUp[displayLine] ?? 0
  const { status, subtitle } = statusFromCount(badCount, crass)
  const subtitleFinal = headsUpCount > 0 ? `${subtitle} • ${headsUpCount} alert(s)` : subtitle

  const full = `
    <div class="view view--full">
      <div class="layout">
        <div class="columns">
          <div class="column">
            <div class="markdown gap--large">
              <span class="title">${escapeHtml(instanceName)} • ${escapeHtml(displayLine)}</span>

              <div class="content-element content content--center">
                <div style="font-size: 72px; font-weight: 700; letter-spacing: 2px;">
                  ${escapeHtml(status)}
                </div>
                <div class="label mt-2">${escapeHtml(subtitleFinal)}</div>
              </div>

              <div class="mt-4" style="display:flex; justify-content:space-between;">
                <span class="label label--underline">WMATA</span>
                <span class="label">${escapeHtml(String(badCount))} incident(s)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `.trim()

  res.json({
    markup: full,
    markup_half_horizontal: full.replace('view--full', 'view--half_horizontal'),
    markup_half_vertical: full.replace('view--full', 'view--half_vertical'),
    markup_quadrant: full.replace('view--full', 'view--quadrant'),
    shared: '',
  })
}

////////////////////////
// Helper methods below

type TrmnlMeta = {
  user?: { name?: string; time_zone_iana?: string; utc_offset?: number }
  device?: { friendly_id?: string; percent_charged?: number; wifi_strength?: number; height?: number; width?: number }
  system?: { timestamp_utc?: number }
  plugin_settings?: { instance_name?: string }
}

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const VALID_LINES = new Set(['RD', 'OR', 'SV', 'BL', 'YL', 'GR'])
const COUNTED_TYPES = new Set(['DELAY', 'EMERGENCY'])
const ALERT_BAD_PATTERNS = [
  /single\s*track/i,
  /\bevery\s+\d+\s*(min|mins|minutes)\b/i,
  /\bheadway/i,
  /\bshuttle\b/i,
  /\bbypass\b/i,
  /\bdelay(s)?\b/i,
  /\bmajor\s+construction\b/i,
  /\bconstruction\b/i,
  /\btrack work\b/i,
]

function parseLinesAffected(v: unknown): string[] {
  if (typeof v !== 'string') return []
  return v
    .split(';')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => VALID_LINES.has(s))
}

type WmataIncident = {
  IncidentID: string
  IncidentType?: string | null
  LinesAffected?: string | null
  Description?: string | null
}

function dedupeIncidents(incidents: WmataIncident[]) {
  const seen = new Set<string>()
  const out: WmataIncident[] = []
  for (const inc of incidents) {
    if (!inc?.IncidentID) continue
    if (seen.has(inc.IncidentID)) continue
    seen.add(inc.IncidentID)
    out.push(inc)
  }
  return out
}

function isBadAlert(inc: WmataIncident): boolean {
  const desc = (inc.Description ?? '').toString()
  return ALERT_BAD_PATTERNS.some((re) => re.test(desc))
}

function countCommuteIssuesByLine(incidents: WmataIncident[]) {
  const bad: Record<string, number> = { RD: 0, OR: 0, SV: 0, BL: 0, YL: 0, GR: 0 }
  const headsUp: Record<string, number> = { RD: 0, OR: 0, SV: 0, BL: 0, YL: 0, GR: 0 }

  for (const inc of dedupeIncidents(incidents)) {
    const t = (inc.IncidentType ?? '').toString().trim().toUpperCase()
    const lines = parseLinesAffected(inc.LinesAffected ?? '')
    if (lines.length === 0) continue

    let bucket: 'bad' | 'headsUp' | null = null
    if (t === 'DELAY') bucket = 'bad'
    else if (t === 'ALERT') bucket = isBadAlert(inc) ? 'bad' : 'headsUp'
    else bucket = 'headsUp' // “subject to change”; don’t ignore new types

    for (const line of lines) {
      if (bucket === 'bad') bad[line]++
      else headsUp[line]++
    }
  }

  return { bad, headsUp }
}

async function fetchWmataIncidents(apiKey: string): Promise<WmataIncident[]> {
  logger.info('[TRMNL] Attempting WMATA API call')
  const resp = await fetch('https://api.wmata.com/Incidents.svc/json/Incidents', {
    headers: { api_key: apiKey },
  })
  if (!resp.ok) {
    logger.warn(`[TRMNL] Failed to fetch WMATA status - got ${resp.status}`)
    throw new Error(`WMATA incidents fetch failed: ${resp.status}`)
  }
  const data = (await resp.json()) as { Incidents?: WmataIncident[] }
  return Array.isArray(data.Incidents) ? data.Incidents : []
}

let cachedIncidents: WmataIncident[] | null = null
let cachedAtMs = 0
let inFlight: Promise<WmataIncident[]> | null = null

const WMATA_TTL_MS = 10 * 60 * 1000 // 10 minute cache

async function fetchWmataIncidentsCached(apiKey: string): Promise<WmataIncident[]> {
  const now = Date.now()

  if (cachedIncidents && now - cachedAtMs < WMATA_TTL_MS) {
    return cachedIncidents
  }

  // de-dupe concurrent refreshes
  if (inFlight) return inFlight

  inFlight = (async () => {
    const fresh = await fetchWmataIncidents(apiKey)
    cachedIncidents = fresh
    cachedAtMs = Date.now()
    inFlight = null
    return fresh
  })().catch((err) => {
    inFlight = null
    throw err
  })

  return inFlight
}

function statusFromCount(count: number, crass: boolean) {
  if (count === 0) return { status: 'GOOD', subtitle: 'No active delays' }
  if (count === 1) return { status: 'EH.', subtitle: 'Minor delays' }
  if (count === 2) return { status: crass ? 'MILDLY F***ED' : 'MILDLY SCREWED', subtitle: 'Multiple delays' }
  return { status: crass ? 'YOU’RE F***ED' : 'YOU’RE SCREWED', subtitle: `${count} active delays` }
}
