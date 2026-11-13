import type { AeroFlightContract } from '../../types/aerodatabox/types.js'
import { logger } from '../../utils/logger.js'
import { getDepartureUtcMs } from './statusMapper.js'
import type { Provider, CacheEntry, CacheTtls, SearchBy } from '../../types/aerodatabox/types.js'


const PROVIDERS: Record<Provider, { baseUrl: string; minIntervalMs: number; headers: (key: string) => Record<string, string> }> = {
  apimarket: {
    baseUrl: 'https://prod.api.market/api/v1/aedbx/aerodatabox',
    minIntervalMs: 550,
    headers: (key) => ({ 'x-api-market-key': key, Accept: 'application/json' }),
  },
  rapidapi: {
    baseUrl: 'https://aerodatabox.p.rapidapi.com',
    minIntervalMs: 550,
    headers: (key) => ({ 'x-rapidapi-key': key, 'x-rapidapi-host': 'aerodatabox.p.rapidapi.com', Accept: 'application/json' }),
  },
  direct: {
    baseUrl: 'https://api.aerodatabox.com',
    minIntervalMs: 220,
    headers: (key) => ({ 'X-Api-Key': key, Accept: 'application/json' }),
  },
}

export class AeroClient {
  private readonly provider: (typeof PROVIDERS)[Provider]
  private readonly apiKey: string

  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<AeroFlightContract | null>>()

  private readonly ttl: CacheTtls

  // API queue system
  private lastCallAt = 0
  private processing = false
  private readonly queue: Array<() => void> = []

  constructor(apiKey: string, provider: Provider, ttl: CacheTtls) {
    this.apiKey = apiKey
    this.provider = PROVIDERS[provider]
    this.ttl = ttl
    logger.info(`[AERO] Using provider: ${provider}`)
    logger.info(
      `[AERO] Cache TTLs (min): active=${ttl.activeMs / 60000} settled=${ttl.settledMs / 60000} notFound=${ttl.notFoundMs / 60000} nearDeparture=${ttl.nearDepartureMs / 60000} nearDepartureWindow=${ttl.nearDepartureWindowMs / 60000}`,
    )
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn())
        } catch (e) {
          reject(e)
        }
      })
      if (this.queue.length > 1) logger.info(`[AERO] Queued request (depth: ${this.queue.length})`)
      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true
    while (this.queue.length > 0) {
      const wait = Math.max(0, this.lastCallAt + this.provider.minIntervalMs - Date.now())
      if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait))
      const next = this.queue.shift()!
      this.lastCallAt = Date.now()
      await next()
    }
    this.processing = false
  }

  /**
   * Get the appropriate cache TTL based on the flight status so we encourage the usage of the cache
   * Active flights get a time to live of 30 minutes in the cache, while settled flights get a time to live of 4 hours
   * Flights departing within 2 hours (no wheels-up yet) get 15 minutes so check-in/gate/delay updates show up quickly
   * 
   * Caching null hits for a given flight number is also important to avoid repeated API calls for non-existent flights
   * According to google - this is called negative caching
   * 
   * @param data The cached AeroFlightContract, or null if the flight was not found
   * @returns The time to live in milliseconds for the cache entry based on the flight status
   */
  private getTtl(data: AeroFlightContract | null): number {
    const status = data?.status ?? null
    const departureMs = data ? getDepartureUtcMs(data) : null
    if (departureMs != null && !data?.departure.runwayTime) {
      const untilDeparture = departureMs - Date.now()
      if (untilDeparture > 0 && untilDeparture < this.ttl.nearDepartureWindowMs) return this.ttl.nearDepartureMs
    }
    switch (status) {
      case 'Arrived':
      case 'Canceled':
      case 'Diverted':
        return this.ttl.settledMs
      case null:
        return this.ttl.notFoundMs
      default:
        return this.ttl.activeMs
    }
  }

  /**
   * Flight lookup method using API
   * @param searchBy 'number' for a flight number, 'reg' for a tail number
   * @param flightNumber The flight or tail number to perform an API call for a search
   * @returns An AeroFlightContract object, an error if a search failed, or null if no flight was found
   * 
   * Note: This function is not cached, and will always perform an API call. Use getFlightCached() for caching.
   * 
   * @throws {Error} If the API call fails or returns an error response
   */
  async getFlight(searchBy: SearchBy, flightNumber: string): Promise<AeroFlightContract | null> {
    const url = `${this.provider.baseUrl}/flights/${searchBy}/${encodeURIComponent(flightNumber)}?withLocation=true`

    return this.enqueue(async () => {
      logger.debug(`[AERO] GET ${url}`)

      let res: Response
      try {
        res = await fetch(url, {
          headers: this.provider.headers(this.apiKey),
          signal: AbortSignal.timeout(5000),
        })
      } catch (err) {
        logger.warn(`[AERO] Flight lookup failed for ${flightNumber}: ${String(err)}`)
        throw err
      }

      if (res.status === 204) {
        logger.debug(`[AERO] No flights found for ${flightNumber}`)
        return null
      }

      if (!res.ok) {
        logger.warn(`[AERO] Flight lookup failed: ${res.status} ${res.statusText}`)
        throw new Error(`Flight lookup failed: ${res.status} ${res.statusText}`)
      }

      const flights = (await res.json()) as AeroFlightContract[]
      if (!Array.isArray(flights) || flights.length === 0) return null

      const best = this.pickBestFlight(flights)
      // Trying to debug code-share flight numbers since AeroDataBox isn't returning
      // Determining percentage of userbase that is seeing this error
      if (best?.status === 'CanceledUncertain') {
        logger.info(`[AERO] Possible codeShare flight. CanceledUncertain for ${flightNumber} (lastUpdated: ${best.lastUpdatedUtc ?? 'unknown'})`)
      }
      return best
    })
  }

  /**
   * Flight lookup method using API with caching. Wraps around getFlight() to provide caching and inflight request deduplication
   * @param searchBy 'number' for a flight number, 'reg' for a tail number
   * @param flightNumber The flight or tail number to perform an API search for
   * @returns An AeroFlightContract or null - null cases are caught by the flightMarkupController
   */
  async getFlightCached(searchBy: SearchBy, flightNumber: string): Promise<AeroFlightContract | null> {
    logger.info(`[AERO] retrieving flight information for ${searchBy} ${flightNumber}`)
    const key = `${searchBy}:${flightNumber}`
    const now = Date.now()
    const cached = this.cache.get(key)
    if (cached && now - cached.at < this.getTtl(cached.data)) {
      logger.debug(`[AERO] Cache hit for ${flightNumber}`)
      return cached.data
    }

    const existing = this.inflight.get(key)
    if (existing) return existing

    logger.debug(`[AERO] Cache miss for ${flightNumber}`)
    const promise = (async () => {
      const data = await this.getFlight(searchBy, flightNumber)
      this.cache.set(key, { data, at: Date.now(), status: data?.status ?? null })
      this.inflight.delete(key)
      return data
    })().catch((err) => {
      this.inflight.delete(key)
      // Return stale cache on error if available
      const stale = this.cache.get(key)
      if (stale) {
        logger.warn(`[AERO] Fetch failed for ${flightNumber}, returning stale cache: ${String(err)}`)
        return stale.data
      }
      throw err
    })

    this.inflight.set(key, promise)
    return promise
  }

  /**
   * API can return an array of multiple AeroFlightContracts for the same flight number
   * With different times, we filter out cargo flights, and choose the best flight based on the lastUpdated timestamp
   * 
   * This is used privately by getFlight() to pick the best flight from the API response and not used outside this class
   * 
   * @param flights An array of AeroFlightContract objects returned from the API for the same flight number
   * @returns The best flight AeroFlightContract object, or null if no suitable flight was found
   */
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
