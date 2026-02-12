export type TrmnlFlightSettings = {
  user_uuid: string
  flight_numbers?: string | null
  plugin_setting_id?: number | null
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
  eta: string
  progressPct: number | null // 0-100, null if unknown
  lastUpdated: string // HH:MM local time of last API update
}
