// src/integrations/wmata/wmataClient.ts
import type { RailPrediction, RailPredictionResponse, MetroIncident, MetroIncidentResponse } from '../../types/wmata/types.js'
import { logger } from '../../utils/logger.js'

type CacheEntry<T> = { at: number; data: T }

export class WmataClient {
  private readonly apiKey: string

  // Incidents cache
  private cachedIncidents: MetroIncident[] | null = null
  private cachedAtMs = 0
  private inFlight: Promise<MetroIncident[]> | null = null
  private readonly INCIDENTS_TTL_MS = 10 * 60 * 1000 // 10 minutes

  // Station predictions cache
  private readonly stationCache = new Map<string, CacheEntry<RailPrediction[]>>()
  private readonly stationInFlight = new Map<string, Promise<RailPrediction[]>>()
  private readonly STATION_TTL_MS = 60 * 1000 // 1 minute

  constructor(opts: { apiKey: string }) {
    if (!opts.apiKey) {
      logger.error('Unable to start subspace-trmnl - missing WMATA API KEY')
      throw new Error('WMATA apiKey is required')
    }

    this.apiKey = opts.apiKey
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      method: 'GET',
      headers: { api_key: this.apiKey },
    })
    logger.debug(`[MTRO] Performing call for ${url}`)
    if (!res.ok) {
      logger.warn(`Unable to retrieve WMATA response. Got ${res.status} - ${res.statusText}`)
      throw new Error(`WMATA API Error: ${res.status} ${res.statusText}`)
    }

    return (await res.json()) as T
  }

  async getRailPredictions(stationCodes: string[]): Promise<RailPrediction[]> {
    if (stationCodes.length === 0) return []
    // WMATA expects comma-separated station codes in the path
    const joined = stationCodes.map(encodeURIComponent).join(',')
    logger.info(`[MTRO] Retrieving predictions for ${joined}`)
    const data = await this.getJson<RailPredictionResponse>(
      `https://api.wmata.com/StationPrediction.svc/json/GetPrediction/${joined}`
    )
    return data.Trains
  }

  // Basically, we create a cache per station (LocationCode) with a TTL of 1 minute based on station
  // Here we can leverage the ability to cache based on other user requests
  async getRailPredictionsCached(codes: string[]): Promise<{ trains: RailPrediction[]; cached: boolean }> {
    // 'All' bypasses per-station cache — too broad to cache meaningfully
    if (codes.length === 1 && codes[0] === 'All') {
      const trains = await this.getRailPredictions(['All'])
      return { trains, cached: false }
    }

    const merged: RailPrediction[] = []
    const missing: string[] = []

    for (const code of codes) {
      const hit = this.stationCache.get(code)
      if (hit && Date.now() - hit.at < this.STATION_TTL_MS) {
        merged.push(...hit.data)
      } else {
        missing.push(code)
      }
    }

    if (missing.length) {
      const trulyMissing = missing.filter((code) => !this.stationInFlight.has(code))

      if (trulyMissing.length) {
        const batchPromise = this.fetchMissingStations(trulyMissing)
        for (const code of trulyMissing) {
          const p = batchPromise.then((getSlice) => getSlice(code)).finally(() => this.stationInFlight.delete(code))
          this.stationInFlight.set(code, p)
        }
      }

      const fetchedSlices = await Promise.all(missing.map((code) => this.stationInFlight.get(code)!))
      for (const slice of fetchedSlices) merged.push(...slice)
    }

    return { trains: merged, cached: missing.length === 0 }
  }

  // Hydrate cache with any missing stations
  private async fetchMissingStations(missing: string[]): Promise<(code: string) => RailPrediction[]> {
    logger.debug(`[MTRO] Fetching missing stations: [${missing.join(',')}]`)
    const trains = await this.getRailPredictions(missing)
    const grouped = new Map<string, RailPrediction[]>()
    for (const t of trains ?? []) {
      const code = (t.LocationCode ?? '').toUpperCase()
      if (!code) continue
      const arr = grouped.get(code)
      if (arr) arr.push(t)
      else grouped.set(code, [t])
    }
    const now = Date.now()
    for (const code of missing) {
      this.stationCache.set(code, { at: now, data: grouped.get(code) ?? [] })
    }
    return (code: string) => this.stationCache.get(code)?.data ?? []
  }

  ///////////////////////

  async getIncidents(): Promise<MetroIncident[]> {
    logger.info('[MTRO] Retrieving WMATA incidents')
    const data = await this.getJson<MetroIncidentResponse>('https://api.wmata.com/Incidents.svc/json/Incidents')
    return data.Incidents
  }

  async getIncidentsCached(): Promise<MetroIncident[]> {
    const now = Date.now()
    if (this.cachedIncidents && now - this.cachedAtMs < this.INCIDENTS_TTL_MS) {
      logger.debug('[MTRO] Cache hit for incidents')
      return this.cachedIncidents
    }

    if (this.inFlight) return this.inFlight

    logger.debug('[MTRO] Cache miss for incidents — fetching')
    this.inFlight = (async () => {
      const fresh = await this.getIncidents()
      this.cachedIncidents = fresh
      this.cachedAtMs = Date.now()
      this.inFlight = null
      return fresh
    })().catch((err) => {
      this.inFlight = null
      if (this.cachedIncidents) {
        logger.warn('[MTRO] Fetch failed, returning stale cache:', String(err))
        return this.cachedIncidents
      }
      throw err
    })

    return this.inFlight
  }
}
