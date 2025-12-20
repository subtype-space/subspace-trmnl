import { logger } from '../../utils/logger.js'
const PRIMARY_API_KEY = process.env.WMATA_PRIMARY_KEY
if (!PRIMARY_API_KEY) {
  logger.error('API key is missing!')
}

type MetroIncidentResponse = {
  Incidents: MetroIncident[]
}

type MetroIncident = {
  DateUpdated: string
  Description: string
  IncidentType: string
  LinesAffected: string
}

type RailPredictionResponse = {
  Trains: RailPrediction[]
}

type RailPrediction = {
  Car: string
  DestinationName: string
  Line: string
  Min: string
}

type BusPredictionResponse = {
  Predictions: BusPrediction[]
}

type BusPrediction = {
  DirectionText: string
  VehicleID: string
  Minutes: number
  RouteID: string
}

export async function getBusInfo({ stopID }: { stopID: string }) {
  logger.debug('Getting live prediction for bus stop ID:', stopID)

  const response = await fetch(`https://api.wmata.com/NextBusService.svc/json/jPredictions?StopID=${stopID}`, {
    method: 'GET',
    headers: {
      api_key: PRIMARY_API_KEY!,
    },
  })

  if (!response.ok) {
    return `WMATA API Error: returned ${response.status} with ${response.statusText}`
  }

  const predictionData: BusPredictionResponse = await response.json()
  const busPredictions: BusPrediction[] = predictionData.Predictions

  return formatBusPredictionData(busPredictions)
}

export async function getStationInfo({ stationCodes }: { stationCodes: string[] }) {
  if (stationCodes.length === 0) {
    logger.debug('No station codes were given')
    return 'Station codes were not supplied.'
  }

  logger.info(`[MCP] - WMATA tool - getting station info for ${ stationCodes }`)

  const response = await fetch(`https://api.wmata.com/StationPrediction.svc/json/GetPrediction/${stationCodes}`, {
    method: 'GET',
    headers: {
      api_key: PRIMARY_API_KEY!,
    },
  })

  if (!response.ok) {
    logger.warn(`WMATA API returned ${response.status} with ${response.statusText}`)
    return `WMATA API Error: returned ${response.status} with ${response.statusText}`
  }

  const predictionData: RailPredictionResponse = await response.json()
  const railPredictions: RailPrediction[] = predictionData.Trains

  return formatRailPredictionData(railPredictions)
}

export async function getIncidents() {
  logger.info('[MCP] - WMATA tool - getting incidents')
  
  const response = await fetch('https://api.wmata.com/Incidents.svc/json/Incidents', {
    method: 'GET',
    headers: {
      api_key: PRIMARY_API_KEY!,
    },
  })

  if (!response.ok) {
    logger.warn(`WMATA API returned ${response.status} with ${response.statusText}`)
    return `WMATA API Error: returned ${response.status} with ${response.statusText}`
  }
  const incidentData: MetroIncidentResponse = await response.json()
  // pull into an array of MetroIncidents
  const incidents: MetroIncident[] = incidentData.Incidents

  return formatIncidentsData(incidents)
}

function formatBusPredictionData(busPredictionData: BusPrediction[]): string {
  if (busPredictionData.length === 0) {
    return 'No information for the bus stop is available at this time.'
  }

  const predictionText = busPredictionData
    .map((bus) => `Route: ${bus.RouteID} | Bus: ${bus.VehicleID}\nDirection: ${bus.DirectionText}\nNext bus in: ${bus.Minutes}`)
    .join('\n\n')

  return predictionText
}

function formatIncidentsData(incidentData: MetroIncident[]): string {
  if (incidentData.length === 0) {
    return 'There are no active incidents at this time'
  }
  // iterate through incidentData array
  const incidentText = incidentData
    .map(
      (incident) =>
        `${incident.LinesAffected}: ${incident.IncidentType} ${incident.Description}\nLast Updated: ${incident.DateUpdated}`
    )
    .join('\n\n')

  return incidentText
}

function formatRailPredictionData(predicitonData: RailPrediction[]): string {
  if (predicitonData.length === 0) {
    return 'There is no information for the given station codes, or the metro is closed'
  }

  const predictionText = predicitonData
    .map(
      (prediction) =>
        `${getColor(prediction.Line)} ${prediction.Line} line\nDestination: ${prediction.DestinationName}\n${prediction.Car} cars long\nNext train arriving in: ${prediction.Min}`
    )
    .join('\n\n')

  return predictionText
}

function getColor(line: string) {
  const lineMap = new Map([
    ['RD', '🔴'],
    ['OR', '🟠'],
    ['YL', '🟡'],
    ['GR', '🟢'],
    ['BL', '🔵'],
    ['SV', '⚪']
  ]);
  return lineMap.get(line);
}