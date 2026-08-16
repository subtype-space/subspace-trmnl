import { logger } from '../../src/utils/logger.js'
import { config } from '../../src/config.js'
import { WmataClient } from '../../src/integrations/wmata/wmataClient.js'
import { formatIncidents, formatRailPredictionData } from '../../src/integrations/wmata/formatters.js'

const client = new WmataClient({ apiKey: config.wmata.apiKey })

export async function getStationInfo({ stationCodes }: { stationCodes: string[] }) {
  if (stationCodes.length === 0) {
    logger.debug('No station codes were given')
    return 'Station codes were not supplied.'
  }

  logger.info(`[MCP] - WMATA tool - getting station info for ${stationCodes}`)

  try {
    const response = await client.getRailPredictions(stationCodes)
    return formatRailPredictionData(response)
  } catch (e) {
    logger.warn(e)
    return `WMATA API Error: returned ${e}`
  }

  // const predictionData: RailPredictionResponse = await response.json()
  // const railPredictions: RailPrediction[] = predictionData.Trains

  // return formatRailPredictionData(railPredictions)
}

export async function getIncidents() {
  logger.info('[MCP] - WMATA tool - getting incidents')

  try {
    const response = await client.getIncidents()
    return formatIncidents(response)
  } catch (e) {
    logger.warn(e)
    return `WMATA API Error: returned ${e}`
  }
}
