import type { AeroFlightContract, AeroFlightStatus } from '../../types/aerodatabox/types.js'
import type { FlightDisplayData } from '../../types/trmnl/flightTypes.js'
import { calcProgress, formatHeading } from '../adsb/formatters.js'

export function mapAeroStatus(status: AeroFlightStatus): string {
  switch (status) {
    case 'Expected':
      return 'Scheduled'
    case 'CheckIn':
      return 'Check-in Open'
    case 'Boarding':
      return 'Boarding'
    case 'GateClosed':
      return 'Gate Closed'
    case 'Departed':
    case 'EnRoute':
      return 'In Flight'
    case 'Approaching':
      return 'Approaching'
    case 'Arrived':
      return 'Arrived'
    case 'Delayed':
      return 'Delayed'
    case 'Canceled':
    case 'CanceledUncertain':
      return 'Canceled'
    case 'Diverted':
      return 'Diverted'
    default:
      return 'Unknown'
  }
}

// Refine "In Flight" status using location altitude data
function refineInFlightStatus(flight: AeroFlightContract): string {
  const loc = flight.location
  if (!loc) return 'In Flight'

  const altFeet = loc.altitude?.feet ?? loc.pressureAltitude?.feet
  if (altFeet == null) return 'In Flight'

  // On or near ground
  if (altFeet < 500) return 'On Ground'
  // Below 10,000 ft and we have arrival airport — likely approaching or departing
  if (altFeet < 10000) {
    if (flight.status === 'Approaching') return 'Descending'
    return 'Climbing'
  }
  return 'Cruising'
}

// Infer progress percentage from flight status when no location data is available
function inferProgressFromStatus(status: AeroFlightStatus): number | null {
  switch (status) {
    case 'Expected':
    case 'CheckIn':
    case 'Boarding':
    case 'GateClosed':
    case 'Delayed':
      return 0
    case 'Departed':
      return 5
    case 'Approaching':
      return 95
    case 'Arrived':
      return 100
    default:
      return null
  }
}

// Format an ISO datetime string to HH:MM in the user's local time
function formatEta(flight: AeroFlightContract, utcOffsetSec: number): string {
  // Prefer the most specific arrival time available
  const timeInfo =
    flight.arrival.runwayTime ?? flight.arrival.revisedTime ?? flight.arrival.predictedTime ?? flight.arrival.scheduledTime
  if (!timeInfo?.utc) return '--'

  const arrivalMs = new Date(timeInfo.utc).getTime()
  if (isNaN(arrivalMs)) return '--'

  const localMs = arrivalMs + utcOffsetSec * 1000
  const d = new Date(localMs)
  const h = d.getUTCHours().toString().padStart(2, '0')
  const m = d.getUTCMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

export function buildFlightDisplayData(flight: AeroFlightContract, utcOffsetSec: number): FlightDisplayData {
  const loc = flight.location
  const isActive = ['EnRoute', 'Departed', 'Approaching'].includes(flight.status)

  // Status — refine with altitude data for active flights
  let status = mapAeroStatus(flight.status)
  if (isActive && loc) {
    status = refineInFlightStatus(flight)
  }

  // Route
  const depAirport = flight.departure.airport.iata ?? flight.departure.airport.icao ?? ''
  const arrAirport = flight.arrival.airport.iata ?? flight.arrival.airport.icao ?? ''

  // Airline codes
  const airlineIata = flight.airline?.iata ?? ''
  const airlineIcao = flight.airline?.icao ?? ''

  // Aircraft model
  const aircraftModel = flight.aircraft?.model ?? '--'

  // Altitude
  let altitudeFt = '--'
  if (loc) {
    const altFeet = loc.altitude?.feet ?? loc.pressureAltitude?.feet
    if (altFeet != null) {
      altitudeFt = altFeet < 500 ? 'Ground' : Math.round(altFeet).toLocaleString()
    }
  }

  // Speed
  let speedMph = '--'
  if (loc?.groundSpeed?.mph != null) {
    speedMph = Math.round(loc.groundSpeed.mph).toLocaleString()
  } else if (loc?.groundSpeed?.kt != null) {
    speedMph = Math.round(loc.groundSpeed.kt * 1.15078).toLocaleString()
  }

  // Heading
  const heading = formatHeading(loc?.trueTrack?.deg)

  // ETA
  const eta = formatEta(flight, utcOffsetSec)

  // Progress — calculate from position if available, otherwise infer from status
  let progressPct = calcProgress(
    loc?.lat,
    loc?.lon,
    flight.departure.airport.location?.lat,
    flight.departure.airport.location?.lon,
    flight.arrival.airport.location?.lat,
    flight.arrival.airport.location?.lon
  )
  if (progressPct == null) {
    progressPct = inferProgressFromStatus(flight.status)
  }

  return {
    flightIata: flight.number.replace(/\s/g, ''),
    airlineIata,
    airlineIcao,
    depAirport,
    arrAirport,
    status,
    altitudeFt,
    speedMph,
    aircraftModel,
    aircraftIcao: '',
    heading,
    eta,
    progressPct,
  }
}
