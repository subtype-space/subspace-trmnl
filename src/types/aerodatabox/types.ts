// AeroDataBox API response types
// Endpoint: GET /flights/{searchBy}/{searchParam}

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

export type AeroLocation = {
  lat: number
  lon: number
  pressureAltitude?: { feet?: number; meter?: number }
  altitude?: { feet?: number; meter?: number }
  groundSpeed?: { kt?: number; kmPerHour?: number; miPerHour?: number }
  trueTrack?: { deg?: number }
  reportedAtUtc?: string
}

export type AeroTimeInfo = {
  utc: string
  local: string
}

export type CacheEntry = {
  data: AeroFlightContract | null
  at: number
  status: AeroFlightStatus | null
}

export type FlightDisplayData = {
  flightIata: string
  airlineIata: string
  airlineIcao: string
  depAirport: string
  arrAirport: string
  status: string
  altitudeFt: string
  speedMph: string
  aircraftModel: string
  aircraftIcao: string
  heading: string
  delayString: string | null // delayed/early/ontime
  depTime: string // HH:MM actual/revised departure time in departure airport's local time
  schedDep: string // HH:MM originally scheduled departure time (the "was" anchor); '--' if unknown
  depDelayMin: number | null // departure delay vs schedule in minutes (+late, -early); null if unknown
  eta: string // HH:MM actual/revised arrival time in arrival airport's local time
  schedEta: string // HH:MM originally scheduled arrival time (the "was" anchor); '--' if unknown
  delayMin: number | null // arrival delay vs schedule in minutes (+late, -early); null if unknown
  minsToDeparture: number | null // minutes until departure (from "now"); null if unknown, <=0 if departed
  minsRemaining: number | null // minutes until arrival (from "now"); null if unknown, <=0 if past
  progressPct: number | null // 0-100, null if unknown
  lastUpdated: string // relative staleness (e.g. "5m ago", "Yesterday")
}

export type Provider = 'apimarket' | 'rapidapi'

export type TrmnlFlightSettings = {
  user_uuid: string
  flight_numbers?: string | null
  plugin_setting_id?: number | null
}
