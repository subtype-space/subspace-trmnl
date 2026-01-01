import type { RequestHandler } from 'express'
import { logger } from '../../utils/logger.js'
import { WmataClient } from '../../integrations/wmata/wmataClient.js'

const client = new WmataClient({ apiKey: process.env.WMATA_PRIMARY_KEY ?? '' })

const TTL_MS = 60 * 1000 // 60s cache period time - some requests come in within a short period
type CacheEntry = { at: number; data: any }
const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<any>>()

function normalizeCodes(codes: string[]) {
  // normalize + sort so "A,B" and "B,A" share cache
  const normalized = codes.map(c => c.trim()).filter(Boolean)
  // preserve special All behavior
  if (normalized.length === 1 && normalized[0].toLowerCase() === 'all') return ['All']
  return normalized.map(c => c.toUpperCase()).sort()
}

export const trmnlStationPrediction: RequestHandler = async (req, res) => {
  try {
    logger.debug('[TRMNL] Received rail prediction request')

    const raw = req.query.stations
    const stationsStr = Array.isArray(raw) ? raw.join(',') : (raw as string | undefined)
    if (stationsStr?.length === 0) {
      res.status(400).send('Cannot pass in no station codes')
      return
    }

    const requested = stationsStr?.split(',') ?? []
    const codes = normalizeCodes(requested)
    const key = codes.join(',')

    // serve fresh cache
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < TTL_MS) {
      logger.debug('[TRMNL] Using rail prediction cache')
      res.status(200).json({ Trains: hit.data, cached: true })
      return
    }

    // in-flight dedupe
    let p = inFlight.get(key)
    if (!p) {
      p = (async () => {
        logger.debug('[TRMNL] Performing WMATA integration API call')
        const trains = await client.getRailPredictions(codes)
        cache.set(key, { at: Date.now(), data: trains })
        return trains
      })().finally(() => inFlight.delete(key))
      inFlight.set(key, p)
    }

    const trains = await p
    res.status(200).json({ Trains: trains, cached: false })
  } catch (e) {
    res.status(502).json({ error: 'WMATA upstream error' })
  }
}