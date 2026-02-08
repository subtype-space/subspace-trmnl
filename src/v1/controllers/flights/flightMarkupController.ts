import { RequestHandler } from 'express'
import { logger } from '../../../utils/logger.js'
import { getFlightSettingsByUuid } from '../../../utils/dbConnector.js'
import { AdsbClient, toIcaoCallsign } from '../../../integrations/adsb/adsbClient.js'
import {
  lookupAircraftName,
  deriveStatus,
  formatHeading,
  calcProgress,
  calcEta,
  renderMarkup,
} from '../../../integrations/adsb/formatters.js'
import type { FlightDisplayData } from '../../../types/trmnl/flightTypes.js'
import type { TrmnlMeta } from '../../../types/trmnl/types.js'

const client = new AdsbClient()
const rotationIndex = new Map<string, number>()

function pickFlight(userUuid: string, flights: FlightDisplayData[]): FlightDisplayData {
  const prev = rotationIndex.get(userUuid) ?? -1
  const next = (prev + 1) % flights.length
  rotationIndex.set(userUuid, next)
  return flights[next]
}

export const flightMarkupController: RequestHandler = async (req, res) => {
  const tokenHash = (req as any).trmnl?.tokenHash as string | undefined
  const userUuid = req.body?.user_uuid as string | undefined
  const trmnlRaw = req.body?.trmnl

  logger.debug('[FLGHT] Incoming markup request: ', { tokenHash, userUuid, trmnlRaw })
  if (!tokenHash) {
    res.status(500).json({ error: 'Bad Request', message: 'missing trmnl auth context' })
    return
  }

  if (typeof userUuid !== 'string' || !userUuid) {
    logger.debug('[FLGHT] UUID was not provided. Will not render.')
    res.status(400).json({ error: 'Bad Request', message: 'missing user_uuid' })
    return
  }

  // parse TRMNL meta (optional)
  let meta: TrmnlMeta | null = null
  if (trmnlRaw && typeof trmnlRaw === 'object') {
    meta = trmnlRaw as TrmnlMeta
  } else if (typeof trmnlRaw === 'string' && trmnlRaw.trim()) {
    try {
      meta = JSON.parse(trmnlRaw)
    } catch {
      logger.warn('[FLIGHTS] Failed to parse trmnl metadata JSON')
    }
  }

  const utcOffset = Number(meta?.user?.utc_offset ?? 0)

  const settings = await getFlightSettingsByUuid(userUuid)
  const flightNumbers = (settings?.flight_numbers ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 4)

  if (flightNumbers.length === 0) {
    const emptyModel: FlightDisplayData[] = []
    res.json({
      markup: renderMarkup(emptyModel, 'full', utcOffset),
      markup_half_horizontal: renderMarkup(emptyModel, 'half_horizontal', utcOffset),
      markup_half_vertical: renderMarkup(emptyModel, 'half_vertical', utcOffset),
      markup_quadrant: renderMarkup(emptyModel, 'quadrant', utcOffset),
      shared: '',
    })
    return
  }

  const flights: FlightDisplayData[] = []

  for (const iataFlight of flightNumbers) {
    const icaoCallsign = toIcaoCallsign(iataFlight)
    const airlineIata = iataFlight.replace(/\d+$/, '')

    try {
      // Fetch live data and route in parallel
      const [aircraft, route] = await Promise.all([
        client.getByCallsignCached(icaoCallsign),
        client.getRouteCached(icaoCallsign).catch((e) => {
          logger.warn(`[FLIGHTS] Route fetch failed for ${icaoCallsign}`, String(e))
          return null
        }),
      ])

      if (!aircraft) {
        flights.push({
          flightIata: iataFlight,
          airlineIata,
          depAirport: route?.from ?? '',
          arrAirport: route?.to ?? '',
          status: 'Landed',
          altitudeFt: '--',
          speedMph: '--',
          aircraftModel: '--',
          aircraftIcao: '',
          heading: '--',
          eta: '--',
          progressPct: null,
        })
        continue
      }

      const altBaro = aircraft.alt_baro
      const isOnGround = altBaro === 'ground' || altBaro === 0
      const altStr = isOnGround ? 'Ground' : typeof altBaro === 'number' ? altBaro.toLocaleString() : '--'

      const speedMph = typeof aircraft.gs === 'number' ? Math.round(aircraft.gs * 1.15078).toLocaleString() : '--'

      const aircraftIcao = aircraft.t ?? ''
      const aircraftModel = lookupAircraftName(aircraftIcao)

      const status = deriveStatus(altBaro, aircraft.baro_rate)
      const heading = formatHeading(aircraft.track)

      const progressPct = calcProgress(aircraft.lat, aircraft.lon, route?.fromLat, route?.fromLon, route?.toLat, route?.toLon)

      const eta = calcEta(aircraft.lat, aircraft.lon, route?.toLat, route?.toLon, aircraft.gs, utcOffset)

      flights.push({
        flightIata: iataFlight,
        airlineIata,
        depAirport: route?.from ?? '',
        arrAirport: route?.to ?? '',
        status,
        altitudeFt: altStr,
        speedMph,
        aircraftModel,
        aircraftIcao,
        heading,
        eta,
        progressPct,
      })
    } catch (e) {
      logger.warn(`[FLIGHTS] Failed to fetch data for ${iataFlight}`, String(e))
      flights.push({
        flightIata: iataFlight,
        airlineIata,
        depAirport: '',
        arrAirport: '',
        status: 'Data unavailable',
        altitudeFt: '--',
        speedMph: '--',
        aircraftModel: '--',
        aircraftIcao: '',
        heading: '--',
        eta: '--',
        progressPct: null,
      })
    }
  }

  const selected = [pickFlight(userUuid, flights)]

  res.json({
    markup: renderMarkup(selected, 'full', utcOffset),
    markup_half_horizontal: renderMarkup(selected, 'half_horizontal', utcOffset),
    markup_half_vertical: renderMarkup(selected, 'half_vertical', utcOffset),
    markup_quadrant: renderMarkup(selected, 'quadrant', utcOffset),
    shared: '',
  })
}
