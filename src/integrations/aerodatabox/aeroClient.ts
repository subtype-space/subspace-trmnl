import type { AeroFlightContract, AeroFlightStatus } from '../../types/aerodatabox/types.js'
import { logger } from '../../utils/logger.js'

// IATA airline code → ICAO airline code mapping
const IATA_TO_ICAO: Record<string, string> = {
  UA: 'UAL',
  GB: 'ABX',
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
  QF: 'CFA',
}

// Convert IATA flight number to ICAO callsign (e.g. UA804 → UAL804)
export function toIcaoCallsign(iataFlight: string): string {
  const match = iataFlight.match(/^([A-Z]{2})(\d{1,4})$/)
  if (!match) return iataFlight
  const [, airline, number] = match
  const icao = IATA_TO_ICAO[airline]
  return icao ? `${icao}${number}` : iataFlight
}

type CacheEntry = {
  data: AeroFlightContract | null
  at: number
  status: AeroFlightStatus | null
}

export class AeroClient {
  private readonly baseUrl = 'https://prod.api.market/api/v1/aedbx/aerodatabox'
  private readonly apiKey: string

  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<AeroFlightContract | null>>()

  // Status-aware cache TTLs
  private readonly ACTIVE_TTL_MS = 5 * 60 * 1000 // 5 min — EnRoute, Departed, Approaching
  private readonly PREFLIGHT_TTL_MS = 15 * 60 * 1000 // 15 min — Expected, CheckIn, Boarding, etc.
  private readonly SETTLED_TTL_MS = 30 * 60 * 1000 // 30 min — Arrived, Canceled, Diverted

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private getTtl(status: AeroFlightStatus | null): number {
    switch (status) {
      case 'EnRoute':
      case 'Departed':
      case 'Approaching':
        return this.ACTIVE_TTL_MS
      case 'Arrived':
      case 'Canceled':
      case 'CanceledUncertain':
      case 'Diverted':
        return this.SETTLED_TTL_MS
      case 'Expected':
      case 'CheckIn':
      case 'Boarding':
      case 'GateClosed':
      case 'Delayed':
        return this.PREFLIGHT_TTL_MS
      default:
        return this.ACTIVE_TTL_MS
    }
  }

  async getFlightByCallsign(callsign: string): Promise<AeroFlightContract | null> {
    const url = `${this.baseUrl}/flights/CallSign/${encodeURIComponent(callsign)}?withLocation=true`
    logger.debug(`[AERO] GET ${url}`)

    const res = await fetch(url, {
      headers: {
        'x-api-market-key': this.apiKey,
        Accept: 'application/json',
      },
    })

    if (res.status === 204) {
      logger.debug(`[AERO] No flights found for callsign ${callsign}`)
      return null
    }

    if (!res.ok) {
      logger.warn(`[AERO] Flight lookup failed: ${res.status} ${res.statusText}`)
      return null
    }

    const flights = (await res.json()) as AeroFlightContract[]
    if (!Array.isArray(flights) || flights.length === 0) return null

    return this.pickBestFlight(flights)
  }

  async getFlightByCallsignCached(callsign: string): Promise<AeroFlightContract | null> {
    const now = Date.now()
    const cached = this.cache.get(callsign)
    if (cached && now - cached.at < this.getTtl(cached.status)) {
      logger.debug(`[AERO] Cache hit for ${callsign}`)
      return cached.data
    }

    const existing = this.inflight.get(callsign)
    if (existing) return existing

    logger.debug(`[AERO] Cache miss for ${callsign}`)
    const promise = (async () => {
      const data = await this.getFlightByCallsign(callsign)
      this.cache.set(callsign, { data, at: Date.now(), status: data?.status ?? null })
      this.inflight.delete(callsign)
      return data
    })().catch((err) => {
      this.inflight.delete(callsign)
      // Return stale cache on error if available
      const stale = this.cache.get(callsign)
      if (stale) {
        logger.warn(`[AERO] Fetch failed for ${callsign}, returning stale cache: ${String(err)}`)
        return stale.data
      }
      throw err
    })

    this.inflight.set(callsign, promise)
    return promise
  }

  private pickBestFlight(flights: AeroFlightContract[]): AeroFlightContract | null {
    const candidates = flights.filter((f) => !f.isCargo)
    if (candidates.length === 0) return null
    if (candidates.length === 1) return candidates[0]

    // Pick the most recently updated entry — the API may return multiple
    // entries for the same physical flight (e.g. operator + codeshare) with
    // different freshness levels
    return candidates.reduce((best, flight) => {
      const bestTime = this.getLastUpdated(best)
      const flightTime = this.getLastUpdated(flight)
      return flightTime > bestTime ? flight : best
    })
  }

  private getLastUpdated(flight: AeroFlightContract): number {
    if (flight.lastUpdatedUtc) return new Date(flight.lastUpdatedUtc).getTime()
    return 0
  }
}
