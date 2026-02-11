import type { AeroFlightContract, AeroFlightStatus } from '../../types/aerodatabox/types.js'
import { logger } from '../../utils/logger.js'

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
    // Prefer the operating flight over codeshares
    let candidates = flights.filter((f) => f.codeshareStatus === 'IsOperator' && !f.isCargo)

    // If no operator flights, fall back to codeshares (user may have entered a codeshare number)
    if (candidates.length === 0) {
      candidates = flights.filter((f) => !f.isCargo)
    }

    if (candidates.length === 0) return null
    if (candidates.length === 1) return candidates[0]

    // Multiple results — pick the one nearest to now
    const now = Date.now()
    return candidates.reduce((best, flight) => {
      const bestTime = this.getFlightTimestamp(best)
      const flightTime = this.getFlightTimestamp(flight)
      return Math.abs(flightTime - now) < Math.abs(bestTime - now) ? flight : best
    })
  }

  private getFlightTimestamp(flight: AeroFlightContract): number {
    const timeStr =
      flight.departure.runwayTime?.utc ?? flight.departure.revisedTime?.utc ?? flight.departure.scheduledTime?.utc
    if (timeStr) return new Date(timeStr).getTime()
    return 0
  }
}
