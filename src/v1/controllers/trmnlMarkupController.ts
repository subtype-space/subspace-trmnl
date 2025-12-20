import { RequestHandler } from 'express'
import { logger } from '../../utils/logger.js'
import { attachUserUuid, getSettingsByUuid } from '../../utils/dbConnector.js'

// Set up cache so we dont needlessly call to WMATA all the time
// rough TTL of about 10 minutes, can change. Minimum at TRMNL is ~15 but can change based on device and dev
let cachedIncidents: WmataIncident[] | null = null
let cachedAtMs = 0
let inFlight: Promise<WmataIncident[]> | null = null

const WMATA_TTL_MS = 10 * 60 * 1000 // 10 minute cache

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

  // load settings for this plugin instance
  const settings = await getSettingsByUuid(userUuid)
  const crass = (settings?.crass_level ?? 0) === 1
  const instanceName = `Is my metro commute ${crass ? 'fucked' : 'screwed'}?`

  const selected = (settings?.lines ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .filter((s) => VALID_LINES.has(s))

  const displayLine = (settings?.primaryLine ?? 'RD')

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

  const totalIncidents = incidents.length
  const { disruption, alert } = countCommuteIssuesByLine(incidents)
  const disruptionCount = disruption[displayLine] ?? 0
  const alertCount = alert[displayLine] ?? 0

  // If there's ANY emergency, PANIK
  // I love this .some() function so much
  const hasEmergency = dedupeIncidents(incidents).some(
    (inc) => inc.IncidentType?.toString().trim().toUpperCase() === 'EMERGENCY'
  )
  let status: string
  let subtitle: string
  if (hasEmergency) {
    status = crass ? "YOU'RE SO F***ED." : "YOU'RE SO SCREWED."
    subtitle = 'Emergency on the line'
  } else {
    const s = statusFromCount(disruptionCount, crass)
    status = s.status
    subtitle = s.subtitle
  }

  // This "subtitle" is for the active line being shown
  const subtitleFinal = alertCount > 0 && !hasEmergency ? `${subtitle} • ${alertCount} alert(s)` : subtitle

  // based on user preference, display the other lines (but not the current 'hero' line)
  const dots = selected
    .filter((l) => l !== displayLine)
    .map((l) => {
      const b = disruption[l] ?? 0
      const h = alert[l] ?? 0
      if (b === 0 && h === 0) return ''

      const isBad = b > 0
      const symbol = isBad ? '‼' : '!'
      const cls = isBad ? 'alert-bad' : 'alert-warn'

      return `
      <div class="line-dot line-${l}">
        ${escapeHtml(l)}
        <span class="alert ${cls}">${escapeHtml(symbol)}</span>
      </div>
    `.trim()
    })
    .filter(Boolean)
    .join('')

  const full = `
<style>
  .line-indicators {
      display: flex;
      gap: 12px;
      margin-top: 16px;
  }

  /* line colors */
  .line-GR { background: #2E8B57; }
  .line-RD { background: #B22222; }
  .line-BL { background: #1E3A8A; }
  .line-OR { background: #D97706; }
  .line-YL { background: #CA8A04; }
  .line-SV { background: #6B7280; }

  .line-dot {
      position: relative;
      width: 48px;
      height: 48px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      color: white;
  }

  /* alert overlay */
  .alert {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: white;
      color: black;
      font-size: 14px;
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: center;
  }

  .alert-warn {
      background: white;
      color: black;
      border: 2px solid black;
  }

  .alert-bad {
      background: black;
      color: white;
  }
</style>
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
            <div class="line-indicators">
                ${dots}
            </div>
          <div class="mt-4" style="display:flex; justify-content:space-between;">
            <span class="label">${escapeHtml(String(totalIncidents))} total incident(s) across WMATA</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="title_bar">
  <img class="image" src="https://upload.wikimedia.org/wikipedia/commons/0/0a/WMATA_Metro_Logo_small.svg" />
  <span class="title">${escapeHtml(instanceName)}</span>
  <span class="instance">Refreshed at {{ 'now' | date: '%s' | plus: trmnl.user.utc_offset | date: '%H:%M' }}</span>
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

function classifyImpact(inc: WmataIncident): 'disruption' | 'alert' {
  const t = (inc.IncidentType ?? '').toUpperCase()

  if (t === 'EMERGENCY' || t === 'DELAY') return 'disruption'
  if (t === 'ALERT') return isBadAlert(inc) ? 'disruption' : 'alert'
  return 'alert'
}

function isBadAlert(inc: WmataIncident): boolean {
  const desc = (inc.Description ?? '').toString()
  return ALERT_BAD_PATTERNS.some((re) => re.test(desc))
}

// Ignore duped incidents by ID
// For every incident, classify it, and for each applicable line, increment the counter of a FUCKED or heads up! by 1
function countCommuteIssuesByLine(incidents: WmataIncident[]) {
  const disruption: Record<string, number> = { RD: 0, OR: 0, SV: 0, BL: 0, YL: 0, GR: 0 }
  const alert: Record<string, number> = { RD: 0, OR: 0, SV: 0, BL: 0, YL: 0, GR: 0 }

  // For every incident, determine severity via classifyImpact
  //   determine the line affected
  //   Using the disruption/alert map, based on the parsed line affected, increment the fucked/alert counter by 1
  for (const inc of dedupeIncidents(incidents)) {
    const impact = classifyImpact(inc)
    const lines = parseLinesAffected(inc.LinesAffected ?? '')
    for (const line of lines) {
      impact === 'disruption' ? disruption[line]++ : alert[line]++
    }
  }

  return { disruption, alert }
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

async function fetchWmataIncidentsCached(apiKey: string): Promise<WmataIncident[]> {
  logger.debug('[TRMNL] Using cached info!')
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
    logger.error('[TRMNL] Error updating in-memory cache for WMATA call')
    inFlight = null
    throw err
  })

  return inFlight
}

function statusFromCount(count: number, crass: boolean) {
  if (count === 0) return { status: "YOU'RE FINE. ", subtitle: 'No active delays' }
  if (count === 1) return { status: 'EH. MAYBE.', subtitle: 'Minor delays' }
  if (count === 2) return { status: crass ? 'F***ED.' : 'SCREWED.', subtitle: 'Multiple delays' }
  return { status: crass ? "YOU'RE SO F***ED" : "YOU'RE SO SCREWED", subtitle: `${count} active delays` }
}
