import { describe, it, expect } from 'vitest'
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

  it('maps terminal and pre-flight states', () => {
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

  it('reads route and airline codes from the contract', () => {
    const d = buildFlightDisplayData(makeFlight())
    expect(d.depAirport).toBe('BOS')
    expect(d.arrAirport).toBe('SFO')
    expect(d.airlineIata).toBe('UA')
    expect(d.airlineIcao).toBe('UAL')
    expect(d.aircraftModel).toBe('Boeing 737 MAX 9')
  })

  // Regression: API sometimes reports altitude in meters only (no .feet). It must be
  // converted to feet, not dropped (which previously surfaced as a bogus "Ground").
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

  it('treats a pre-flight flight with no telemetry as 0% and no live stats', () => {
    const d = buildFlightDisplayData(makeFlight({ status: 'Boarding', location: undefined }))
    expect(d.status).toBe('Boarding')
    expect(d.progressPct).toBe(0)
    expect(d.altitudeFt).toBe('--')
    expect(d.speedMph).toBe('--')
    expect(d.heading).toBe('--')
  })
})
