import { describe, it, expect, vi } from 'vitest'
import { buildFlightDisplayData, mapAeroStatus } from '../../../src/integrations/aerodatabox/statusMapper.js'
import type { AeroFlightContract, AeroFlightStatus, AeroLocation } from '../../../src/types/aerodatabox/types.js'

// Minimal valid flight contract; override per-test.
function makeFlight(overrides: Partial<AeroFlightContract> = {}): AeroFlightContract {
  return {
    number: 'UA 1074',
    status: 'EnRoute',
    codeshareStatus: 'IsOperator',
    isCargo: false,
    departure: { airport: { name: 'Boston Logan', iata: 'BOS', location: { lat: 0, lon: 0 } } },
    arrival: { airport: { name: 'San Francisco Intl', iata: 'SFO', location: { lat: 0, lon: 10 } } },
    airline: { name: 'United Airlines', iata: 'UA', icao: 'UAL' },
    aircraft: { model: 'Boeing 737 MAX 9' },
    ...overrides,
  }
}

describe('mapAeroStatus', () => {
  it('collapses en-route states to "In Flight"', () => {
    expect(mapAeroStatus('EnRoute')).toBe('In Flight')
    expect(mapAeroStatus('Departed')).toBe('In Flight')
  })

  it('maps terminal and pre-flight states and diversion', () => {
    expect(mapAeroStatus('Boarding')).toBe('Boarding')
    expect(mapAeroStatus('Arrived')).toBe('Arrived')
    expect(mapAeroStatus('Canceled')).toBe('Canceled')
    expect(mapAeroStatus('CanceledUncertain')).toBe('Canceled')
    expect(mapAeroStatus('Diverted')).toBe('Diverted')
  })

  it('falls back to Unknown for unrecognized values', () => {
    expect(mapAeroStatus('Bogus' as AeroFlightStatus)).toBe('Unknown')
  })
})

describe('buildFlightDisplayData', () => {
  it('strips whitespace from the flight number', () => {
    expect(buildFlightDisplayData(makeFlight()).flightIata).toBe('UA1074')
  })

  it('reads route and airline codes', () => {
    const d = buildFlightDisplayData(makeFlight())
    expect(d.depAirport).toBe('BOS')
    expect(d.arrAirport).toBe('SFO')
    expect(d.airlineIata).toBe('UA')
    expect(d.airlineIcao).toBe('UAL')
    expect(d.aircraftModel).toBe('Boeing 737 MAX 9')
  })

  // Regression: API sometimes reports altitude in meters only (no .feet)
  it('converts meters-only altitude to feet instead of showing Ground', () => {
    const loc: AeroLocation = { lat: 0, lon: 5, altitude: { meter: 11000 }, trueTrack: { deg: 270 } }
    const d = buildFlightDisplayData(makeFlight({ location: loc }))
    expect(d.altitudeFt).toBe(Math.round(11000 * 3.28084).toLocaleString()) // ~36,089 ft
    expect(d.altitudeFt).not.toBe('Ground')
    expect(d.altitudeFt).not.toBe('--')
    expect(d.status).toBe('Cruising') // >10,000 ft
  })

  it('reports Ground / On Ground below 500 ft', () => {
    const loc: AeroLocation = { lat: 0, lon: 0, altitude: { feet: 120 } }
    const d = buildFlightDisplayData(makeFlight({ location: loc }))
    expect(d.altitudeFt).toBe('Ground')
    expect(d.status).toBe('On Ground')
  })

  it('derives speed in mph from knots when mph is absent', () => {
    const loc: AeroLocation = { lat: 0, lon: 5, altitude: { feet: 37000 }, groundSpeed: { kt: 400 } }
    const d = buildFlightDisplayData(makeFlight({ location: loc }))
    expect(d.speedMph).toBe(Math.round(400 * 1.15078).toLocaleString()) // 460
  })

  it('computes great-circle progress from live position', () => {
    const loc: AeroLocation = { lat: 0, lon: 5, altitude: { feet: 37000 } }
    const d = buildFlightDisplayData(makeFlight({ location: loc }))
    expect(d.progressPct).toBe(50)
  })

  it('computes arrival delay and exposes actual ETA + scheduled anchor', () => {
    const late = buildFlightDisplayData(
      makeFlight({
        arrival: {
          airport: { name: 'San Francisco Intl', iata: 'SFO', location: { lat: 0, lon: 10 } },
          scheduledTime: { utc: '2026-02-11 14:36Z', local: '2026-02-11 06:36-08:00' },
          runwayTime: { utc: '2026-02-11 14:50Z', local: '2026-02-11 06:50-08:00' },
        },
      })
    )
    expect(late.delayMin).toBe(14)
    expect(late.eta).toBe('06:50') // actual/effective arrival
    expect(late.schedEta).toBe('06:36') // scheduled "was" anchor
    expect(typeof late.minsRemaining).toBe('number') // computed from arrival time (now-relative)
    expect(late.delayString).toBe('On time') // 14 min <= 15-min threshold
  })

  it('computes departure delay and scheduled departure anchor', () => {
    const d = buildFlightDisplayData(
      makeFlight({
        departure: {
          airport: { name: 'Boston Logan', iata: 'BOS', location: { lat: 0, lon: 0 } },
          scheduledTime: { utc: '2026-02-11 13:12Z', local: '2026-02-11 08:12-05:00' },
          runwayTime: { utc: '2026-02-11 13:26Z', local: '2026-02-11 08:26-05:00' },
        },
      })
    )
    expect(d.depDelayMin).toBe(14)
    expect(d.depTime).toBe('08:26') // actual/effective departure
    expect(d.schedDep).toBe('08:12') // scheduled "was" anchor
  })

  it('flags "Delayed" past the 15-min threshold and suppresses delayString for API "Delayed" status', () => {
    const arr = (schedUtc: string, runwayUtc: string) => ({
      airport: { name: 'San Francisco Intl', iata: 'SFO', location: { lat: 0, lon: 10 } },
      scheduledTime: { utc: schedUtc, local: '2026-02-11 06:00-08:00' },
      runwayTime: { utc: runwayUtc, local: '2026-02-11 06:30-08:00' },
    })
    // 30 min late arrival -> Delayed
    const late = buildFlightDisplayData(makeFlight({ arrival: arr('2026-02-11 14:00Z', '2026-02-11 14:30Z') }))
    expect(late.delayMin).toBe(30)
    expect(late.delayString).toBe('Delayed')

    // API 'Delayed' phase -> delayString suppressed (no "Delayed · Delayed")
    const apiDelayed = buildFlightDisplayData(
      makeFlight({ status: 'Delayed', location: undefined, arrival: arr('2026-02-11 14:00Z', '2026-02-11 14:30Z') })
    )
    expect(apiDelayed.status).toBe('Delayed')
    expect(apiDelayed.delayString).toBeNull()
  })

  it('leaves delay null when there is no scheduled or effective arrival time', () => {
    // scheduledTime alone is not enough — it is excluded from the effective chain
    const d = buildFlightDisplayData(
      makeFlight({
        arrival: {
          airport: { name: 'San Francisco Intl', iata: 'SFO', location: { lat: 0, lon: 10 } },
          scheduledTime: { utc: '2026-02-11 14:36Z', local: '2026-02-11 06:36-08:00' },
        },
      })
    )
    expect(d.delayMin).toBeNull()
  })

  // The real scenario the fallback tiles target: airborne but no position feed. Exercises the
  // time-based progress path (no GPS) and the minsRemaining computation.
  it('handles an in-flight flight with no telemetry (In Flight, time-based progress, remaining mins)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-11T11:24:00Z')) // halfway through an 08:12Z–14:36Z flight
    try {
      const d = buildFlightDisplayData(
        makeFlight({
          status: 'EnRoute',
          location: undefined,
          departure: {
            airport: { name: 'Boston Logan', iata: 'BOS', location: { lat: 0, lon: 0 } },
            runwayTime: { utc: '2026-02-11 08:12Z', local: '2026-02-11 08:12-05:00' },
          },
          arrival: {
            airport: { name: 'San Francisco Intl', iata: 'SFO', location: { lat: 0, lon: 10 } },
            scheduledTime: { utc: '2026-02-11 14:36Z', local: '2026-02-11 06:36-08:00' },
          },
        })
      )
      expect(d.status).toBe('In Flight') // no location -> unrefined API status
      expect(d.altitudeFt).toBe('--')
      expect(d.speedMph).toBe('--')
      expect(d.heading).toBe('--')
      expect(d.progressPct).toBe(50) // elapsed 3h12m of a 6h24m flight
      expect(d.minsRemaining).toBe(192) // 14:36 - 11:24
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a pre-flight flight with no telemetry as 0% and no live stats', () => {
    const d = buildFlightDisplayData(makeFlight({ status: 'Boarding', location: undefined }))
    expect(d.status).toBe('Boarding')
    expect(d.progressPct).toBe(0)
    expect(d.altitudeFt).toBe('--')
    expect(d.speedMph).toBe('--')
    expect(d.heading).toBe('--')
  })
})
