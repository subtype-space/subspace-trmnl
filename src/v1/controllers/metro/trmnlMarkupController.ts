import { RequestHandler } from 'express'
import { logger } from '../../../utils/logger.js'
import { config } from '../../../config.js'
import { getSettingsByUuid } from '../../../utils/dbConnector.js'
import { WmataClient } from '../../../integrations/wmata/wmataClient.js'
import { MetroIncident } from '../../../types/wmata/types.js'
import { MetroMarkup, MarkupVariant } from '../../../types/trmnl/types.js'
import { parseTrmnlMeta } from '../../../utils/trmnlMeta.js'

const client = config.wmata.apiKey ? new WmataClient({ apiKey: config.wmata.apiKey }) : null

// Main logic builder
export const trmnlMarkupController: RequestHandler = async (req, res) => {
  // Token hash should be coming in from trmnlAuth - we modify the request there
  const tokenHash = (req as any).trmnl?.tokenHash as string | undefined
  // These should be coming from TRMNL directly
  const userUuid = req.body?.user_uuid as string | undefined
  const trmnlRaw = req.body?.trmnl

  logger.debug('[TRMNL] Incoming markup request: ', { tokenHash, userUuid, trmnlRaw })
  if (!tokenHash) {
    res.status(500).json({ error: 'Bad Request', message: 'missing trmnl auth context' })
    return
  }

  if (typeof userUuid !== 'string' || !userUuid) {
    logger.debug('[TRMNL] UUID was not provided. Will not render.')
    res.status(400).json({ error: 'Bad Request', message: 'missing user_uuid' })
    return
  }

  if (!client) {
    logger.warn('[WMATA] WMATA API key not configured.')
    res.status(503).json({ error: 'Service Unavailable', message: 'WMATA monitoring not configured.'})
  }

  const meta = parseTrmnlMeta(trmnlRaw)

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
    incidents = await client!.getIncidentsCached()
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
  } else if (totalIncidents >= 5) {
    // If there are 5 or more alerts on the system as a whole, you're probably screwed
    status = crass ? 'SO F***ED' : 'SO SCREWED'
    subtitle = 'Delays may impact transfers'
  } else if (totalIncidents >= 4) {
    // If there are 4 alerts on the system as a whole, upgrade to maybe
    status = 'EH. MAYBE.'
    subtitle = 'Delays may impact transfers'
  } else {
    const s = statusFromCount(disruptionCount, crass) // otherwise, just check for delays on the targeted line only
    status = s.status
    subtitle = s.subtitle
  }

  // This "subtitle" is for the active line being shown
  const subtitleFinal = alertCount > 0 && !hasEmergency ? `${subtitle} • ${alertCount} alert(s)` : subtitle

  const dots = selected
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

  const model: MetroMarkup = { instanceName, displayLine, status, subtitleFinal, dots, totalIncidents, utcOffset }
  res.json({
    markup: renderMarkup(model, 'full'),
    markup_half_horizontal: renderMarkup(model, 'half_horizontal'),
    markup_half_vertical: renderMarkup(model, 'half_vertical'),
    markup_quadrant: renderMarkup(model, 'quadrant'),
    shared: '',
  })
}

function renderMarkup(m: MetroMarkup, variant: MarkupVariant): string {
  const bigText = variant === 'full' ? '92px' : variant === 'quadrant' ? '36px' : '48px'
  const showSubtitle = variant === 'full' || variant === 'half_vertical'
  const subtitleSize = variant === 'half_vertical' ? '24px' : '28px' // subtitle size needs to be modified on half vertical, not shown on hori or quad
  const offset = Number(m.utcOffset) || 0

  // Only for half vert set the title to refresh time, otherwise set total amount of alerts across the system
  const bottomTitleBarTitle =
    variant === 'half_vertical' || variant === 'quadrant'
      ? `{{ "alert" | pluralize: ${escapeHtml(String(m.totalIncidents))}  }} • ${escapeHtml(m.displayLine)}`
      : m.totalIncidents === 0
        ? escapeHtml(m.instanceName)
        : `{{ "alert" | pluralize: ${escapeHtml(String(m.totalIncidents))}  }} across WMATA`

  // Dont set this for half vert
  const bottomTitleBarInstance =
    variant === 'half_vertical' || variant === 'quadrant'
      ? `<span class="instance">{{ 'now' | date: '%s' | plus: ${offset} | date: '%H:%M' }}</span>`
      : `<span class="instance">Refreshed at {{ 'now' | date: '%s' | plus: ${offset} | date: '%H:%M' }}</span>`

  return `
<style>
  .content-element { --s: 1; }
  .screen--lg .content-element { --s: 1.3; }

  .big-status { font-size: calc(${bigText} * var(--s, 1)); font-weight: 700; letter-spacing: 2px; }

  .line-indicators {
      display: flex;
      gap: calc(12px * var(--s, 1));
  }

  /* line colors */
  .line-GR { background: #6B7280; }
  .line-RD { background: #6B7280; }
  .line-BL { background: #6B7280; }
  .line-OR { background: #6B7280; }
  .line-YL { background: #6B7280; }
  .line-SV { background: #6B7280; }

  .line-dot {
      position: relative;
      width: calc(64px * var(--s, 1));
      height: calc(64px * var(--s, 1));
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: calc(28px * var(--s, 1));
      color: white;
  }

  /* alert overlay */
  .alert {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: calc(24px * var(--s, 1));
      height: calc(24px * var(--s, 1));
      border-radius: 999px;
      background: white;
      color: black;
      font-size: calc(18px * var(--s, 1));
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
<div class="view view--${variant}">
  <div class="layout">
    <div class="columns">
      <div class="column">
        <div class="markdown gap--large" style="text-align:center;">
          ${variant !== 'quadrant' ? `<span class="title">${escapeHtml(m.instanceName)} • ${escapeHtml(m.displayLine)}</span>` : ``}
          <div class="content-element" style="display: flex;flex-direction: column;align-items: center;justify-content: center;${variant === 'full' || variant === 'half_vertical' ? `gap: 12px;` : ``}">
          <div class="big-status">${escapeHtml(m.status)}</div>
          ${showSubtitle ? `<div class="label mt-2" style="font-size: calc(${subtitleSize} * var(--s, 1));">${escapeHtml(m.subtitleFinal)}</div>` : ``}
          ${m.dots ? `<div class="line-indicators" style="margin-top:24px;margin-bottom:20px;">${m.dots}</div>` : ``}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="title_bar">
  <img class="image" src="https://upload.wikimedia.org/wikipedia/commons/0/0a/WMATA_Metro_Logo_small.svg" />
  <span class="title">${bottomTitleBarTitle}</span>
  ${bottomTitleBarInstance}
</div>
`.trim()
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


function statusFromCount(count: number, crass: boolean) {
  if (count === 0) return { status: "YOU'RE FINE. ", subtitle: 'No active delays' }
  if (count === 1) return { status: 'EH. MAYBE.', subtitle: 'Minor delays' }
  if (count === 2) return { status: crass ? 'F***ED.' : 'SCREWED.', subtitle: 'Multiple delays' }
  return { status: crass ? 'SO F***ED' : 'SO SCREWED', subtitle: `${count} active delays` }
}
