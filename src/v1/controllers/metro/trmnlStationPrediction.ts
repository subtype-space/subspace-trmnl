import { RequestHandler } from 'express'
import { logger } from '../../../utils/logger.js'
import { config } from '../../../config.js'
import { WmataClient } from '../../../integrations/wmata/wmataClient.js'

const client = new WmataClient({ apiKey: config.wmata.apiKey })

function normalizeStationCodes(codes: string[]) {
  const normalized = codes.map((c) => c.trim()).filter(Boolean)
  if (normalized.length === 1 && normalized[0].toLowerCase() === 'all') return ['All']
  return [...new Set(normalized.map((c) => c.toUpperCase()))].sort()
}

export const trmnlStationPrediction: RequestHandler = async (req, res) => {
  try {
    logger.debug('[MTRO] Received rail prediction request')

    const raw = req.query.stations
    const stationsStr = Array.isArray(raw) ? raw.join(',') : (raw as string | undefined)
    if (!stationsStr?.length) {
      res.status(400).json({ error: 'Bad Request', message: 'Cannot pass in no station codes' })
      return
    }

    const codes = normalizeStationCodes(stationsStr.split(','))
    const { trains, cached } = await client.getRailPredictionsCached(codes)
    res.status(200).json({ Trains: trains, cached })
  } catch {
    res.status(502).json({ error: 'WMATA upstream error' })
  }
}
