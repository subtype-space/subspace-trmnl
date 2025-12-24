import { RequestHandler } from 'express'
import { logger } from '../../utils/logger.js'
import { getSettingsByUuid } from '../../utils/dbConnector.js'
import { WmataClient } from '../../integrations/wmata/wmataClient.js'
import { MetroIncident } from '../../types/wmata/types.js'
import { TrmnlMeta } from '../../types/trmnl/types.js'

// Set up cache so we dont needlessly call to WMATA all the time
// rough TTL of about 10 minutes, can change. Minimum at TRMNL is ~15 but can change based on device and dev
let cachedIncidents: MetroIncident[] | null = null
let cachedAtMs = 0
let inFlight: Promise<MetroIncident[]> | null = null

const WMATA_TTL_MS = 10 * 60 * 1000 // 10 minute cache

const client = new WmataClient({ apiKey: process.env.WMATA_PRIMARY_KEY ?? '' })

// Main logic builder
export const trmnlMarkupController: RequestHandler = async (req, res) => {
  // Token hash should be coming in from trmnlAuth - we modify the request there
  const tokenHash = (req as any).trmnl?.tokenHash as string | undefined
  // These should be coming from TRMNL directly
  const userUuid = req.body?.user_uuid as string | undefined
  const trmnlRaw = req.body?.trmnl

  logger.debug('[TRMNL] Incoming markup request: ', { tokenHash, userUuid, trmnlRaw })
  if (!tokenHash) {
    res.status(500).json({ error: 'missing trmnl auth context' })
    return
  }

  if (typeof userUuid !== 'string' || !userUuid) {
    logger.debug('[TRMNL] UUID was not provided. Will not render.')
    res.status(400).json({ error: 'missing user_uuid' })
    return
  }

  // parse TRMNL meta (optional)
  let meta: TrmnlMeta | null = null
  if (trmnlRaw && typeof trmnlRaw === 'object') {
    meta = trmnlRaw as TrmnlMeta
  } else if (typeof trmnlRaw === 'string' && trmnlRaw.trim()) {
    try {
      meta = JSON.parse(trmnlRaw)
    } catch {
      logger.warn('[TRMNL] Failed to parse trmnl metadata JSON')
    }
  }

  const utcOffset = Number(meta?.user?.utc_offset ?? 0)

  // load settings for this plugin instance
  // getSettingsByUuid comes from dbConnector
  const settings = await getSettingsByUuid(userUuid)
  const crass = (settings?.crass_level ?? 0) === 1
  const instanceName = `Is my metro commute ${crass ? 'f***ed' : 'screwed'}?`

  const selected = (settings?.lines ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .filter((s) => VALID_LINES.has(s))

  const displayLine = settings?.primary_line ?? 'RD'

  let incidents: MetroIncident[] = []
  try {
    incidents = await fetchWmataIncidentsCached()
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
  } else if (totalIncidents > 4) {
    status = 'EH. MAYBE.'
    subtitle = 'Delays may impact transfers'
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
        <div class="markdown gap--large" style="text-align:center;">
          <span class="title">${escapeHtml(instanceName)} • ${escapeHtml(displayLine)}</span>
          <div class="content-element" style="display: flex;flex-direction: column;align-items: center;justify-content: center;gap: 12px;">
          <div style="font-size: 72px; font-weight: 700; letter-spacing: 2px;">
            ${escapeHtml(status)}
          </div>
          <div class="label mt-2" style="font-size: 24px;">${escapeHtml(subtitleFinal)}</div>
          <div class="line-indicators" style="margin-top: 24px; margin-bottom: 20px;">
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
  <span class="instance">Refreshed at {{ 'now' | date: '%s' | plus: ${utcOffset} | date: '%H:%M' }}</span>
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

function dedupeIncidents(incidents: MetroIncident[]) {
  const seen = new Set<string>()
  const out: MetroIncident[] = []
  for (const inc of incidents) {
    if (!inc?.IncidentID) continue
    if (seen.has(inc.IncidentID)) continue
    seen.add(inc.IncidentID)
    out.push(inc)
  }
  return out
}

function classifyImpact(inc: MetroIncident): 'disruption' | 'alert' {
  const t = (inc.IncidentType ?? '').toUpperCase()

  if (t === 'EMERGENCY' || t === 'DELAY') return 'disruption'
  if (t === 'ALERT') return isBadAlert(inc) ? 'disruption' : 'alert'
  return 'alert'
}

function isBadAlert(inc: MetroIncident): boolean {
  const desc = (inc.Description ?? '').toString()
  return ALERT_BAD_PATTERNS.some((re) => re.test(desc))
}

// Ignore duped incidents by ID
// For every incident, classify it, and for each applicable line, increment the counter of a FUCKED or heads up! by 1
function countCommuteIssuesByLine(incidents: MetroIncident[]) {
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

async function fetchWmataIncidents(): Promise<MetroIncident[]> {
  logger.info('[TRMNL] Attempting WMATA API call')

  try {
    const response = await client.getIncidents()
    return Array.isArray(response) ? response : []
  } catch (e) {
    logger.warn(`[TRMNL] Failed to fetch WMATA incidents`)
    throw new Error('WMATA incidents fetch failed')
  }
}

async function fetchWmataIncidentsCached(): Promise<MetroIncident[]> {
  const now = Date.now()
  if (cachedIncidents && now - cachedAtMs < WMATA_TTL_MS) {
    logger.debug('[TRMNL] Using cached info!')
    return cachedIncidents
  }

  // de-dupe concurrent refreshes
  if (inFlight) return inFlight

  logger.debug('[TRMNL] Cache stale - using API call')
  inFlight = (async () => {
    const fresh = await fetchWmataIncidents()
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
  return { status: crass ? 'SO F***ED' : 'SO SCREWED', subtitle: `${count} active delays` }
}
