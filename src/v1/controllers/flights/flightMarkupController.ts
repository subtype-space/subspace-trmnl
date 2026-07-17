import { RequestHandler } from 'express'
import { config } from '../../../config.js'
import type { FlightDisplayData } from '../../../types/trmnl/flightTypes.js'
import { logger } from '../../../utils/logger.js'
import { getFlightSettingsByUuid } from '../../../utils/dbConnector.js'
import { parseTrmnlMeta } from '../../../utils/trmnlMeta.js'
import { AeroClient } from '../../../integrations/aerodatabox/aeroClient.js'
import { buildFlightDisplayData } from '../../../integrations/aerodatabox/statusMapper.js'
import { renderMarkup } from '../../../integrations/aerodatabox/renderer.js'

const aeroClient = config.aerodatabox.apiKey ? new AeroClient(config.aerodatabox.apiKey, config.aerodatabox.provider) : null
const rotationIndex = new Map<string, number>()

function nextRotationIndex(userUuid: string, count: number): number {
  const prev = rotationIndex.get(userUuid) ?? -1
  const next = (prev + 1) % count
  rotationIndex.set(userUuid, next)
  return next
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
    res.status(503).json({ error: 'Service Unavailable', message: 'Service Unavailable :(' })
    return
  }

  const meta = parseTrmnlMeta(trmnlRaw)

  const utcOffset = Number(meta?.user?.utc_offset ?? 0)

  const settings = await getFlightSettingsByUuid(userUuid)
  const flightNumbers = (settings?.flight_numbers ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 4)

  const baseUrl = new URL(config.auth.mcpServerUrl).origin

  if (flightNumbers.length === 0) {
    logger.info('[AERO] No flights configured')
    res.json({
      markup: renderMarkup(null, 'full', utcOffset, baseUrl),
      markup_half_horizontal: renderMarkup(null, 'half_horizontal', utcOffset, baseUrl),
      markup_half_vertical: renderMarkup(null, 'half_vertical', utcOffset, baseUrl),
      markup_quadrant: renderMarkup(null, 'quadrant', utcOffset, baseUrl),
      shared: '',
    })
    return
  }

  // Only fetch data for the flight we're about to display (1 API call per request)
  const idx = nextRotationIndex(userUuid, flightNumbers.length)
  const flightNumber = flightNumbers[idx]
  const airlineCode = flightNumber.replace(/\d+$/, '')

  let displayData: FlightDisplayData
  try {
    logger.info(`[FLGHT] Fetching data for ${flightNumber})`)
    const aeroFlight = await aeroClient.getFlightByNumberCached(flightNumber)

    if (!aeroFlight) {
      displayData = {
        flightIata: flightNumber,
        airlineIata: airlineCode,
        airlineIcao: '',
        depAirport: '',
        arrAirport: '',
        status: 'Flight not found',
        altitudeFt: '--',
        speedMph: '--',
        aircraftModel: '--',
        aircraftIcao: '',
        heading: '--',
        delayString: null,
        depTime: '--',
        schedDep: '--',
        depDelayMin: null,
        eta: '--',
        schedEta: '--',
        delayMin: null,
        minsToDeparture: null,
        minsRemaining: null,
        progressPct: null,
        lastUpdated: '--',
      }
    } else {
      displayData = buildFlightDisplayData(aeroFlight)
    }
  } catch (e) {
    logger.warn(`[FLGHT] Failed to fetch data for ${flightNumber}`, String(e))
    displayData = {
      flightIata: flightNumber,
      airlineIata: airlineCode,
      airlineIcao: '',
      depAirport: '',
      arrAirport: '',
      status: 'Data unavailable',
      altitudeFt: '--',
      speedMph: '--',
      aircraftModel: '--',
      aircraftIcao: '',
      heading: '--',
      delayString: null,
      depTime: '--',
      schedDep: '--',
      depDelayMin: null,
      eta: '--',
      schedEta: '--',
      delayMin: null,
      minsToDeparture: null,
      minsRemaining: null,
      progressPct: null,
      lastUpdated: '--',
    }
  }

  res.json({
    markup: renderMarkup(displayData, 'full', utcOffset, baseUrl),
    markup_half_horizontal: renderMarkup(displayData, 'half_horizontal', utcOffset, baseUrl),
    markup_half_vertical: renderMarkup(displayData, 'half_vertical', utcOffset, baseUrl),
    markup_quadrant: renderMarkup(displayData, 'quadrant', utcOffset, baseUrl),
    shared: '',
  })

  logger.info(`[FLGHT] Served markup for ${flightNumber} to user ${userUuid}`)
}
