import { describe, it, expect } from 'vitest'
import { renderMarkup } from '../../../src/integrations/aerodatabox/renderer.js'
import type { FlightDisplayData } from '../../../src/types/trmnl/flightTypes.js'

// A live, on-schedule in-flight sample; spread + override per test.
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
  delayString: null,
  depTime: '08:12',
  schedDep: '08:12',
  depDelayMin: 0,
  eta: '14:36',
  schedEta: '14:36',
  delayMin: null,
  minsToDeparture: null,
  minsRemaining: 138,
  progressPct: 62,
  lastUpdated: 'recently',
}

describe('renderMarkup', () => {
  it('renders the empty-state prompt when there are no flights', () => {
    const out = renderMarkup(null, 'full', 0, 'https://example.com')
    expect(out).toContain('Configure flights')
    expect(out).toContain('Flight Tracker')
  })

  it('renders the full variant with a hero arc and stat tiles', () => {
    const out = renderMarkup(sampleFlight, 'full', 0, 'https://example.com')
    expect(out).toContain('view--full')
    expect(out).toContain('<svg') // great-circle arc
    expect(out).toContain('UA 1074') // formatted flight code
    expect(out).toContain('United Airlines')
    expect(out).toContain('BOS')
    expect(out).toContain('SFO')
    expect(out).toContain('stat-tile')
  })

  it('renders the flat route line with solid-flown / dotted-remaining on half_horizontal', () => {
    const out = renderMarkup(sampleFlight, 'half_horizontal', 0, 'https://example.com')
    expect(out).toContain('view--half_horizontal')
    // assert on element usage, not the (always-present) CSS rule of the same name
    expect(out).toContain('class="route-line route-line-flown"')
    expect(out).toContain('class="route-line route-line-remaining"')
  })

  it('marks both route segments dotted when progress is unknown', () => {
    const out = renderMarkup({ ...sampleFlight, progressPct: null }, 'half_horizontal', 0, 'https://example.com')
    expect(out).not.toContain('class="route-line route-line-flown"')
    expect(out).toContain('class="route-line route-line-remaining"')
  })

  it('full variant tiles carry only live telemetry (no delay tile); delay lives in the arc anchor', () => {
    const out = renderMarkup({ ...sampleFlight, delayMin: 14, schedEta: '14:22' }, 'full', 0, 'https://example.com')
    expect(out).toContain('>ALT<')
    expect(out).toContain('>SPD<')
    expect(out).toContain('>HDG<')
    expect(out).not.toContain('>ARR<') // no delay tile
    expect(out).not.toContain('14m late') // no worded delta
    expect(out).toContain('was 14:22') // scheduled anchor on the arc
  })

  it('falls back to derived time-left + trip tiles when there is no live telemetry (no row of --)', () => {
    const preFlight = {
      ...sampleFlight,
      status: 'Boarding',
      altitudeFt: '--',
      speedMph: '--',
      heading: '--',
      minsRemaining: 372,
      progressPct: 0,
    }
    const out = renderMarkup(preFlight, 'full', 0, 'https://example.com')
    expect(out).not.toContain('>ALT<') // live-telemetry tiles gone
    expect(out).toContain('>ARRIVING IN<')
    expect(out).toContain('6h 12m')
    expect(out).toContain('>TRIP<')
    expect(out).toContain('0%')
    expect(out).not.toContain('>--<') // never a bare -- tile value
  })

  it('centers header + arc (no tiles) only when neither telemetry nor progress data exists', () => {
    const errorState = {
      ...sampleFlight,
      status: 'Data unavailable',
      altitudeFt: '--',
      speedMph: '--',
      heading: '--',
      minsRemaining: null,
      progressPct: null,
    }
    const out = renderMarkup(errorState, 'full', 0, 'https://example.com')
    expect(out).not.toContain('stat-tile"') // no tile elements at all
    expect(out).toContain('flight-card--compact')
  })

  it('stacks dep/arr times under the airport codes on half variants (not as duplicate stats)', () => {
    const out = renderMarkup(sampleFlight, 'half_vertical', 0, 'https://example.com')
    expect(out).toContain('route-end')
    expect(out).toContain('route-time')
    expect(out).toContain('08:12') // departure under BOS
    expect(out).toContain('14:36') // arrival under SFO
    // times are no longer echoed as ETA:/DEP: stat rows
    expect(out).not.toContain('ETA:')
    expect(out).not.toContain('DEP:')
  })

  it('renders the plane as an SVG silhouette rather than the engine-heavy ✈ glyph', () => {
    const full = renderMarkup(sampleFlight, 'full', 0, 'https://example.com')
    const half = renderMarkup(sampleFlight, 'half_vertical', 0, 'https://example.com')
    expect(full).not.toContain('✈')
    expect(half).not.toContain('✈')
    expect(half).toContain('plane-icon') // inline SVG on the flat route line
  })

  it('shows the scheduled "was" anchor (two absolute clocks) only when the flight deviates', () => {
    // assert on the rendered anchor text, not the (always-present) .route-sched CSS rule
    // late: actual 14:36, scheduled 14:22
    const late = renderMarkup({ ...sampleFlight, delayMin: 14, schedEta: '14:22' }, 'half_vertical', 0, 'https://example.com')
    expect(late).toContain('>was 14:22<')
    expect(late).not.toContain('14m late') // no delta / no math

    // early: actual 14:36, scheduled 14:48 — still an absolute clock, no negative delta / word
    const early = renderMarkup({ ...sampleFlight, delayMin: -12, schedEta: '14:48' }, 'half_vertical', 0, 'https://example.com')
    expect(early).toContain('>was 14:48<')
    expect(early).not.toContain('early')

    // on-time (within window): no anchor even though schedEta is present
    const onTime = renderMarkup({ ...sampleFlight, delayMin: 1, schedEta: '14:35' }, 'half_vertical', 0, 'https://example.com')
    expect(onTime).not.toContain('>was ')
    // unknown schedule: no anchor
    const unknown = renderMarkup({ ...sampleFlight, delayMin: null, schedEta: '--' }, 'half_vertical', 0, 'https://example.com')
    expect(unknown).not.toContain('>was ')
  })

  it('anchors departure and arrival independently (a late pushback shows "was" under the origin)', () => {
    // Departed 14 late, arrived on time (made up the time en route): only the origin gets an anchor.
    const depLate = { ...sampleFlight, depDelayMin: 14, schedDep: '07:58', delayMin: 0, schedEta: '14:36' }
    const full = renderMarkup(depLate, 'full', 0, 'https://example.com')
    expect(full).toContain('was 07:58') // origin anchor
    expect(full).not.toContain('was 14:36') // arrival on time -> no anchor
    const half = renderMarkup(depLate, 'half_vertical', 0, 'https://example.com')
    expect(half).toContain('>was 07:58<')

    // Both deviate -> both anchors render.
    const both = { ...sampleFlight, depDelayMin: 14, schedDep: '07:58', delayMin: 14, schedEta: '14:22' }
    const bothOut = renderMarkup(both, 'half_vertical', 0, 'https://example.com')
    expect(bothOut).toContain('>was 07:58<')
    expect(bothOut).toContain('>was 14:22<')

    // Opposite directions (late pushback, early arrival) both anchor — the "was" is an absolute
    // clock, so the sign of each delay is irrelevant to the display.
    const mixed = { ...sampleFlight, depDelayMin: 14, schedDep: '07:58', delayMin: -10, schedEta: '14:46' }
    const mixedOut = renderMarkup(mixed, 'full', 0, 'https://example.com')
    expect(mixedOut).toContain('was 07:58') // late departure
    expect(mixedOut).toContain('was 14:46') // early arrival
  })

  it('shows the on-time verdict as the 4th full-card tile (label-less), and hides it when unknown', () => {
    // assert on the tile element, not the always-present .stat-tile--status CSS rule
    const delayed = renderMarkup({ ...sampleFlight, delayString: 'Delayed' }, 'full', 0, 'https://example.com')
    expect(delayed).toContain('class="stat-tile stat-tile--status"')
    expect(delayed).toContain('>Delayed<')
    expect(delayed).toContain('>ALT<') // sits alongside the telemetry tiles
    // unknown -> no status tile
    const unknown = renderMarkup({ ...sampleFlight, delayString: null }, 'full', 0, 'https://example.com')
    expect(unknown).not.toContain('class="stat-tile stat-tile--status"')
  })

  it('does not surface delayString on half variants (the "was" anchors carry the delay there)', () => {
    const out = renderMarkup({ ...sampleFlight, delayString: 'Delayed' }, 'half_horizontal', 0, 'https://example.com')
    expect(out).not.toContain('>Delayed<')
    expect(out).not.toContain('class="stat-tile stat-tile--status"')
  })

  it('counts down to departure (DEPARTS IN) pre-takeoff, then to arrival (ARRIVING IN)', () => {
    const noTelemetry = { ...sampleFlight, altitudeFt: '--', speedMph: '--', heading: '--' }
    // pre-departure: minsToDeparture positive -> DEPARTS IN, using the departure countdown
    const preDep = renderMarkup({ ...noTelemetry, status: 'Boarding', minsToDeparture: 45 }, 'full', 0, 'https://example.com')
    expect(preDep).toContain('>DEPARTS IN<')
    expect(preDep).toContain('45m')
    expect(preDep).not.toContain('>ARRIVING IN<')

    // airborne (no departure countdown left): ARRIVING IN, using minsRemaining
    const airborne = renderMarkup(
      { ...noTelemetry, status: 'In Flight', minsToDeparture: -20, minsRemaining: 140 },
      'full',
      0,
      'https://example.com'
    )
    expect(airborne).toContain('>ARRIVING IN<')
    expect(airborne).toContain('2h 20m')
    expect(airborne).not.toContain('>DEPARTS IN<')

    // half variants use the terse DEP IN / ARR IN labels
    const halfPre = renderMarkup({ ...noTelemetry, status: 'Boarding', minsToDeparture: 45 }, 'half_vertical', 0, 'https://example.com')
    expect(halfPre).toContain('DEP IN:')
  })

  it('shows ARRIVED (landing time) instead of a stale "Arriving" countdown once the flight has landed', () => {
    // Regression: an Arrived flight has no telemetry but still carries progressPct/minsRemaining,
    // so the fallback branch used to render "ARRIVING IN / Arriving" for a flight that landed hours ago.
    const arrived = {
      ...sampleFlight,
      status: 'Arrived',
      altitudeFt: '--',
      speedMph: '--',
      heading: '--',
      progressPct: 100,
      minsRemaining: -312, // arrived ~5h ago -> formatDuration would say "Arriving"
      eta: '14:54',
    }
    const full = renderMarkup(arrived, 'full', 0, 'https://example.com')
    expect(full).toContain('>ARRIVED<')
    expect(full).toContain('>14:54<') // the actual landing time, not a countdown
    expect(full).not.toContain('>ARRIVING IN<')
    expect(full).not.toContain('>Arriving<')
    expect(full).toContain('>TRIP<') // trip tile still shows completion alongside it

    // half variants use the same terminal label, not the ARR IN countdown
    const half = renderMarkup(arrived, 'half_horizontal', 0, 'https://example.com')
    expect(half).toContain('ARRIVED:')
    expect(half).not.toContain('ARR IN:')

    // the inferred "Likely Arrived" state is treated the same
    const likely = renderMarkup({ ...arrived, status: 'Likely Arrived' }, 'full', 0, 'https://example.com')
    expect(likely).toContain('>ARRIVED<')
    expect(likely).not.toContain('>Arriving<')
  })

  it('escapes HTML in the last-updated label', () => {
    const out = renderMarkup({ ...sampleFlight, lastUpdated: '<script>' }, 'full', 0, 'https://example.com')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })
})
