import { describe, it, expect } from 'vitest'
import {
  AIRLINE_NAMES,
  calcProgress,
  formatDelayString,
  formatDuration,
  formatHeading,
  haversineKm,
} from '../../../src/integrations/aerodatabox/formatters.js'

describe('formatHeading', () => {
  it('returns -- when track is undefined', () => {
    expect(formatHeading(undefined)).toBe('--')
  })

  it('maps cardinal directions correctly', () => {
    expect(formatHeading(0)).toBe('0° N')
    expect(formatHeading(45)).toBe('45° NE')
    expect(formatHeading(90)).toBe('90° E')
    expect(formatHeading(180)).toBe('180° S')
    expect(formatHeading(270)).toBe('270° W')
  })

  it('rounds the degrees and snaps to the nearest of 8 cardinals', () => {
    // 251° -> nearest cardinal index round(251/45)=6 -> W (matches device render)
    expect(formatHeading(251)).toBe('251° W')
  })

  it('wraps 360 back to 0/N', () => {
    expect(formatHeading(360)).toBe('0° N')
  })
})

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(0, 0, 0, 0)).toBe(0)
  })

  it('measures ~111km per degree of longitude at the equator', () => {
    const d = haversineKm(0, 0, 0, 1)
    expect(d).toBeGreaterThan(111)
    expect(d).toBeLessThan(112)
  })

  it('approximates a known long-haul distance (BOS->SFO ~4300km)', () => {
    const d = haversineKm(42.3656, -71.0096, 37.6189, -122.375)
    expect(d).toBeGreaterThan(4200)
    expect(d).toBeLessThan(4400)
  })
})

describe('calcProgress', () => {
  it('returns null when the aircraft position is unknown', () => {
    expect(calcProgress(undefined, undefined, 0, 0, 0, 10)).toBeNull()
  })

  it('returns null when an airport coordinate is missing', () => {
    expect(calcProgress(0, 5, undefined, 0, 0, 10)).toBeNull()
  })

  it('returns 0 at the departure airport and ~50 at the midpoint', () => {
    expect(calcProgress(0, 0, 0, 0, 0, 10)).toBe(0)
    expect(calcProgress(0, 5, 0, 0, 0, 10)).toBe(50)
  })

  it('cap progress to 100', () => {
    expect(calcProgress(0, 20, 0, 0, 0, 10)).toBe(100)
  })

  it('returns null when the airports are effectively co-located', () => {
    expect(calcProgress(0, 0, 0, 0, 0, 0.000001)).toBeNull()
  })
})

describe('formatDuration', () => {
  it('formats minutes-only under an hour', () => {
    expect(formatDuration(45)).toBe('45m')
  })

  it('formats hours and minutes past an hour', () => {
    expect(formatDuration(138)).toBe('2h 18m')
    expect(formatDuration(372)).toBe('6h 12m')
  })

  it('reads as "Arriving" once at/past the ETA', () => {
    expect(formatDuration(0)).toBe('Arriving')
    expect(formatDuration(-5)).toBe('Arriving')
  })
})

describe('formatDelayString', () => {
  it('returns null when the delay is unknown', () => {
    expect(formatDelayString(null)).toBeNull()
  })

  it('treats within +/-15 min as "On time" (incl. minor delays)', () => {
    expect(formatDelayString(0)).toBe('On time')
    expect(formatDelayString(12)).toBe('On time')
    expect(formatDelayString(15)).toBe('On time')
    expect(formatDelayString(-15)).toBe('On time')
  })

  it('flags "Delayed" past 15 min late and "Early" past 15 min ahead', () => {
    expect(formatDelayString(16)).toBe('Delayed')
    expect(formatDelayString(95)).toBe('Delayed')
    expect(formatDelayString(-16)).toBe('Early')
  })
})

describe('AIRLINE_NAMES', () => {
  it('resolves common IATA codes to display names', () => {
    expect(AIRLINE_NAMES.UA).toBe('United Airlines')
    expect(AIRLINE_NAMES.AA).toBe('American Airlines')
    expect(AIRLINE_NAMES.DL).toBe('Delta Air Lines')
  })
})
