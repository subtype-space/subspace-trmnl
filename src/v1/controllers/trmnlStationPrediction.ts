import { RequestHandler } from 'express'
import { logger } from '../../utils/logger.js'
import { WmataClient } from '../../integrations/wmata/wmataClient.js'


const client = new WmataClient({ apiKey: process.env.WMATA_PRIMARY_KEY ?? '' })

export const trmnlStationPrediction: RequestHandler = async (req, res) => {
  try {

    logger.debug('[TRMNL] Received rail prediction request')
    const raw = req.query.stations
    const stationsStr = Array.isArray(raw) ? raw.join(',') : (raw as string | undefined)

    if (stationsStr?.length == 0) {
      res.status(400).send('Cannot pass in no station codes')
      return
    }

    const stationCodes =
      stationsStr?.split(',').map(s => s.trim()).filter(Boolean) ?? []

    // allow "All" as a special value
    const codes = stationCodes.length === 1 && stationCodes[0].toLowerCase() === 'all'
      ? ['All']
      : stationCodes

    const trains = await client.getRailPredictions(codes)
    res.status(200).json({ Trains: trains })
    return
  } catch (e) {
    res.status(502).json({ error: 'WMATA upstream error' })
    return
  }
}