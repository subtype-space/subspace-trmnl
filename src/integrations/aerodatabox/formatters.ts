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

function renderFlightCard(f: FlightDisplayData, variant: MarkupVariant, baseUrl: string): string {
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
  const leftFlex = f.progressPct != null ? Math.max(f.progressPct, 2) : 1
  const rightFlex = f.progressPct != null ? Math.max(100 - f.progressPct, 2) : 1

  const routeHtml = showRoute
    ? `
    <div class="flight-route">
      <span>${escapeHtml(f.depAirport || '---')}</span>
      <span class="route-line" style="flex: ${leftFlex};"></span>
      <span class="route-plane">✈</span>
      <span class="route-line" style="flex: ${rightFlex};"></span>
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
