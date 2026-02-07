/**
 * This handler lets us cache rail predictions (with a TTL of 1 minute) based on station
 * We can also leverage the ability to cache stations from other people's requests to serve other requests
 * Basically a cache per LocationCode in case a user passes in more than one station code
 * This handler may chance to only permit one station code vs more than one
 */
import { RequestHandler } from 'express'
import { logger } from '../../../utils/logger.js'
import { config } from '../../../config.js'
import { WmataClient } from '../../../integrations/wmata/wmataClient.js'
import { RailPrediction } from '../../../types/wmata/types.js'

const client = new WmataClient({ apiKey: config.wmata.apiKey })

const TTL_MS = 60 * 1000

type CacheEntry<T> = { at: number; data: T }

const stationCache = new Map<string, CacheEntry<RailPrediction[]>>() // B03 -> trains
const stationInFlight = new Map<string, Promise<RailPrediction[]>>() // B03 -> promise

const isFresh = (hit?: CacheEntry<any>) => !!hit && Date.now() - hit.at < TTL_MS

function normalizeStationCodes(codes: string[]) {
  const normalized = codes.map((c) => c.trim()).filter(Boolean)
  if (normalized.length === 1 && normalized[0].toLowerCase() === 'all') return ['All']
  return [...new Set(normalized.map((c) => c.toUpperCase()))].sort()
}

// this lets us cache other station codes if other requests happen to include one
function groupByLocationCode(trains: RailPrediction[]) {
  const m = new Map<string, RailPrediction[]>()
  for (const t of trains ?? []) {
    const code = (t.LocationCode ?? '').toUpperCase()
    if (!code) continue
    const arr = m.get(code)
    if (arr) arr.push(t)
    else m.set(code, [t])
  }
  return m
}

async function fetchMissingStations(missing: string[]) {
  logger.debug(`[TRMNL] Performing WMATA integration API call for missing=[${missing.join(',')}]`)
  const trains: RailPrediction[] = await client.getRailPredictions(missing)
  const grouped = groupByLocationCode(trains)
  const now = Date.now()

  for (const code of missing) {
    stationCache.set(code, { at: now, data: grouped.get(code) ?? [] })
  }

  // return trains per station from cache (so each stationInFlight resolves to its own slice)
  return (code: string) => stationCache.get(code)?.data ?? []
}

export const trmnlStationPrediction: RequestHandler = async (req, res) => {
  try {
    logger.debug('[TRMNL] Received rail prediction request')

    const raw = req.query.stations
    const stationsStr = Array.isArray(raw) ? raw.join(',') : (raw as string | undefined)
    if (stationsStr?.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'Cannot pass in no station codes'})
      return
    }

    const requested = stationsStr?.split(',') ?? []
    const codes = normalizeStationCodes(requested)

    if (codes[0] === 'All') {
      const trains: RailPrediction[] = await client.getRailPredictions(['All'])
      res.status(200).json({ Trains: trains, cached: false })
      return
    }

    // serve what we can from cache
    const merged: RailPrediction[] = []
    const missing: string[] = []

    for (const code of codes) {
      const hit = stationCache.get(code)
      if (isFresh(hit)) {
        merged.push(...hit!.data)
      } else {
        missing.push(code)
      }
    }

    //kick off (or join) in-flight per missing station
    if (missing.length) {
      // any stations already fetching?
      const trulyMissing: string[] = []
      for (const code of missing) {
        if (!stationInFlight.has(code)) trulyMissing.push(code)
      }

      // do ONE WMATA call for any missing stations with expired TTL
      if (trulyMissing.length) {
        const batchPromise = (async () => {
          const getSlice = await fetchMissingStations(trulyMissing)
          return getSlice
        })()

        for (const code of trulyMissing) {
          const p = batchPromise.then((getSlice) => getSlice(code)).finally(() => stationInFlight.delete(code))
          stationInFlight.set(code, p)
        }
      }

      // wait for all missing stations (some may have been in-flight already)
      const fetchedSlices = await Promise.all(missing.map((code) => stationInFlight.get(code)!))
      for (const slice of fetchedSlices) merged.push(...slice)
    }

    // cached=true only if we didn’t need to fetch anything
    const cached = missing.length === 0
    res.status(200).json({ Trains: merged, cached })
    return
  } catch (e) {
    res.status(502).json({ error: 'WMATA upstream error' })
    return
  }
}
