// src/integrations/wmata/wmataClient.ts
import type { RailPrediction, RailPredictionResponse, MetroIncident, MetroIncidentResponse } from '../../types/wmata/types.js'
import { logger } from '../../utils/logger.js'

export class WmataClient {
  private readonly apiKey: string

  private cachedIncidents: MetroIncident[] | null = null
  private cachedAtMs = 0
  private inFlight: Promise<MetroIncident[]> | null = null
  private readonly INCIDENTS_TTL_MS = 10 * 60 * 1000 // 10 minutes

  // todo - technically the trmnl (aero and wmata) are optional endpoints
  // don't hardcode a stop/exit
  constructor(opts: { apiKey: string }) {
    if (!opts.apiKey) {
      logger.error('Unable to start subspace-api - missing WMATA API KEY')
      throw new Error('WMATA apiKey is required')
    }

    this.apiKey = opts.apiKey
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      method: 'GET',
      headers: { api_key: this.apiKey },
    })

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
    const data = await this.getJson<RailPredictionResponse>(
      `https://api.wmata.com/StationPrediction.svc/json/GetPrediction/${joined}`
    )
    return data.Trains
  }

  async getIncidents(): Promise<MetroIncident[]> {
    const data = await this.getJson<MetroIncidentResponse>('https://api.wmata.com/Incidents.svc/json/Incidents')
    return data.Incidents
  }

  async getIncidentsCached(): Promise<MetroIncident[]> {
    const now = Date.now()
    if (this.cachedIncidents && now - this.cachedAtMs < this.INCIDENTS_TTL_MS) {
      logger.debug('[WMATA] Cache hit for incidents')
      return this.cachedIncidents
    }

    if (this.inFlight) return this.inFlight

    logger.debug('[WMATA] Cache miss for incidents — fetching')
    this.inFlight = (async () => {
      const fresh = await this.getIncidents()
      this.cachedIncidents = fresh
      this.cachedAtMs = Date.now()
      this.inFlight = null
      return fresh
    })().catch((err) => {
      this.inFlight = null
      if (this.cachedIncidents) {
        logger.warn('[WMATA] Fetch failed, returning stale cache:', String(err))
        return this.cachedIncidents
      }
      throw err
    })

    return this.inFlight
  }
}
