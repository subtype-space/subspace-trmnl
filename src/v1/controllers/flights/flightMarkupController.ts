import { RequestHandler } from 'express'
import { config } from '../../../config.js'
import type { FlightDisplayData } from '../../../types/aerodatabox/types.js'
import { logger } from '../../../utils/logger.js'
import { getFlightSettingsByUuid } from '../../../utils/dbConnector.js'
import { parseTrmnlMeta } from '../../../utils/trmnlMeta.js'
import { AeroClient } from '../../../integrations/aerodatabox/aeroClient.js'
import { buildFlightDisplayData } from '../../../integrations/aerodatabox/statusMapper.js'
import { renderMarkup } from '../../../integrations/aerodatabox/renderer.js'
import { MAX_TRACKED } from './flightManageController.js'

const aeroClient = config.aerodatabox.apiKey ? new AeroClient(config.aerodatabox.apiKey, config.aerodatabox.provider, config.aerodatabox.ttl) : null
const rotationIndex = new Map<string, number>()

function nextRotationIndex(userUuid: string, count: number): number {
  const prev = rotationIndex.get(userUuid) ?? -1
  const next = (prev + 1) % count
  rotationIndex.set(userUuid, next)
  return next
}

// used for rendering the fallback state, or nothing configured, or unknown flight
function emptyFlightDisplay(flightNumber: string, airlineCode: string, status: string): FlightDisplayData {
  return {
    flightIata: flightNumber,
    airlineIata: airlineCode,
    airlineIcao: '',
    depAirport: '',
    arrAirport: '',
    status,
    altitudeFt: '--',
    speedMph: '--',
    aircraftModel: '--',
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

export const flightMarkupController: RequestHandler = async (req, res) => {
  const tokenHash = (req as any).trmnl?.tokenHash as string | undefined
  const userUuid = req.body?.user_uuid as string | undefined
  const trmnlRaw = req.body?.trmnl

  logger.debug('[AERO] Incoming markup request: ', { tokenHash, userUuid, trmnlRaw })
  if (!tokenHash) {
    res.status(500).json({ error: 'Bad Request', message: 'missing trmnl auth context' })
    return
  }

  if (typeof userUuid !== 'string' || !userUuid) {
    logger.debug('[AERO] UUID was not provided. Will not render.')
    res.status(400).json({ error: 'Bad Request', message: 'missing user_uuid' })
    return
  }

  if (!aeroClient) {
    logger.warn('[AERO] AeroDataBox API key not configured')
    res.status(503).json({ error: 'Service Unavailable', message: 'Service Unavailable :(' })
    return
  }

  const meta = parseTrmnlMeta(trmnlRaw)

  const utcOffset = Number(meta?.user?.utc_offset ?? 0)

  let settings
  let settingsUnavailable = false
  try {
    settings = await getFlightSettingsByUuid(userUuid)
  } catch (e) {
    // Degrade to the empty-state markup if the DB read fails
    logger.warn(`[AERO] Failed to read flight settings for ${userUuid}`, String(e))
    settings = null
    settingsUnavailable = true
  }
  const toList = (raw?: string | null) =>
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  const targets = [
    ...toList(settings?.flight_numbers).map((id) => ({ searchBy: 'number' as const, id })),
    ...toList(settings?.tail_numbers).map((id) => ({ searchBy: 'reg' as const, id })),
  ].slice(0, MAX_TRACKED)

  const baseUrl = new URL(config.api.publicBaseUrl).origin

  if (targets.length === 0) {
    const emptyMessage = settingsUnavailable ? 'Temporarily unavailable - try again shortly' : 'Configure flights in settings'
    logger.info(settingsUnavailable ? '[AERO] Flight settings unavailable' : '[AERO] No flights configured')
    res.json({
      markup: renderMarkup(null, 'full', utcOffset, baseUrl, config.api.assetVersion, emptyMessage),
      markup_half_horizontal: renderMarkup(null, 'half_horizontal', utcOffset, baseUrl, config.api.assetVersion, emptyMessage),
      markup_half_vertical: renderMarkup(null, 'half_vertical', utcOffset, baseUrl, config.api.assetVersion, emptyMessage),
      markup_quadrant: renderMarkup(null, 'quadrant', utcOffset, baseUrl, config.api.assetVersion, emptyMessage),
      shared: '',
    })
    return
  }

  // Only fetch data for the flight we're about to display (1 API call per request)
  const { searchBy, id: flightNumber } = targets[nextRotationIndex(userUuid, targets.length)]
  const airlineCode = searchBy === 'number' ? flightNumber.replace(/\d+$/, '') : ''
  const notFound = searchBy === 'number' ? 'Flight not found' : 'No flights found for aircraft'

  let displayData: FlightDisplayData
  try {
    const aeroFlight = await aeroClient.getFlightCached(searchBy, flightNumber)
    displayData = aeroFlight ? buildFlightDisplayData(aeroFlight) : emptyFlightDisplay(flightNumber, airlineCode, notFound)
  } catch (e) {
    logger.warn(`[AERO] Failed to fetch data for ${flightNumber}`, String(e))
    displayData = emptyFlightDisplay(flightNumber, airlineCode, 'Data unavailable')
  }

  res.json({
    markup: renderMarkup(displayData, 'full', utcOffset, baseUrl, config.api.assetVersion),
    markup_half_horizontal: renderMarkup(displayData, 'half_horizontal', utcOffset, baseUrl, config.api.assetVersion),
    markup_half_vertical: renderMarkup(displayData, 'half_vertical', utcOffset, baseUrl, config.api.assetVersion),
    markup_quadrant: renderMarkup(displayData, 'quadrant', utcOffset, baseUrl, config.api.assetVersion),
    shared: '',
  })

  logger.info(`[AERO] Served markup for ${flightNumber} to user ${userUuid}`)
}
