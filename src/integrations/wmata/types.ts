// src/integrations/wmata/types.ts
export type MetroIncidentResponse = { Incidents: MetroIncident[] }
export type MetroIncident = {
  DateUpdated: string
  Description: string
  IncidentType: string
  LinesAffected: string
}

export type RailPredictionResponse = { Trains: RailPrediction[] }
export type RailPrediction = {
  Car: string
  DestinationName: string
  Line: string
  Min: string
}

export type BusPredictionResponse = { Predictions: BusPrediction[] }
export type BusPrediction = {
  DirectionText: string
  VehicleID: string
  Minutes: number
  RouteID: string
}
