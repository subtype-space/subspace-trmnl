import type { AdsbResponse, AdsbAircraft, AdsbRoute } from '../../types/adsb/types.js'
import { logger } from '../../utils/logger.js'

// IATA airline code → ICAO airline code mapping
const IATA_TO_ICAO: Record<string, string> = {
  UA: 'UAL',
  AA: 'AAL',
  DL: 'DAL',
  WN: 'SWA',
  B6: 'JBU',
  AS: 'ASA',
  NK: 'NKS',
  F9: 'FFT',
  HA: 'HAL',
  G4: 'AAY',
  SY: 'SCX',
  BA: 'BAA',
  LH: 'DLH',
  AF: 'AFR',
  KL: 'KLM',
  EK: 'UAE',
  QR: 'QTR',
  SQ: 'SIA',
  CX: 'CPA',
  NH: 'ANA',
  JL: 'JAL',
  AC: 'ACA',
  WS: 'WJA',
  AM: 'AMX',
  KA: 'KAL',
  EY: 'ETD',
  TK: 'THY',
  CZ: 'CSN',
  QF: 'CFA'
}

// in case a user uses IATA convert to ICAO
export function toIcaoCallsign(iataFlight: string): string {
  const match = iataFlight.match(/^([A-Z]{2})(\d{1,4})$/)
  if (!match) return iataFlight
  const [, airline, number] = match
  const icao = IATA_TO_ICAO[airline]
  return icao ? `${icao}${number}` : iataFlight
}

export class AdsbClient {
  private readonly baseUrl = 'https://api.adsb.lol'

  private readonly liveCache = new Map<string, { data: AdsbAircraft | null; at: number }>()
  private readonly routeCache = new Map<string, { data: AdsbRoute | null; at: number }>()
  private readonly liveInflight = new Map<string, Promise<AdsbAircraft | null>>()
  private readonly routeInflight = new Map<string, Promise<AdsbRoute | null>>()

  private readonly LIVE_TTL_MS = 5 * 60 * 1000 // 5 minutes
  private readonly ROUTE_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

  async getByCallsign(callsign: string): Promise<AdsbAircraft | null> {
    const url = `${this.baseUrl}/v2/callsign/${encodeURIComponent(callsign)}`
    logger.debug(`[ADSB] GET ${url}`)

    const res = await fetch(url)
    if (!res.ok) {
      logger.warn(`[ADSB] callsign lookup failed: ${res.status} ${res.statusText}`)
      return null
    }

    const data = (await res.json()) as AdsbResponse
    if (!data.ac || data.ac.length === 0) return null

    return data.ac[0]
  }

  async getRoute(callsign: string): Promise<AdsbRoute | null> {
    const url = `${this.baseUrl}/api/0/routeset`
    logger.debug(`[ADSB] POST ${url} for ${callsign}`)

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planes: [{ callsign, lat: 0, lng: 0 }],
      }),
    })

    if (!res.ok) {
      logger.warn(`[ADSB] route lookup failed: ${res.status} ${res.statusText}`)
      return null
    }

    const data = await res.json()

    // routeset returns an array, each entry has _airports with dep/arr info
    const planes = Array.isArray(data) ? data : []
    if (planes.length === 0) return null

    const plane = planes[0]
    const airports = plane?._airports
    if (!airports) return null

    const depAirport = airports[0]
    const arrAirport = airports[1]
    const from = depAirport?.iata || depAirport?.icao || ''
    const to = arrAirport?.iata || arrAirport?.icao || ''

    if (!from && !to) return null
    return {
      from,
      to,
      fromLat: depAirport?.lat,
      fromLon: depAirport?.lon,
      toLat: arrAirport?.lat,
      toLon: arrAirport?.lon,
    }
  }

  async getByCallsignCached(callsign: string): Promise<AdsbAircraft | null> {
    const now = Date.now()
    const cached = this.liveCache.get(callsign)
    if (cached && now - cached.at < this.LIVE_TTL_MS) {
      logger.debug(`[ADSB] Live cache hit for ${callsign}`)
      return cached.data
    }

    const existing = this.liveInflight.get(callsign)
    if (existing) return existing

    logger.debug(`[ADSB] Live cache miss for ${callsign}`)
    const promise = (async () => {
      const data = await this.getByCallsign(callsign)
      this.liveCache.set(callsign, { data, at: Date.now() })
      this.liveInflight.delete(callsign)
      return data
    })().catch((err) => {
      this.liveInflight.delete(callsign)
      throw err
    })

    this.liveInflight.set(callsign, promise)
    return promise
  }

  async getRouteCached(callsign: string): Promise<AdsbRoute | null> {
    const now = Date.now()
    const cached = this.routeCache.get(callsign)
    if (cached && now - cached.at < this.ROUTE_TTL_MS) {
      logger.debug(`[ADSB] Route cache hit for ${callsign}`)
      return cached.data
    }

    const existing = this.routeInflight.get(callsign)
    if (existing) return existing

    logger.debug(`[ADSB] Route cache miss for ${callsign}`)
    const promise = (async () => {
      const data = await this.getRoute(callsign)
      this.routeCache.set(callsign, { data, at: Date.now() })
      this.routeInflight.delete(callsign)
      return data
    })().catch((err) => {
      this.routeInflight.delete(callsign)
      throw err
    })

    this.routeInflight.set(callsign, promise)
    return promise
  }
}
