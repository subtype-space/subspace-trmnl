import type { AeroFlightContract, AeroFlightStatus } from '../../types/aerodatabox/types.js'
import { logger } from '../../utils/logger.js'
import type { Provider, CacheEntry } from '../../types/aerodatabox/types.js'


const PROVIDERS: Record<Provider, { baseUrl: string; headers: (key: string) => Record<string, string> }> = {
  apimarket: {
    baseUrl: 'https://prod.api.market/api/v1/aedbx/aerodatabox',
    headers: (key) => ({ 'x-api-market-key': key, Accept: 'application/json' }),
  },
  rapidapi: {
    baseUrl: 'https://aerodatabox.p.rapidapi.com',
    headers: (key) => ({ 'x-rapidapi-key': key, 'x-rapidapi-host': 'aerodatabox.p.rapidapi.com', Accept: 'application/json' }),
  },
}

export class AeroClient {
  private readonly provider: (typeof PROVIDERS)[Provider]
  private readonly apiKey: string

  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<AeroFlightContract | null>>()

  // 5 min under TRMNL's 1hr refresh so multi-device users share a single API call per cycle
  private readonly ACTIVE_TTL_MS = 55 * 60 * 1000
  // Settled flights keep the same flight number until next day's operation — 4hr cache is safe
  private readonly SETTLED_TTL_MS = 4 * 60 * 60 * 1000
  // if a flight number is not found, set the TTL to 55 minutes instead of 4 hours
  // don't want to cache for 4 hours for something that COULD change into something real
  private readonly NOT_FOUND_TTL_MS = 55 * 60 * 1000 

  // API queue system
  private readonly MIN_INTERVAL_MS = 1100
  private lastCallAt = 0
  private processing = false
  private readonly queue: Array<() => void> = []

  constructor(apiKey: string, provider: Provider = 'apimarket') {
    this.apiKey = apiKey
    this.provider = PROVIDERS[provider]
    logger.info(`[AERO] Using provider: ${provider}`)
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

  // flight API limits 1 req/s, at most 2 req/s
  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true
    while (this.queue.length > 0) {
      const wait = Math.max(0, this.lastCallAt + this.MIN_INTERVAL_MS - Date.now())
      if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait))
      const next = this.queue.shift()!
      this.lastCallAt = Date.now()
      await next()
    }
    this.processing = false
  }

  /**
   * Get the appropriate cache TTL based on the flight status so we encourage the usage of the cache
   * Active flights get a time to live of 55 minutes in the cache, while settled flights get a time to live of 4 hours
   * 
   * Caching null hits for a given flight number is also important to avoid repeated API calls for non-existent flights
   * According to google - this is called negative caching
   * 
   * @param status AeroFlightStatus or null, representing the status of the flight
   * @returns The time to live in milliseconds for the cache entry based on the flight status
   */
  private getTtl(status: AeroFlightStatus | null): number {
    switch (status) {
      case 'Arrived':
      case 'Canceled':
      case 'Diverted':
        return this.SETTLED_TTL_MS
      case null:
        return this.NOT_FOUND_TTL_MS
      default:
        return this.ACTIVE_TTL_MS
    }
  }

  /**
   * Flight lookup method using API
   * @param flightNumber The flight number to perform an API call for a search
   * @returns An AeroFlightContract object, an error if a search failed, or null if no flight was found
   * 
   * Note: This function is not cached, and will always perform an API call. Use getFlightByNumberCached() for caching.
   * 
   * @throws {Error} If the API call fails or returns an error response
   */
  async getFlightByNumber(flightNumber: string): Promise<AeroFlightContract | null> {
    const url = `${this.provider.baseUrl}/flights/number/${encodeURIComponent(flightNumber)}?withLocation=true`

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
   * Flight lookup method using API with caching. Wraps around getFlightByNumber() to provide caching and inflight request deduplication
   * @param flightNumber The flight number to perform an API search for
   * @returns An AeroFlightContract or null - null cases are caught by the flightMarkupController
   */
  async getFlightByNumberCached(flightNumber: string): Promise<AeroFlightContract | null> {
    logger.info(`[AERO] retrieving flight information for ${flightNumber}`)
    const now = Date.now()
    const cached = this.cache.get(flightNumber)
    if (cached && now - cached.at < this.getTtl(cached.status)) {
      logger.debug(`[AERO] Cache hit for ${flightNumber}`)
      return cached.data
    }

    const existing = this.inflight.get(flightNumber)
    if (existing) return existing

    logger.debug(`[AERO] Cache miss for ${flightNumber}`)
    const promise = (async () => {
      const data = await this.getFlightByNumber(flightNumber)
      this.cache.set(flightNumber, { data, at: Date.now(), status: data?.status ?? null })
      this.inflight.delete(flightNumber)
      return data
    })().catch((err) => {
      this.inflight.delete(flightNumber)
      // Return stale cache on error if available
      const stale = this.cache.get(flightNumber)
      if (stale) {
        logger.warn(`[AERO] Fetch failed for ${flightNumber}, returning stale cache: ${String(err)}`)
        return stale.data
      }
      throw err
    })

    this.inflight.set(flightNumber, promise)
    return promise
  }

  /**
   * API can return an array of multiple AeroFlightContracts for the same flight number
   * With different times, we filter out cargo flights, and choose the best flight based on the lastUpdated timestamp
   * 
   * This is used privately by getFlightByNumber() to pick the best flight from the API response and not used outside this class
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
