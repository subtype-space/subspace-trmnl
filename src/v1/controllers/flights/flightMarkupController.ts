import { RequestHandler } from 'express'
import { logger } from '../../../utils/logger.js'
import { getFlightSettingsByUuid } from '../../../utils/dbConnector.js'
import { AdsbClient } from '../../../integrations/adsb/adsbClient.js'
import { toIcaoCallsign } from '../../../integrations/adsb/adsbClient.js'
import type { AdsbAircraft, AdsbRoute } from '../../../types/adsb/types.js'
import type { FlightDisplayData } from '../../../types/trmnl/flightTypes.js'
import type { TrmnlMeta } from '../../../types/trmnl/types.js'

// Caches
const liveCache = new Map<string, { data: AdsbAircraft | null; at: number }>()
const routeCache = new Map<string, { data: AdsbRoute | null; at: number }>()
const liveInflight = new Map<string, Promise<AdsbAircraft | null>>()
const routeInflight = new Map<string, Promise<AdsbRoute | null>>()

const LIVE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const ROUTE_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

const client = new AdsbClient()

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

const AIRLINE_NAMES: Record<string, string> = {
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
}

type MarkupVariant = 'full' | 'half_horizontal' | 'half_vertical' | 'quadrant'

export const flightMarkupController: RequestHandler = async (req, res) => {
  const tokenHash = (req as any).trmnl?.tokenHash as string | undefined
  const userUuid = req.body?.user_uuid as string | undefined
  const trmnlRaw = req.body?.trmnl

  logger.debug('[FLIGHTS] Incoming markup request: ', { tokenHash, userUuid, trmnlRaw })
  if (!tokenHash) {
    res.status(500).json({ error: 'Bad Request', message: 'missing trmnl auth context' })
    return
  }

  if (typeof userUuid !== 'string' || !userUuid) {
    logger.debug('[FLIGHTS] UUID was not provided. Will not render.')
    res.status(400).json({ error: 'Bad Request', message: 'missing user_uuid' })
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
      logger.warn('[FLIGHTS] Failed to parse trmnl metadata JSON')
    }
  }

  const utcOffset = Number(meta?.user?.utc_offset ?? 0)

  const settings = await getFlightSettingsByUuid(userUuid)
  const flightNumbers = (settings?.flight_numbers ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 4)

  if (flightNumbers.length === 0) {
    const emptyModel: FlightDisplayData[] = []
    res.json({
      markup: renderMarkup(emptyModel, 'full', utcOffset),
      markup_half_horizontal: renderMarkup(emptyModel, 'half_horizontal', utcOffset),
      markup_half_vertical: renderMarkup(emptyModel, 'half_vertical', utcOffset),
      markup_quadrant: renderMarkup(emptyModel, 'quadrant', utcOffset),
      shared: '',
    })
    return
  }

  const flights: FlightDisplayData[] = []

  for (const iataFlight of flightNumbers) {
    const icaoCallsign = toIcaoCallsign(iataFlight)
    const airlineIata = iataFlight.replace(/\d+$/, '')

    try {
      // Fetch live data and route in parallel
      const [aircraft, route] = await Promise.all([
        fetchLiveCached(icaoCallsign),
        fetchRouteCached(icaoCallsign).catch((e) => {
          logger.warn(`[FLIGHTS] Route fetch failed for ${icaoCallsign}`, String(e))
          return null
        }),
      ])

      if (!aircraft) {
        flights.push({
          flightIata: iataFlight,
          airlineIata,
          depAirport: route?.from ?? '',
          arrAirport: route?.to ?? '',
          status: 'Not currently tracked',
          altitudeFt: '--',
          speedMph: '--',
          aircraftModel: '--',
          aircraftIcao: '',
          progressPct: null,
        })
        continue
      }

      const altBaro = aircraft.alt_baro
      const isOnGround = altBaro === 'ground' || altBaro === 0
      const altStr = isOnGround ? 'Ground' : typeof altBaro === 'number' ? altBaro.toLocaleString() : '--'

      const speedMph = typeof aircraft.gs === 'number' ? Math.round(aircraft.gs * 1.15078).toLocaleString() : '--'

      const aircraftIcao = aircraft.t ?? ''
      const aircraftModel = AIRCRAFT_NAMES[aircraftIcao] ?? aircraftIcao

      const status = deriveStatus(altBaro, aircraft.baro_rate)

      const progressPct = calcProgress(
        aircraft.lat,
        aircraft.lon,
        route?.fromLat,
        route?.fromLon,
        route?.toLat,
        route?.toLon,
      )

      flights.push({
        flightIata: iataFlight,
        airlineIata,
        depAirport: route?.from ?? '',
        arrAirport: route?.to ?? '',
        status,
        altitudeFt: altStr,
        speedMph,
        aircraftModel,
        aircraftIcao,
        progressPct,
      })
    } catch (e) {
      logger.warn(`[FLIGHTS] Failed to fetch data for ${iataFlight}`, String(e))
      flights.push({
        flightIata: iataFlight,
        airlineIata,
        depAirport: '',
        arrAirport: '',
        status: 'Data unavailable',
        altitudeFt: '--',
        speedMph: '--',
        aircraftModel: '--',
        aircraftIcao: '',
        progressPct: null,
      })
    }
  }

  res.json({
    markup: renderMarkup(flights, 'full', utcOffset),
    markup_half_horizontal: renderMarkup(flights, 'half_horizontal', utcOffset),
    markup_half_vertical: renderMarkup(flights, 'half_vertical', utcOffset),
    markup_quadrant: renderMarkup(flights, 'quadrant', utcOffset),
    shared: '',
  })
}

function deriveStatus(altBaro: number | 'ground' | undefined, baroRate: number | undefined): string {
  if (altBaro === 'ground' || altBaro === 0) return 'On Ground'
  if (typeof altBaro !== 'number') return 'Unknown'
  if (typeof baroRate === 'number') {
    if (baroRate > 200) return 'Climbing'
    if (baroRate < -200) return 'Descending'
  }
  return 'Airborne'
}

function renderMarkup(flights: FlightDisplayData[], variant: MarkupVariant, utcOffset: number): string {
  const offset = Number(utcOffset) || 0
  const logoSize =
    variant === 'full'
      ? '240px'
      : variant === 'half_vertical'
        ? '180px'
        : variant === 'half_horizontal'
          ? '170px'
          : '96px'

  if (flights.length === 0) {
    return renderEmptyMarkup(variant, offset)
  }

  // Full/half_vertical: show up to 2 flights with detail
  // Half_horizontal/quadrant: show 1 flight
  const maxFlights = variant === 'full' || variant === 'half_vertical' ? 2 : 1
  const visible = flights.slice(0, maxFlights)

  const flightCards = visible.map((f) => renderFlightCard(f, variant)).join(getDivider(variant))

  return `
<style>
  .flight-card { margin: 0; padding: ${variant === 'full' ? '12px 72px' : variant === 'half_vertical' ? '10px 36px' : variant === 'half_horizontal' ? '10px 36px' : '6px 20px'}; font-family: 'IBM Plex Sans', 'SF Pro Text', 'Segoe UI', sans-serif; }
  .flight-top { display: flex; align-items: flex-start; gap: ${variant === 'quadrant' ? '12px' : '20px'}; width: 100%; }
  .flight-meta { display: flex; flex-direction: column; gap: ${variant === 'quadrant' ? '3px' : '5px'}; align-items: flex-end; text-align: right; margin-left: auto; }
  .airline-name { font-size: ${variant === 'quadrant' ? '18px' : variant === 'full' ? '30px' : '24px'}; font-weight: 700; letter-spacing: 0.2px; }
  .flight-number { font-size: ${variant === 'quadrant' ? '26px' : variant === 'full' ? '44px' : '34px'}; font-weight: 800; }
  .flight-status { font-size: ${variant === 'quadrant' ? '16px' : variant === 'full' ? '24px' : '20px'}; font-weight: 600; }
  .flight-route { display: flex; align-items: center; gap: 12px; width: 100%; font-size: ${variant === 'quadrant' ? '20px' : '28px'}; font-weight: 700; margin: ${variant === 'quadrant' ? '8px 0 5px' : '14px 0 8px'}; }
  .route-line { flex: 1; height: 2px; background: black; position: relative; }
  .route-plane { font-size: ${variant === 'quadrant' ? '28px' : variant === 'full' ? '48px' : '36px'}; line-height: 1; }
  .flight-stats { display: flex; gap: ${variant === 'quadrant' ? '14px' : '26px'}; font-size: ${variant === 'full' ? '24px' : variant === 'quadrant' ? '15px' : '20px'}; margin-top: ${variant === 'quadrant' ? '3px' : '7px'}; }
  .stat-label { font-weight: 700; }
  .airline-logo { width: ${logoSize}; height: ${logoSize}; border-radius: 8px; object-fit: contain; background: #fff; }
  .flight-divider { border: none; border-top: 1px solid #ccc; margin: ${variant === 'quadrant' ? '6px 0' : '12px 0'}; }
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

function renderFlightCard(f: FlightDisplayData, variant: MarkupVariant): string {
  const logoUrl = `https://pics.avs.io/200/200/${escapeHtml(f.airlineIata)}.png`
  const showStats = variant !== 'quadrant'
  const showRoute = true
  const airlineCode = f.airlineIata || ''
  const airlineName = AIRLINE_NAMES[airlineCode] ?? (airlineCode || f.flightIata)
  const flightCode = airlineCode && f.flightIata.startsWith(airlineCode)
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
      <span><span class="stat-label">ALT:</span> ${escapeHtml(f.altitudeFt)}${f.altitudeFt !== '--' && f.altitudeFt !== 'Ground' ? ' ft' : ''}</span>
      <span><span class="stat-label">SPD:</span> ${escapeHtml(f.speedMph)}${f.speedMph !== '--' ? ' mph' : ''}</span>
      <span>${escapeHtml(f.aircraftModel)}</span>
    </div>`
    : ''

  return `
  <div class="flight-card">
    <div class="flight-top">
      <img class="airline-logo" src="${logoUrl}" />
      <div class="flight-meta">
        <span class="airline-name">${escapeHtml(airlineName)}</span>
        <span class="flight-number">${escapeHtml(flightCode)}</span>
        <span class="flight-status">${escapeHtml(f.status)}</span>
      </div>
    </div>
    ${statsHtml}
    ${routeHtml}
  </div>`
}

function getDivider(variant: MarkupVariant): string {
  return variant === 'quadrant' ? '<hr class="flight-divider" />' : '<hr class="flight-divider" />'
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

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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
function calcProgress(
  aircraftLat: number | undefined,
  aircraftLon: number | undefined,
  fromLat: number | undefined,
  fromLon: number | undefined,
  toLat: number | undefined,
  toLon: number | undefined,
): number | null {
  if (aircraftLat == null || aircraftLon == null) return null
  if (fromLat == null || fromLon == null || toLat == null || toLon == null) return null

  const totalDist = haversineKm(fromLat, fromLon, toLat, toLon)
  if (totalDist < 1) return null // airports too close, avoid division issues

  const flownDist = haversineKm(fromLat, fromLon, aircraftLat, aircraftLon)
  const pct = Math.round((flownDist / totalDist) * 100)
  return Math.max(0, Math.min(100, pct))
}

// Cached fetch for live aircraft data
async function fetchLiveCached(callsign: string): Promise<AdsbAircraft | null> {
  const now = Date.now()
  const cached = liveCache.get(callsign)
  if (cached && now - cached.at < LIVE_TTL_MS) {
    logger.debug(`[FLIGHTS] Live cache hit for ${callsign}`)
    return cached.data
  }

  const existing = liveInflight.get(callsign)
  if (existing) return existing

  logger.debug(`[FLIGHTS] Live cache miss for ${callsign}`)
  const promise = (async () => {
    const data = await client.getByCallsign(callsign)
    liveCache.set(callsign, { data, at: Date.now() })
    liveInflight.delete(callsign)
    return data
  })().catch((err) => {
    liveInflight.delete(callsign)
    throw err
  })

  liveInflight.set(callsign, promise)
  return promise
}

// Cached fetch for route data
async function fetchRouteCached(callsign: string): Promise<AdsbRoute | null> {
  const now = Date.now()
  const cached = routeCache.get(callsign)
  if (cached && now - cached.at < ROUTE_TTL_MS) {
    logger.debug(`[FLIGHTS] Route cache hit for ${callsign}`)
    return cached.data
  }

  const existing = routeInflight.get(callsign)
  if (existing) return existing

  logger.debug(`[FLIGHTS] Route cache miss for ${callsign}`)
  const promise = (async () => {
    const data = await client.getRoute(callsign)
    routeCache.set(callsign, { data, at: Date.now() })
    routeInflight.delete(callsign)
    return data
  })().catch((err) => {
    routeInflight.delete(callsign)
    throw err
  })

  routeInflight.set(callsign, promise)
  return promise
}
