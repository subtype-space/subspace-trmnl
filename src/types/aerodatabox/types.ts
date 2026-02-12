// AeroDataBox API response types
// Endpoint: GET /flights/{searchBy}/{searchParam}

export type AeroFlightStatus =
  | 'Unknown'
  | 'Expected'
  | 'EnRoute'
  | 'CheckIn'
  | 'Boarding'
  | 'GateClosed'
  | 'Departed'
  | 'Delayed'
  | 'Approaching'
  | 'Arrived'
  | 'Canceled'
  | 'Diverted'
  | 'CanceledUncertain'

export type AeroTimeInfo = {
  utc: string
  local: string
}

export type AeroAirportInfo = {
  name: string
  icao?: string
  iata?: string
  localCode?: string
  shortName?: string
  municipalityName?: string
  countryCode?: string
  timeZone?: string
  location?: { lat: number; lon: number }
}

export type AeroDepartureArrival = {
  airport: AeroAirportInfo
  quality?: string[]
  scheduledTime?: AeroTimeInfo
  revisedTime?: AeroTimeInfo
  predictedTime?: AeroTimeInfo
  runwayTime?: AeroTimeInfo
  terminal?: string
  gate?: string
  checkInDesk?: string
  baggageBelt?: string
  runway?: string
}

export type AeroLocation = {
  lat: number
  lon: number
  pressureAltitude?: { feet?: number; meter?: number }
  altitude?: { feet?: number; meter?: number }
  groundSpeed?: { kt?: number; kmPerHour?: number; miPerHour?: number }
  trueTrack?: { deg?: number }
  reportedAtUtc?: string
}

export type AeroDistance = {
  meter: number
  km: number
  mile: number
  nm: number
  feet: number
}

export type AeroFlightContract = {
  number: string
  status: AeroFlightStatus
  codeshareStatus: 'IsOperator' | 'IsCodeshared' | 'Unknown'
  isCargo: boolean
  lastUpdatedUtc?: string
  departure: AeroDepartureArrival
  arrival: AeroDepartureArrival
  callSign?: string
  aircraft?: {
    reg?: string
    modeS?: string
    model?: string
  }
  airline?: {
    name?: string
    iata?: string
    icao?: string
  }
  greatCircleDistance?: AeroDistance
  location?: AeroLocation
}
