import { describe, it, expect } from 'vitest'
import { AIRLINE_NAMES, calcProgress, formatHeading, haversineKm, renderMarkup } from '../../../src/integrations/aerodatabox/formatters.js'
import type { FlightDisplayData } from '../../../src/types/trmnl/flightTypes.js'

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

  it('clamps overshoot to 100', () => {
    expect(calcProgress(0, 20, 0, 0, 0, 10)).toBe(100)
  })

  it('returns null when the airports are effectively co-located', () => {
    expect(calcProgress(0, 0, 0, 0, 0, 0.000001)).toBeNull()
  })
})

describe('AIRLINE_NAMES', () => {
  it('resolves common IATA codes to display names', () => {
    expect(AIRLINE_NAMES.UA).toBe('United Airlines')
    expect(AIRLINE_NAMES.AA).toBe('American Airlines')
    expect(AIRLINE_NAMES.DL).toBe('Delta Air Lines')
  })
})

const sampleFlight: FlightDisplayData = {
  flightIata: 'UA1074',
  airlineIata: 'UA',
  airlineIcao: 'UAL',
  depAirport: 'BOS',
  arrAirport: 'SFO',
  status: 'Cruising',
  altitudeFt: '37,000',
  speedMph: '503',
  aircraftModel: 'Boeing 737 MAX 9',
  aircraftIcao: '',
  heading: '251° W',
  depTime: '08:12',
  eta: '14:36',
  progressPct: 62,
  lastUpdated: 'recently',
}

describe('renderMarkup', () => {
  it('renders the empty-state prompt when there are no flights', () => {
    const out = renderMarkup([], 'full', 0, 'https://example.com')
    expect(out).toContain('Configure flights')
    expect(out).toContain('Flight Tracker')
  })

  it('renders the full variant with a hero arc and stat tiles', () => {
    const out = renderMarkup([sampleFlight], 'full', 0, 'https://example.com')
    expect(out).toContain('view--full')
    expect(out).toContain('<svg') // great-circle arc
    expect(out).toContain('UA 1074') // formatted flight code
    expect(out).toContain('United Airlines')
    expect(out).toContain('BOS')
    expect(out).toContain('SFO')
    expect(out).toContain('stat-tile')
  })

  it('renders the flat route line with solid-flown / dotted-remaining on half_horizontal', () => {
    const out = renderMarkup([sampleFlight], 'half_horizontal', 0, 'https://example.com')
    expect(out).toContain('view--half_horizontal')
    // assert on element usage, not the (always-present) CSS rule of the same name
    expect(out).toContain('class="route-line route-line-flown"')
    expect(out).toContain('class="route-line route-line-remaining"')
  })

  it('marks both route segments dotted when progress is unknown', () => {
    const out = renderMarkup([{ ...sampleFlight, progressPct: null }], 'half_horizontal', 0, 'https://example.com')
    expect(out).not.toContain('class="route-line route-line-flown"')
    expect(out).toContain('class="route-line route-line-remaining"')
  })

  it('escapes HTML in the last-updated label', () => {
    const out = renderMarkup([{ ...sampleFlight, lastUpdated: '<script>' }], 'full', 0, 'https://example.com')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })
})
