// src/integrations/wmata/types.ts
export type MetroIncidentResponse = { Incidents: MetroIncident[] }
export type MetroIncident = {
  IncidentID: string
  DateUpdated: string
  Description: string
  IncidentType: string
  LinesAffected: string
}

export type RailPredictionResponse = { Trains: RailPrediction[] }
export type RailPrediction = {
  Car: string
  Destination: string
  DestinationCode: string
  DestinationName: string
  Group: string
  Line: string
  LocationCode: string
  LocationName: string
  Min: string
}

export type MetroMarkup = {
  instanceName: string
  displayLine: string
  status: string
  subtitleFinal: string
  selectedLines: string[]
  disruption: Record<string, number>
  alert: Record<string, number>
  totalIncidents: number
  utcOffset: number
}
