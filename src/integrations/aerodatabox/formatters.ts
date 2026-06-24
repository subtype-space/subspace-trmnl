import type { FlightDisplayData } from '../../types/trmnl/flightTypes.js'
import { logger } from '../../utils/logger.js'

export const AIRLINE_NAMES: Record<string, string> = {
  UA: 'United Airlines',
  AA: 'American Airlines',
  DL: 'Delta Air Lines',
  WN: 'Southwest Airlines',
  B6: 'JetBlue',
  AS: 'Alaska Airlines',
  NK: 'Spirit Airlines',
  F9: 'Frontier Airlines',
  HA: 'Hawaiian Airlines',
  G4: 'Allegiant Air',
  SY: 'Sun Country Airlines',
  BA: 'British Airways',
  LH: 'Lufthansa',
  AF: 'Air France',
  KL: 'KLM',
  EK: 'Emirates',
  QR: 'Qatar Airways',
  SQ: 'Singapore Airlines',
  CX: 'Cathay Pacific',
  NH: 'All Nippon Airways',
  JL: 'Japan Airlines',
  AC: 'Air Canada',
  WS: 'WestJet',
  AM: 'Aeromexico',
  KE: 'Korean Air',
  EY: 'Etihad Airways',
  TK: 'Turkish Airlines',
  CZ: 'China Southern',
  QF: 'Qantas',
  GB: 'ABX Air'
}

type MarkupVariant = 'full' | 'half_horizontal' | 'half_vertical' | 'quadrant'

export function formatHeading(track: number | undefined): string {
  if (typeof track !== 'number') return '--'
  const deg = Math.round(track) % 360
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const idx = Math.round(deg / 45) % 8
  return `${deg}° ${cardinals[idx]}`
}

// Haversine distance in km between two lat/lon points
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Calculate flight progress as 0-100, or null if insufficient data
export function calcProgress(
  aircraftLat: number | undefined,
  aircraftLon: number | undefined,
  fromLat: number | undefined,
  fromLon: number | undefined,
  toLat: number | undefined,
  toLon: number | undefined
): number | null {
  if (aircraftLat == null || aircraftLon == null) return null
  if (fromLat == null || fromLon == null || toLat == null || toLon == null) return null

  const totalDist = haversineKm(fromLat, fromLon, toLat, toLon)
  if (totalDist < 1) return null // airports too close, avoid division issues

  const flownDist = haversineKm(fromLat, fromLon, aircraftLat, aircraftLon)
  const pct = Math.round((flownDist / totalDist) * 100)
  return Math.max(0, Math.min(100, pct))
}

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderMarkup(
  flights: FlightDisplayData[],
  variant: MarkupVariant,
  _utcOffset: number,
  baseUrl: string
): string {
  const logoWidth =
    variant === 'full' ? '320px' : variant === 'half_vertical' ? '200px' : variant === 'half_horizontal' ? '220px' : '160px'
  const logoHeight =
    variant === 'full' ? '140px' : variant === 'half_vertical' ? '90px' : variant === 'half_horizontal' ? '100px' : '70px'

  if (flights.length === 0) {
    return renderEmptyMarkup(variant)
  }

  const lastUpdated = flights.length > 0 ? flights[0].lastUpdated : '--'
  const flightCards = flights.map((f) => renderFlightCard(f, variant, baseUrl)).join('')

  // TRMNL X helper
  const s = (px: number) => `calc(${px}px * var(--s, 1))`

  return `
<style>
  .flight-card { --s: 1; }
  .screen--lg .flight-card { --s: 1.3; }

  /* full variant: hero arc + stat tiles. Stretch the framework chain so the
     card can distribute its blocks top-to-bottom and fill the taller X screen. */
  .view--full, .view--full .layout, .view--full .columns, .view--full .column, .view--full .markdown { display: flex; flex-direction: column; flex: 1; width: 100%; }
  .view--full .flight-card { justify-content: space-between; padding: ${s(20)} ${s(40)}; }
  .view--full .flight-top { align-items: center; }
  .flight-arc-wrap { display: flex; align-items: center; gap: ${s(10)}; width: 100%; }
  .arc-end { display: flex; flex-direction: column; align-items: center; min-width: ${s(96)}; }
  .arc-code { font-size: ${s(40)}; font-weight: 800; line-height: 1; }
  .arc-time { font-size: ${s(18)}; font-weight: 600; color: #333; margin-top: ${s(4)}; }
  .arc-svg { flex: 1 1 0; min-width: 0; height: auto; display: block; overflow: visible; }
  .stat-tiles { display: flex; gap: ${s(12)}; width: 100%; }
  .stat-tile { flex: 1; border: ${s(2)} solid black; border-radius: ${s(10)}; padding: ${s(10)} ${s(6)}; display: flex; flex-direction: column; align-items: center; gap: ${s(3)}; }
  .stat-tile-label { font-size: ${s(15)}; font-weight: 700; letter-spacing: 1.5px; }
  .stat-tile-value { font-size: ${s(26)}; font-weight: 800; }

  .flight-card { margin: ${variant === 'full' ? '0' : variant === 'half_vertical' ? `${s(12)} 0 0` : variant === 'half_horizontal' ? `${s(8)} 0` : `${s(6)} ${s(8)}`}; padding: ${variant === 'full' ? `${s(12)} ${s(24)}` : '0'}; font-family: 'IBM Plex Sans', 'SF Pro Text', 'Segoe UI', sans-serif; display: flex; flex-direction: column; flex: 1; }
  .flight-details { margin-top: ${variant === 'full' ? s(60) : '0'}; }
  .flight-top { display: flex; align-items: center; gap: ${variant === 'quadrant' ? s(12) : s(20)}; width: 100%; }
  .view--half_horizontal .flight-top { display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto auto; align-items: center; column-gap: ${s(16)}; row-gap: ${s(2)}; }
  .view--half_horizontal .airline-logo { grid-column: 1; grid-row: 1; align-self: center; }
  .view--half_horizontal .flight-meta { grid-column: 3; grid-row: 1; }
  .flight-meta { display: flex; flex-direction: column; gap: ${variant === 'quadrant' ? s(3) : s(5)}; align-items: flex-end; text-align: right; margin-left: auto; }
  .airline-name { font-size: ${variant === 'quadrant' ? s(18) : variant === 'full' ? s(30) : s(24)}; font-weight: 700; letter-spacing: 0.2px; }
  .flight-number { font-size: ${variant === 'quadrant' ? s(26) : variant === 'full' ? s(44) : s(34)}; font-weight: 800; }
  .flight-aircraft { font-size: ${variant === 'quadrant' ? s(14) : variant === 'full' ? s(20) : s(17)}; font-weight: 500; color: #444; }
  .flight-status { font-size: ${variant === 'quadrant' ? s(16) : variant === 'full' ? s(24) : s(20)}; font-weight: 600; }
  .flight-route { display: flex; align-items: center; gap: ${s(12)}; width: 100%; font-size: ${variant === 'quadrant' ? s(20) : s(28)}; font-weight: 700; margin: ${variant === 'quadrant' ? `${s(8)} 0 ${s(5)}` : `${s(14)} 0 ${s(8)}`}; }
  .view--half_vertical { display: flex; flex-direction: column; flex: 1; align-items: stretch; width: 100%; }
  .view--half_vertical .flight-top { margin-bottom: ${s(64)}; }
  .view--half_vertical .flight-details { margin-top: auto; display: flex; flex-direction: column; gap: ${s(16)}; }
  .view--half_vertical .flight-stats { margin-top: ${s(64)}; font-size: ${s(14)}; gap: ${s(10)}; justify-content: space-between; }
  .view--half_vertical .flight-route { width:100%; margin: 0; }
  .view--half_vertical .stat-item { display: flex; flex-direction: column; align-items: center; }
  .view--half_vertical .stat-value { font-size: ${s(16)}; font-weight: 700; }
  .view--half_horizontal .flight-top .flight-route { grid-column: 1 / -1; grid-row: 2; margin: ${s(6)} 0 0; font-size: ${s(22)}; }
  .view--half_horizontal .flight-top .flight-stats { grid-column: 2; grid-row: 1; flex-direction: column; align-items: flex-start; justify-self: center; gap: ${s(2)}; font-size: ${s(16)}; margin-top: 0; }
  .view--half_horizontal .flight-stat-aircraft { font-weight: 600; }
  .view--half_horizontal .airline-name { font-size: ${s(20)}; }
  .view--half_horizontal .flight-number { font-size: ${s(30)}; }
  .view--half_horizontal .flight-aircraft { display: none; }
  .view--half_horizontal .flight-status { font-size: ${s(18)}; }
  .view--half_horizontal .route-plane { font-size: ${s(28)}; }
  .route-line { flex: 1; height: ${s(2)}; background: black; position: relative; }
  .route-line-flown { height: ${s(3)}; background: black; }
  .route-line-remaining { height: 0; background: none; border-top: ${s(3)} dotted black; }
  .route-plane { font-size: ${variant === 'quadrant' ? s(28) : variant === 'full' ? s(48) : s(36)}; line-height: 1; }
  .flight-stats { display: flex; ${variant === 'full' ? 'justify-content: space-between;' : `gap: ${variant === 'quadrant' ? s(14) : s(26)};`} font-size: ${variant === 'full' ? s(24) : variant === 'quadrant' ? s(15) : s(20)}; margin-top: ${variant === 'quadrant' ? s(3) : s(7)}; }
  .stat-label { font-weight: 700; }
  .airline-logo { width: 100%; max-width: calc(${logoWidth} * var(--s, 1)); max-height: calc(${logoHeight} * var(--s, 1)); object-fit: contain; }
</style>
<div class="view view--${variant}">
  <div class="layout">
    <div class="columns">
      <div class="column">
        <div class="markdown">
          ${flightCards}
        </div>
      </div>
    </div>
  </div>
</div>

<div class="title_bar">
  <span class="title">Flight Tracker</span>
  <span class="instance">Updated ${escapeHtml(lastUpdated)}</span>
</div>
`.trim()
}

// Build a great-circle-style arc with the plane positioned (and rotated to the
// path tangent) at progressPct. Flown segment is solid, remaining is dashed.
// Splitting the quadratic bezier at t via de Casteljau gives both halves exactly.
function buildArcSvg(progressPct: number | null): string {
  const P0 = { x: 34, y: 100 }
  const P1 = { x: 300, y: -8 } // control point sets the (gentle) arc height
  const P2 = { x: 566, y: 100 }
  type Pt = { x: number; y: number }
  const lerp = (a: Pt, b: Pt, r: number): Pt => ({ x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r })
  // de Casteljau split of the quadratic at tt -> handles describing the point + its sub-curve control
  const split = (tt: number) => {
    const a = lerp(P0, P1, tt)
    const b = lerp(P1, P2, tt)
    return { a, b, c: lerp(a, b, tt) }
  }

  const t = progressPct != null ? Math.max(0, Math.min(1, progressPct / 100)) : 0
  const mid = split(t) // mid.c = plane position

  // Tangent direction of a quadratic bezier is proportional to (b - a)
  const angle = (Math.atan2(mid.b.y - mid.a.y, mid.b.x - mid.a.x) * 180) / Math.PI

  // Leave a symmetric gap on both sides of the plane so the glyph never overlaps the route lines.
  // |B'(t)| = 2|b-a| is the curve speed (px per unit t); ~one plane half-width is gapPx/speed in t.
  const speed = 2 * Math.hypot(mid.b.x - mid.a.x, mid.b.y - mid.a.y)
  const gapT = speed > 0 ? Math.min(32 / speed, 0.14) : 0.07
  const back = split(Math.max(t - gapT, 0)) // flown (solid) ends here, just behind the tail
  const fwd = split(Math.min(t + gapT, 1)) // remaining (dotted) starts here, just past the nose

  const n = (v: number) => v.toFixed(1)
  const flownPath = t - gapT > 0.01 ? `M${P0.x},${P0.y} Q${n(back.a.x)},${n(back.a.y)} ${n(back.c.x)},${n(back.c.y)}` : ''
  const remainingPath = t + gapT < 0.99 ? `M${n(fwd.c.x)},${n(fwd.c.y)} Q${n(fwd.b.x)},${n(fwd.b.y)} ${P2.x},${P2.y}` : ''

  // The ✈ glyph (U+2708) rests pointing east (+x), so rotate by the tangent angle to align its nose with travel
  return `<svg class="arc-svg" viewBox="0 0 600 124" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      ${remainingPath ? `<path d="${remainingPath}" fill="none" stroke="black" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 11" />` : ''}
      ${flownPath ? `<path d="${flownPath}" fill="none" stroke="black" stroke-width="5" stroke-linecap="round" />` : ''}
      <circle cx="${P0.x}" cy="${P0.y}" r="6" fill="black" />
      <circle cx="${P2.x}" cy="${P2.y}" r="6" fill="white" stroke="black" stroke-width="3" />
      <g transform="translate(${n(mid.c.x)},${n(mid.c.y)}) rotate(${n(angle)})"><text text-anchor="middle" dominant-baseline="central" font-size="48" fill="black">✈</text></g>
    </svg>`
}

function renderFullCard(f: FlightDisplayData, baseUrl: string): string {
  const logoUrl = `${baseUrl}/public/radarbox_banners/${encodeURIComponent(f.airlineIcao)}.png`
  const airlineCode = f.airlineIata || ''
  const airlineName = AIRLINE_NAMES[airlineCode] ?? (airlineCode || f.flightIata)
  const flightCode =
    airlineCode && f.flightIata.startsWith(airlineCode)
      ? `${airlineCode} ${f.flightIata.slice(airlineCode.length)}`
      : f.flightIata

  const hasLiveData = f.altitudeFt !== '--' || f.speedMph !== '--' || f.heading !== '--'
  const altDisplay = `${escapeHtml(f.altitudeFt)}${f.altitudeFt !== '--' && f.altitudeFt !== 'Ground' ? ' ft' : ''}`
  const spdDisplay = `${escapeHtml(f.speedMph)}${f.speedMph !== '--' ? ' mph' : ''}`

  const tiles = hasLiveData
    ? [
        { label: 'ALT', value: altDisplay },
        { label: 'SPD', value: spdDisplay },
        { label: 'HDG', value: escapeHtml(f.heading) },
        { label: 'ETA', value: escapeHtml(f.eta) },
      ]
    : [
        { label: 'DEP', value: escapeHtml(f.depTime) },
        { label: 'ETA', value: escapeHtml(f.eta) },
      ]

  const tilesHtml = tiles
    .map(
      (t) =>
        `<div class="stat-tile"><span class="stat-tile-label">${t.label}</span><span class="stat-tile-value">${t.value}</span></div>`
    )
    .join('')

  return `
  <div class="flight-card">
    <div class="flight-top">
      <img class="image-dither airline-logo" src="${logoUrl}" onerror="this.style.display='none'" />
      <div class="flight-meta">
        <span class="airline-name">${escapeHtml(airlineName)}</span>
        <span class="flight-number">${escapeHtml(flightCode)}</span>
        <span class="flight-aircraft">${escapeHtml(f.aircraftModel)}</span>
        <span class="flight-status">${escapeHtml(f.status)}</span>
      </div>
    </div>
    <div class="flight-arc-wrap">
      <div class="arc-end">
        <span class="arc-code">${escapeHtml(f.depAirport || '---')}</span>
        <span class="arc-time">${escapeHtml(f.depTime)}</span>
      </div>
      ${buildArcSvg(f.progressPct)}
      <div class="arc-end">
        <span class="arc-code">${escapeHtml(f.arrAirport || '---')}</span>
        <span class="arc-time">${escapeHtml(f.eta)}</span>
      </div>
    </div>
    <div class="stat-tiles">
      ${tilesHtml}
    </div>
  </div>`
}

function renderFlightCard(f: FlightDisplayData, variant: MarkupVariant, baseUrl: string): string {
  if (variant === 'full') return renderFullCard(f, baseUrl)

  const logoUrl = `${baseUrl}/public/radarbox_banners/${encodeURIComponent(f.airlineIcao)}.png`
  const showStats = variant !== 'quadrant'
  const showRoute = true
  const embedRouteInTop = variant === 'half_horizontal'
  const airlineCode = f.airlineIata || ''
  const airlineName = AIRLINE_NAMES[airlineCode] ?? (airlineCode || f.flightIata)
  const flightCode =
    airlineCode && f.flightIata.startsWith(airlineCode)
      ? `${airlineCode} ${f.flightIata.slice(airlineCode.length)}`
      : f.flightIata

  // If we have progress data, use flex ratios to position the plane icon
  const hasProgress = f.progressPct != null
  const leftFlex = hasProgress ? Math.max(f.progressPct!, 2) : 1
  const rightFlex = hasProgress ? Math.max(100 - f.progressPct!, 2) : 1
  // Flown segment is solid only when we know progress; otherwise both sides dotted (position unknown)
  const leftLineClass = hasProgress ? 'route-line route-line-flown' : 'route-line route-line-remaining'

  const routeHtml = showRoute
    ? `
    <div class="flight-route">
      <span>${escapeHtml(f.depAirport || '---')}</span>
      <span class="${leftLineClass}" style="flex: ${leftFlex};"></span>
      <span class="route-plane">✈</span>
      <span class="route-line route-line-remaining" style="flex: ${rightFlex};"></span>
      <span>${escapeHtml(f.arrAirport || '---')}</span>
    </div>`
    : ''

  const hasLiveData = f.altitudeFt !== '--' || f.speedMph !== '--' || f.heading !== '--'
  const statsHtml = showStats
    ? hasLiveData
      ? `
    <div class="flight-stats">
      ${variant === 'half_horizontal' ? `<span class="stat-item flight-stat-aircraft">${escapeHtml(f.aircraftModel)}</span>` : ''}
      <span class="stat-item"><span class="stat-label">ALT:</span> <span class="stat-value">${escapeHtml(f.altitudeFt)}${f.altitudeFt !== '--' && f.altitudeFt !== 'Ground' ? ' ft' : ''}</span></span>
      <span class="stat-item"><span class="stat-label">SPD:</span> <span class="stat-value">${escapeHtml(f.speedMph)}${f.speedMph !== '--' ? ' mph' : ''}</span></span>
      <span class="stat-item"><span class="stat-label">HDG:</span> <span class="stat-value">${escapeHtml(f.heading)}</span></span>
      <span class="stat-item"><span class="stat-label">ETA:</span> <span class="stat-value">${escapeHtml(f.eta)}</span></span>
    </div>`
      : `
    <div class="flight-stats">
      ${variant === 'half_horizontal' ? `<span class="stat-item flight-stat-aircraft">${escapeHtml(f.aircraftModel)}</span>` : ''}
      <span class="stat-item"><span class="stat-label">DEP:</span> <span class="stat-value">${escapeHtml(f.depTime)}</span></span>
      <span class="stat-item"><span class="stat-label">ETA:</span> <span class="stat-value">${escapeHtml(f.eta)}</span></span>
    </div>`
    : ''

  const routeBlock = showRoute ? routeHtml : ''
  const statsBlock = showStats ? statsHtml : ''
  const detailsContent = `${statsBlock}${routeBlock}`
  const detailsBlock = embedRouteInTop ? '' : `<div class="flight-details">${detailsContent}</div>`

  return `
  <div class="flight-card">
    <div class="flight-top">
      <img class="image-dither airline-logo" src="${logoUrl}" onerror="this.style.display='none'" />
      <div class="flight-meta">
        <span class="airline-name">${escapeHtml(airlineName)}</span>
        <span class="flight-number">${escapeHtml(flightCode)}</span>
        <span class="flight-aircraft">${escapeHtml(f.aircraftModel)}</span>
        <span class="flight-status">${escapeHtml(f.status)}</span>
      </div>
      ${embedRouteInTop ? routeBlock : ''}
      ${embedRouteInTop ? statsBlock : ''}
    </div>
    ${detailsBlock}
  </div>`
}

function renderEmptyMarkup(variant: MarkupVariant): string {
  const textSize = variant === 'quadrant' ? '20px' : '28px'
  return `
<style>
  /* TRMNL X scale-up: see renderMarkup for the rationale. */
  .flight-empty { --s: 1; font-size: calc(${textSize} * var(--s, 1)); font-weight: 600; padding: calc(40px * var(--s, 1)) 0; }
  .screen--lg .flight-empty { --s: 1.3; }
</style>
<div class="view view--${variant}">
  <div class="layout">
    <div class="columns">
      <div class="column">
        <div class="markdown" style="text-align:center;">
          <div class="flight-empty">
            Configure flights in settings
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="title_bar">
  <span class="title">Flight Tracker</span>
</div>
`.trim()
}
