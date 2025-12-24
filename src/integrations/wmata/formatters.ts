// src/integrations/wmata/formatters.ts
import type { BusPrediction, RailPrediction, MetroIncident } from './types.js'

export function formatBusPredictionData(busPredictionData: BusPrediction[]): string {
  if (busPredictionData.length === 0) {
    return 'No information for the bus stop is available at this time.'
  }

  const predictionText = busPredictionData
    .map((bus) => `Route: ${bus.RouteID} | Bus: ${bus.VehicleID}\nDirection: ${bus.DirectionText}\nNext bus in: ${bus.Minutes}`)
    .join('\n\n')

  return predictionText
}

export function formatRailPredictionData(predicitonData: RailPrediction[]): string {
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

export function formatIncidents(incidentData: MetroIncident[]): string {
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

function getColor(line: string) {
  const lineMap = new Map([
    ['RD', '🔴'],
    ['OR', '🟠'],
    ['YL', '🟡'],
    ['GR', '🟢'],
    ['BL', '🔵'],
    ['SV', '⚪'],
  ])
  return lineMap.get(line) ?? '🚆'
}
