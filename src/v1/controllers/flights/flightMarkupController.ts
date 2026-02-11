import { RequestHandler } from 'express'
import { logger } from '../../../utils/logger.js'
import { getFlightSettingsByUuid } from '../../../utils/dbConnector.js'
import { config } from '../../../config.js'
import { toIcaoCallsign } from '../../../integrations/adsb/adsbClient.js'
import { renderMarkup } from '../../../integrations/adsb/formatters.js'
import { AeroClient } from '../../../integrations/aerodatabox/aeroClient.js'
import { buildFlightDisplayData } from '../../../integrations/aerodatabox/statusMapper.js'
import type { FlightDisplayData } from '../../../types/trmnl/flightTypes.js'
import type { TrmnlMeta } from '../../../types/trmnl/types.js'

const aeroClient = config.aerodatabox.apiKey ? new AeroClient(config.aerodatabox.apiKey) : null
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

  if (!aeroClient) {
    logger.warn('[FLGHT] AeroDataBox API key not configured')
    res.status(503).json({ error: 'Service Unavailable', message: 'Flight tracking not configured' })
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
      logger.warn('[FLGHT] Failed to parse trmnl metadata JSON')
    }
  }

  const utcOffset = Number(meta?.user?.utc_offset ?? 0)

  const settings = await getFlightSettingsByUuid(userUuid)
  const flightNumbers = (settings?.flight_numbers ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 4)

  const baseUrl = new URL(config.auth.mcpServerUrl).origin

  if (flightNumbers.length === 0) {
    const emptyModel: FlightDisplayData[] = []
    res.json({
      markup: renderMarkup(emptyModel, 'full', utcOffset, baseUrl),
      markup_half_horizontal: renderMarkup(emptyModel, 'half_horizontal', utcOffset, baseUrl),
      markup_half_vertical: renderMarkup(emptyModel, 'half_vertical', utcOffset, baseUrl),
      markup_quadrant: renderMarkup(emptyModel, 'quadrant', utcOffset, baseUrl),
      shared: '',
    })
    return
  }

  const flights: FlightDisplayData[] = []

  for (const iataFlight of flightNumbers) {
    const icaoCallsign = toIcaoCallsign(iataFlight)

    try {
      const aeroFlight = await aeroClient.getFlightByCallsignCached(icaoCallsign)

      if (!aeroFlight) {
        const airlineIata = iataFlight.replace(/\d+$/, '')
        const airlineIcao = icaoCallsign.replace(/\d+$/, '')
        flights.push({
          flightIata: iataFlight,
          airlineIata,
          airlineIcao,
          depAirport: '',
          arrAirport: '',
          status: 'Flight not found',
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

      flights.push(buildFlightDisplayData(aeroFlight, utcOffset))
    } catch (e) {
      logger.warn(`[FLGHT] Failed to fetch data for ${iataFlight}`, String(e))
      const airlineIata = iataFlight.replace(/\d+$/, '')
      const airlineIcao = icaoCallsign.replace(/\d+$/, '')
      flights.push({
        flightIata: iataFlight,
        airlineIata,
        airlineIcao,
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
    markup: renderMarkup(selected, 'full', utcOffset, baseUrl),
    markup_half_horizontal: renderMarkup(selected, 'half_horizontal', utcOffset, baseUrl),
    markup_half_vertical: renderMarkup(selected, 'half_vertical', utcOffset, baseUrl),
    markup_quadrant: renderMarkup(selected, 'quadrant', utcOffset, baseUrl),
    shared: '',
  })
}
