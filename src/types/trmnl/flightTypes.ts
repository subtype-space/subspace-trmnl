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
