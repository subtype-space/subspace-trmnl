import type { AdsbResponse, AdsbAircraft } from '../../types/adsb/types.js'
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

export class AdsbClient {
  private readonly baseUrl = 'https://api.adsb.lol'

  private readonly liveCache = new Map<string, { data: AdsbAircraft | null; at: number }>()
  private readonly liveInflight = new Map<string, Promise<AdsbAircraft | null>>()

  private readonly LIVE_TTL_MS = 5 * 60 * 1000 // 5 minutes

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
}
