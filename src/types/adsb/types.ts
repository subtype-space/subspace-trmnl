// adsb.lol API response types

// GET /v2/callsign/{callsign}
export type AdsbResponse = {
  ac: AdsbAircraft[]
  msg: string
  now: number
  total: number
}

export type AdsbAircraft = {
  hex: string
  flight?: string
  r?: string // registration
  t?: string // ICAO aircraft type code (e.g. B738, A320)
  alt_baro?: number | 'ground'
  alt_geom?: number
  gs?: number // ground speed in knots
  track?: number
  lat?: number
  lon?: number
  baro_rate?: number
  squawk?: string
  category?: string
  nav_heading?: number
}
