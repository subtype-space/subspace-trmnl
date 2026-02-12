import type { AeroFlightContract, AeroFlightStatus } from '../../types/aerodatabox/types.js'
import type { FlightDisplayData } from '../../types/trmnl/flightTypes.js'
import { calcProgress, formatHeading } from './formatters.js'

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
      return 0
    case 'CheckIn':
      return 0
    case 'Boarding':
      return 0
    case 'GateClosed':
      return 0
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

// Extract HH:MM from the API's local time string (e.g. "2026-02-11 12:39-05:00" -> "12:39")
function formatLocalTime(timeInfo: { local?: string } | undefined): string {
  if (!timeInfo?.local) return '--'
  const match = timeInfo.local.match(/\d{4}-\d{2}-\d{2}\s(\d{2}:\d{2})/)
  return match ? match[1] : '--'
}

// Format departure time in the departure airport's local timezone
function formatDepTime(flight: AeroFlightContract): string {
  const timeInfo = flight.departure.runwayTime ?? flight.departure.revisedTime ?? flight.departure.scheduledTime
  return formatLocalTime(timeInfo)
}

// Format ETA in the arrival airport's local timezone
function formatEta(flight: AeroFlightContract): string {
  const timeInfo =
    flight.arrival.runwayTime ?? flight.arrival.revisedTime ?? flight.arrival.predictedTime ?? flight.arrival.scheduledTime
  return formatLocalTime(timeInfo)
}

// Parse UTC time string from API (handles "2026-02-11 08:28Z" format with space instead of T)
function parseUtcMs(utcStr: string): number {
  return new Date(utcStr.replace(' ', 'T')).getTime()
}

// Get best arrival time as UTC ms for comparison
function getArrivalUtcMs(flight: AeroFlightContract): number | null {
  const timeInfo =
    flight.arrival.runwayTime ?? flight.arrival.revisedTime ?? flight.arrival.predictedTime ?? flight.arrival.scheduledTime
  if (!timeInfo?.utc) return null
  const ms = parseUtcMs(timeInfo.utc)
  return isNaN(ms) ? null : ms
}

const ACTIVE_STATUSES: AeroFlightStatus[] = ['EnRoute', 'Departed', 'Approaching']
const PREFLIGHT_STATUSES: AeroFlightStatus[] = ['Expected', 'CheckIn', 'Boarding', 'GateClosed', 'Delayed']
const LIKELY_ARRIVED_BUFFER_MS = 2 * 60 * 60 * 1000 // 2 hours

export function buildFlightDisplayData(flight: AeroFlightContract): FlightDisplayData {
  const loc = flight.location
  const isActive = ACTIVE_STATUSES.includes(flight.status)
  const isPreflight = PREFLIGHT_STATUSES.includes(flight.status)

  // Check if flight is likely arrived — active status but ETA passed by 2+ hours
  const arrivalMs = getArrivalUtcMs(flight)
  const likelyArrived = isActive && arrivalMs != null && Date.now() - arrivalMs > LIKELY_ARRIVED_BUFFER_MS

  // Status — location data always takes priority over API status
  let status: string
  if (likelyArrived) {
    status = 'Likely Arrived'
  } else if (loc) {
    status = refineInFlightStatus(flight)
  } else {
    status = mapAeroStatus(flight.status)
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
  if (loc?.groundSpeed?.miPerHour != null) {
    speedMph = Math.round(loc.groundSpeed.miPerHour).toLocaleString()
  } else if (loc?.groundSpeed?.kt != null) {
    speedMph = Math.round(loc.groundSpeed.kt * 1.15078).toLocaleString()
  }

  // Heading
  const heading = formatHeading(loc?.trueTrack?.deg)

  // Departure time (airport local)
  const depTime = formatDepTime(flight)

  // ETA
  const eta = formatEta(flight)

  // Last updated — show relative staleness
  let lastUpdated = '--'
  if (flight.lastUpdatedUtc) {
    const updMs = parseUtcMs(flight.lastUpdatedUtc)
    if (!isNaN(updMs)) {
      const diffMs = Date.now() - updMs
      const diffMin = Math.floor(diffMs / 60_000)
      const diffHr = Math.floor(diffMs / 3_600_000)
      const diffDays = Math.floor(diffMs / 86_400_000)

      if (diffMin < 30) lastUpdated = 'recently'
      else if (diffMin < 60) lastUpdated = `${diffMin}m ago`
      else if (diffHr < 24) lastUpdated = `${diffHr}h ago`
      else if (diffDays === 1) lastUpdated = 'yesterday'
      else lastUpdated = `${diffDays}d ago`
    }
  }

  // Progress — location data takes priority, then infer from status
  let progressPct: number | null
  if (likelyArrived) {
    progressPct = 100
  } else if (loc) {
    progressPct = calcProgress(
      loc.lat,
      loc.lon,
      flight.departure.airport.location?.lat,
      flight.departure.airport.location?.lon,
      flight.arrival.airport.location?.lat,
      flight.arrival.airport.location?.lon
    )
    if (progressPct == null) {
      progressPct = inferProgressFromStatus(flight.status)
    }
  } else if (isPreflight) {
    progressPct = 0
  } else {
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
    depTime,
    eta,
    progressPct,
    lastUpdated,
  }
}
