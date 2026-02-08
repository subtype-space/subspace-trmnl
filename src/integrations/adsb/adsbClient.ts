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

    const from = airports[0]?.iata || airports[0]?.icao || ''
    const to = airports[1]?.iata || airports[1]?.icao || ''

    if (!from && !to) return null
    return { from, to }
  }
}
