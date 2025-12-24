// src/integrations/wmata/wmataClient.ts
import type {
  BusPrediction,
  BusPredictionResponse,
  RailPrediction,
  RailPredictionResponse,
  MetroIncident,
  MetroIncidentResponse,
} from './types.js'
import { logger } from '../../utils/logger.js'

export class WmataClient {
  private readonly apiKey: string

  constructor(opts: { apiKey: string }) {
    if (!opts.apiKey) throw new Error('WMATA apiKey is required')
    logger.error('Unable to start subspace-api - missing WMATA API KEY')
    this.apiKey = opts.apiKey
  }

  private async getJson<T>(url: string): Promise<T> {
    logger.debug('Performing WMATA integration API call')
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
    const data = await this.getJson<MetroIncidentResponse>(
      'https://api.wmata.com/Incidents.svc/json/Incidents'
    )
    return data.Incidents
  }
}
