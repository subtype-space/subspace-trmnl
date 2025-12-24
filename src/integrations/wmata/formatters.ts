// src/integrations/wmata/formatters.ts
import type { RailPrediction, MetroIncident } from '../../types/wmata/types.js'

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
