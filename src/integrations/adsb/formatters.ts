// src/integrations/adsb/formatters.ts
import type { FlightDisplayData } from '../../types/trmnl/flightTypes.js'

// ICAO aircraft type → friendly name
const AIRCRAFT_NAMES: Record<string, string> = {
  B38M: 'Boeing 737 MAX 8',
  B39M: 'Boeing 737 MAX 9',
  B738: 'Boeing 737-800',
  B737: 'Boeing 737-700',
  B739: 'Boeing 737-900',
  A320: 'Airbus A320',
  A321: 'Airbus A321',
  A319: 'Airbus A319',
  A20N: 'Airbus A320neo',
  A21N: 'Airbus A321neo',
  B789: 'Boeing 787-9',
  B78X: 'Boeing 787-10',
  B788: 'Boeing 787-8',
  B77W: 'Boeing 777-300ER',
  B772: 'Boeing 777-200',
  B773: 'Boeing 777-300',
  B744: 'Boeing 747-400',
  B748: 'Boeing 747-8',
  A359: 'Airbus A350-900',
  A35K: 'Airbus A350-1000',
  A388: 'Airbus A380',
  A332: 'Airbus A330-200',
  A333: 'Airbus A330-300',
  A339: 'Airbus A330-900neo',
  E175: 'Embraer E175',
  E190: 'Embraer E190',
  E195: 'Embraer E195',
  CRJ9: 'CRJ-900',
  CRJ7: 'CRJ-700',
  CRJ2: 'CRJ-200',
  C172: 'Cessna 172',
}

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
  KA: 'Korean Air',
  EY: 'Etihad Airways',
  TK: 'Turkish Airlines',
  CZ: 'China Southern',
  QF: 'Qantas'
}

export function lookupAircraftName(icaoType: string): string {
  return AIRCRAFT_NAMES[icaoType] ?? icaoType
}

type MarkupVariant = 'full' | 'half_horizontal' | 'half_vertical' | 'quadrant'

export function deriveStatus(altBaro: number | 'ground' | undefined, baroRate: number | undefined): string {
  if (altBaro === 'ground' || altBaro === 0) return 'On Ground'
  if (typeof altBaro !== 'number') return 'Unknown'
  if (typeof baroRate === 'number') {
    if (baroRate > 200) return 'Climbing'
    if (baroRate < -200) return 'Descending'
  }
  return 'Airborne'
}

export function formatHeading(track: number | undefined): string {
  if (typeof track !== 'number') return '--'
  const deg = Math.round(track) % 360
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const idx = Math.round(deg / 45) % 8
  return `${deg}° ${cardinals[idx]}`
}

// Haversine distance in km between two lat/lon points
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

// Calculate ETA as a formatted local time string, or '--' if insufficient data
// utcOffset is in seconds (e.g. -18000 for EST)
export function calcEta(
  aircraftLat: number | undefined,
  aircraftLon: number | undefined,
  toLat: number | undefined,
  toLon: number | undefined,
  gsKnots: number | undefined,
  utcOffsetSec: number
): string {
  if (aircraftLat == null || aircraftLon == null) return '--'
  if (toLat == null || toLon == null) return '--'
  if (typeof gsKnots !== 'number' || gsKnots < 10) return '--' // too slow / no speed data

  const remainingKm = haversineKm(aircraftLat, aircraftLon, toLat, toLon)
  const gsKmh = gsKnots * 1.852
  const hoursRemaining = remainingKm / gsKmh

  const etaMs = Date.now() + hoursRemaining * 3600 * 1000
  // Apply UTC offset to get local time
  const localEtaMs = etaMs + utcOffsetSec * 1000
  const etaDate = new Date(localEtaMs)

  const h = etaDate.getUTCHours().toString().padStart(2, '0')
  const m = etaDate.getUTCMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
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
  utcOffset: number,
  baseUrl: string
): string {
  const offset = Number(utcOffset) || 0
  const logoSize =
    variant === 'full' ? '240px' : variant === 'half_vertical' ? '140px' : variant === 'half_horizontal' ? '160px' : '120px'

  if (flights.length === 0) {
    return renderEmptyMarkup(variant, offset)
  }

  const flightCards = flights.map((f) => renderFlightCard(f, variant, baseUrl)).join('')

  return `
<style>
  .flight-card { margin: ${variant === 'full' ? '0' : variant === 'half_vertical' ? '12px 0 0' : variant === 'half_horizontal' ? '8px 0' : '6px 8px'}; padding: ${variant === 'full' ? '12px 24px' : '0'}; font-family: 'IBM Plex Sans', 'SF Pro Text', 'Segoe UI', sans-serif; }
  .flight-top { display: flex; align-items: center; gap: ${variant === 'quadrant' ? '12px' : '20px'}; width: 100%; }
  .view--half_horizontal .flight-top { display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto auto; align-items: center; column-gap: 16px; row-gap: 2px; }
  .view--half_horizontal .airline-logo { grid-column: 1; grid-row: 1; align-self: center; }
  .view--half_horizontal .flight-meta { grid-column: 3; grid-row: 1; }
  .flight-meta { display: flex; flex-direction: column; gap: ${variant === 'quadrant' ? '3px' : '5px'}; align-items: flex-end; text-align: right; margin-left: auto; }
  .airline-name { font-size: ${variant === 'quadrant' ? '18px' : variant === 'full' ? '30px' : '24px'}; font-weight: 700; letter-spacing: 0.2px; }
  .flight-number { font-size: ${variant === 'quadrant' ? '26px' : variant === 'full' ? '44px' : '34px'}; font-weight: 800; }
  .flight-aircraft { font-size: ${variant === 'quadrant' ? '14px' : variant === 'full' ? '20px' : '17px'}; font-weight: 500; color: #444; }
  .flight-status { font-size: ${variant === 'quadrant' ? '16px' : variant === 'full' ? '24px' : '20px'}; font-weight: 600; }
  .flight-route { display: flex; align-items: center; gap: 12px; width: 100%; font-size: ${variant === 'quadrant' ? '20px' : '28px'}; font-weight: 700; margin: ${variant === 'quadrant' ? '8px 0 5px' : '14px 0 8px'}; }
  .view--half_vertical { display: flex; flex-direction: column; flex: 1; align-items: stretch; width: 100%; }
  .view--half_vertical .flight-top { margin-bottom: 64px; }
  .view--half_vertical .flight-details { margin-top: auto; display: flex; flex-direction: column; gap: 16px; }
  .view--half_vertical .flight-stats { margin-top: 64px; font-size: 14px; gap: 10px; justify-content: space-between; }
  .view--half_vertical .flight-route { width:100%; margin: 0; }
  .view--half_vertical .stat-item { display: flex; flex-direction: column; align-items: center; }
  .view--half_vertical .stat-value { font-size: 16px; font-weight: 700; }
  .view--half_horizontal .flight-top .flight-route { grid-column: 1 / -1; grid-row: 2; margin: 6px 0 0; font-size: 22px; }
  .view--half_horizontal .flight-top .flight-stats { grid-column: 2; grid-row: 1; flex-direction: column; align-items: flex-start; justify-self: center; gap: 2px; font-size: 16px; margin-top: 0; }
  .view--half_horizontal .flight-stat-aircraft { font-weight: 600; }
  .view--half_horizontal .airline-name { font-size: 20px; }
  .view--half_horizontal .flight-number { font-size: 30px; }
  .view--half_horizontal .flight-aircraft { display: none; }
  .view--half_horizontal .flight-status { font-size: 18px; }
  .view--half_horizontal .route-plane { font-size: 28px; }
  .route-line { flex: 1; height: 2px; background: black; position: relative; }
  .route-plane { font-size: ${variant === 'quadrant' ? '28px' : variant === 'full' ? '48px' : '36px'}; line-height: 1; }
  .flight-stats { display: flex; ${variant === 'full' ? 'justify-content: space-between;' : `gap: ${variant === 'quadrant' ? '14px' : '26px'};`} font-size: ${variant === 'full' ? '24px' : variant === 'quadrant' ? '15px' : '20px'}; margin-top: ${variant === 'quadrant' ? '3px' : '7px'}; }
  .stat-label { font-weight: 700; }
  .airline-logo { width: ${logoSize}; height: ${logoSize}; border-radius: 8px; object-fit: contain; background: #fff; }
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
  <span class="instance">Refreshed at {{ 'now' | date: '%s' | plus: ${offset} | date: '%H:%M' }}</span>
</div>
`.trim()
}

function renderFlightCard(f: FlightDisplayData, variant: MarkupVariant, baseUrl: string): string {
  const logoUrl = `${baseUrl}/public/flightaware_logos/${encodeURIComponent(f.airlineIcao)}.png`
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

  const statsHtml = showStats
    ? `
    <div class="flight-stats">
      ${variant === 'half_horizontal' ? `<span class="stat-item flight-stat-aircraft">${escapeHtml(f.aircraftModel)}</span>` : ''}
      <span class="stat-item"><span class="stat-label">ALT:</span> <span class="stat-value">${escapeHtml(f.altitudeFt)}${f.altitudeFt !== '--' && f.altitudeFt !== 'Ground' ? ' ft' : ''}</span></span>
      <span class="stat-item"><span class="stat-label">SPD:</span> <span class="stat-value">${escapeHtml(f.speedMph)}${f.speedMph !== '--' ? ' mph' : ''}</span></span>
      <span class="stat-item"><span class="stat-label">HDG:</span> <span class="stat-value">${escapeHtml(f.heading)}</span></span>
      <span class="stat-item"><span class="stat-label">ETA:</span> <span class="stat-value">${escapeHtml(f.eta)}</span></span>
    </div>`
    : ''

  const routeBlock = showRoute ? routeHtml : ''
  const statsBlock = showStats ? statsHtml : ''
  const detailsContent = `${statsBlock}${routeBlock}`
  const detailsBlock = embedRouteInTop
    ? ''
    : variant === 'half_vertical'
      ? `<div class="flight-details">${detailsContent}</div>`
      : detailsContent

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

function renderEmptyMarkup(variant: MarkupVariant, offset: number): string {
  const textSize = variant === 'quadrant' ? '20px' : '28px'
  return `
<div class="view view--${variant}">
  <div class="layout">
    <div class="columns">
      <div class="column">
        <div class="markdown" style="text-align:center;">
          <div style="font-size: ${textSize}; font-weight: 600; padding: 40px 0;">
            Configure flights in settings
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="title_bar">
  <span class="title">Flight Tracker</span>
  <span class="instance">{{ 'now' | date: '%s' | plus: ${offset} | date: '%H:%M' }}</span>
</div>
`.trim()
}
