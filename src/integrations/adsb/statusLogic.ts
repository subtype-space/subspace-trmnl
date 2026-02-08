import type { AdsbAircraft, AdsbRoute, LastSeenData } from '../../types/adsb/types.js'
import { deriveStatus } from './formatters.js'
import { haversineKm } from './formatters.js'

export type StatusResult = {
  aircraft: AdsbAircraft | null
  route: AdsbRoute | null
  status: string
  progressPct: number | null
}

export function resolveFlightStatus(
  liveAircraft: AdsbAircraft | null,
  lastSeen: LastSeenData | null,
  route: AdsbRoute | null
): StatusResult {
  // Live data exists — use it directly
  if (liveAircraft) {
    return {
      aircraft: liveAircraft,
      route,
      status: deriveStatus(liveAircraft.alt_baro, liveAircraft.baro_rate),
      progressPct: null, // caller computes this from live coords
    }
  }

  // No live data and never seen before
  if (!lastSeen) {
    return { aircraft: null, route, status: 'No data', progressPct: null }
  }

  // No live data, last seen on ground
  const wasOnGround = lastSeen.aircraft.alt_baro === 'ground' || lastSeen.aircraft.alt_baro === 0
  if (wasOnGround) {
    return { aircraft: null, route: lastSeen.route ?? route, status: 'Landed', progressPct: null }
  }

  // No live data, last seen airborne — estimate if landed
  if (hasLikelyLanded(lastSeen, lastSeen.route ?? route)) {
    return { aircraft: null, route: lastSeen.route ?? route, status: 'Landed', progressPct: null }
  }

  // Still likely in flight — return stale aircraft for display
  const elapsedMin = Math.round((Date.now() - lastSeen.timestamp) / 60_000)
  return {
    aircraft: lastSeen.aircraft,
    route: lastSeen.route ?? route,
    status: `In flight (last seen ${elapsedMin}m ago)`,
    progressPct: lastSeen.progressPct,
  }
}

export function hasLikelyLanded(lastSeen: LastSeenData, route: AdsbRoute | null): boolean {
  const elapsedMs = Date.now() - lastSeen.timestamp
  const ac = lastSeen.aircraft

  // If we have position + destination + speed, estimate remaining flight time
  if (
    ac.lat != null &&
    ac.lon != null &&
    route?.toLat != null &&
    route?.toLon != null &&
    typeof ac.gs === 'number' &&
    ac.gs > 10
  ) {
    const remainingKm = haversineKm(ac.lat, ac.lon, route.toLat, route.toLon)
    const gsKmh = ac.gs * 1.852
    const remainingMs = (remainingKm / gsKmh) * 3600 * 1000
    // Add 30-minute buffer for approach/taxi
    const bufferMs = 30 * 60 * 1000
    return elapsedMs > remainingMs + bufferMs
  }

  // Fallback: 6-hour window — most flights are under 6 hours
  const fallbackMs = 6 * 60 * 60 * 1000
  return elapsedMs > fallbackMs
}
