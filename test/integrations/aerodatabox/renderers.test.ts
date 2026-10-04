import { describe, it, expect } from 'vitest'
import { renderMarkup } from '../../../src/integrations/aerodatabox/renderer.js'
import type { FlightDisplayData } from '../../../src/types/aerodatabox/types.js'

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

  it('renders the full variant with a hero arc and a single info row (no stat cards)', () => {
    const out = renderMarkup(sampleFlight, 'full', 0, 'https://example.com')
    expect(out).toContain('view--full')
    expect(out).toContain('<svg') // great-circle arc
    expect(out).toContain('UA 1074') // formatted flight code
    expect(out).toContain('United Airlines')
    expect(out).toContain('BOS')
    expect(out).toContain('SFO')
    expect(out).toContain('class="flight-info"')
    expect(out).not.toContain('class="stat-tile') // bordered tiles are gone
  })

  it('renders the flat route line with solid-flown / gray-remaining in flight on half_horizontal', () => {
    const out = renderMarkup(sampleFlight, 'half_horizontal', 0, 'https://example.com')
    expect(out).toContain('view--half_horizontal')
    // assert on element usage, not the (always-present) CSS rule of the same name
    expect(out).toContain('class="route-line route-line-flown"')
    expect(out).toContain('class="route-line route-line-remaining route-line--airborne"')
  })

  it('keeps the remaining route dotted before departure', () => {
    const pre = { ...sampleFlight, progressPct: 0, minsToDeparture: 30 }
    expect(renderMarkup(pre, 'half_horizontal', 0, 'https://example.com')).toContain('class="route-line route-line-remaining"')
    expect(renderMarkup(pre, 'full', 0, 'https://example.com')).toContain('stroke-dasharray')
    const mid = renderMarkup(sampleFlight, 'full', 0, 'https://example.com')
    expect(mid).toContain('stroke="#888"')
    expect(mid).not.toContain('stroke-dasharray')
  })

  it('uses the remaining style on both sides when progress is unknown', () => {
    const out = renderMarkup({ ...sampleFlight, progressPct: null }, 'half_horizontal', 0, 'https://example.com')
    expect(out).not.toContain('class="route-line route-line-flown"')
    expect(out.match(/class="route-line route-line-remaining route-line--airborne"/g)).toHaveLength(2)
  })

  it('leads the info row with the arrival countdown and trails live telemetry as secondary text', () => {
    const out = renderMarkup(sampleFlight, 'full', 0, 'https://example.com')
    expect(out).toContain('>ARRIVING IN<')
    expect(out).toContain('2h 18m')
    expect(out).toContain('class="info-telemetry">37,000 ft · 503 mph · 251° W<')
    // half variants drop heading to save width
    const half = renderMarkup(sampleFlight, 'half_vertical', 0, 'https://example.com')
    expect(half).toContain('37,000 ft · 503 mph<')
    expect(half).not.toContain('251° W')
  })

  it('hides telemetry when it is not meaningful (on the ground, landed, or unknown readings)', () => {
    const ground = renderMarkup({ ...sampleFlight, status: 'On Ground', altitudeFt: 'Ground', speedMph: '12' }, 'full', 0, 'https://example.com')
    expect(ground).not.toContain('class="info-telemetry"')
    const landed = renderMarkup({ ...sampleFlight, status: 'Arrived', minsRemaining: -30 }, 'full', 0, 'https://example.com')
    expect(landed).not.toContain('class="info-telemetry"')
    // a partial reading drops the unknown parts instead of printing --
    const partial = renderMarkup({ ...sampleFlight, speedMph: '--', heading: '--' }, 'full', 0, 'https://example.com')
    expect(partial).toContain('class="info-telemetry">37,000 ft<')
  })

  it('keeps the same structure with and without telemetry (no TRIP card, no row of --)', () => {
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
    expect(out).toContain('class="flight-info"') // same info row as the in-flight leg
    expect(out).toContain('>ARRIVING IN<')
    expect(out).toContain('6h 12m')
    expect(out).not.toContain('class="info-telemetry"')
    expect(out).not.toContain('TRIP')
    expect(out).not.toContain('>--<')
  })

  it('labels the arc with completion % only mid-flight', () => {
    const mid = renderMarkup(sampleFlight, 'full', 0, 'https://example.com')
    expect(mid).toContain('>62%</tspan><tspan font-weight="600"> flown</tspan>')
    const pre = renderMarkup({ ...sampleFlight, progressPct: 0, minsToDeparture: 30 }, 'full', 0, 'https://example.com')
    expect(pre).not.toContain('class="arc-pct"')
    const done = renderMarkup({ ...sampleFlight, status: 'Arrived', progressPct: 100 }, 'full', 0, 'https://example.com')
    expect(done).not.toContain('class="arc-pct"')
  })

  it('drops the info row only when there is neither a countdown nor telemetry', () => {
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
    expect(out).not.toContain('class="flight-info"')
  })

  it('leads with the logo, and left-aligns the header when there is no logo to balance it', () => {
    const withLogo = renderMarkup(sampleFlight, 'full', 0, 'https://example.com')
    expect(withLogo).toContain('/public/radarbox_banners/UAL.png')
    expect(withLogo).not.toContain('class="flight-top flight-top--no-logo"')
    const noLogo = renderMarkup({ ...sampleFlight, airlineIcao: '' }, 'full', 0, 'https://example.com')
    expect(noLogo).not.toContain('<img')
    expect(noLogo).toContain('class="flight-top flight-top--no-logo"')
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

  it('spells out notable (>15 min) deviations as an explicit delay amount plus the scheduled time', () => {
    const late = renderMarkup({ ...sampleFlight, delayMin: 22, schedEta: '14:14' }, 'full', 0, 'https://example.com')
    expect(late).toContain('>22m late<')
    expect(late).toContain('>sched 14:14<')

    const early = renderMarkup({ ...sampleFlight, delayMin: -20, schedEta: '14:56' }, 'half_vertical', 0, 'https://example.com')
    expect(early).toContain('>20m early<')
    expect(early).toContain('>sched 14:56<')

    const long = renderMarkup({ ...sampleFlight, delayMin: 95, schedEta: '13:01' }, 'full', 0, 'https://example.com')
    expect(long).toContain('>1h 35m late<')

    // minor deviations stay inside the on-time window: no callout (matches the "On time" verdict)
    const minor = renderMarkup({ ...sampleFlight, delayMin: 10, schedEta: '14:26' }, 'full', 0, 'https://example.com')
    expect(minor).not.toContain('m late<')
    expect(minor).not.toContain('>sched ')

    // unknown schedule: no callout
    const unknown = renderMarkup({ ...sampleFlight, delayMin: 40, schedEta: '--' }, 'full', 0, 'https://example.com')
    expect(unknown).not.toContain('m late<')
  })

  it('fits the deviation to each variant (stacked / inline / delta-only on quadrant)', () => {
    const late = { ...sampleFlight, delayMin: 22, schedEta: '14:14' }
    expect(renderMarkup(late, 'half_horizontal', 0, 'https://example.com')).toContain('22m late <span class="route-dim">· sched 14:14</span>')
    const quad = renderMarkup(late, 'quadrant', 0, 'https://example.com')
    expect(quad).toContain('>22m late<')
    expect(quad).not.toContain('sched 14:14')
  })

  it('calls out departure and arrival deviations independently', () => {
    // Departed 26 late but arriving only 10 early: origin gets the callout, arrival doesn't.
    const mixed = { ...sampleFlight, depDelayMin: 26, schedDep: '07:46', delayMin: -10, schedEta: '14:46' }
    const out = renderMarkup(mixed, 'full', 0, 'https://example.com')
    expect(out).toContain('>26m late<')
    expect(out).toContain('>sched 07:46<')
    expect(out).not.toContain('sched 14:46')
  })

  it('shows the on-time verdict in the header status line, and hides it when unknown', () => {
    const delayed = renderMarkup({ ...sampleFlight, delayString: 'Delayed' }, 'full', 0, 'https://example.com')
    expect(delayed).toContain('class="flight-adherence"')
    expect(delayed).toContain('Delayed')
    const unknown = renderMarkup({ ...sampleFlight, delayString: null }, 'full', 0, 'https://example.com')
    expect(unknown).not.toContain('class="flight-adherence"')
  })

  it('does not surface delayString on half variants (the "was" anchors carry the delay there)', () => {
    const out = renderMarkup({ ...sampleFlight, delayString: 'Delayed' }, 'half_horizontal', 0, 'https://example.com')
    expect(out).not.toContain('flight-adherence')
    expect(out).not.toContain('Delayed') // status is 'Cruising'; adherence never rendered on halves
  })

  it('counts down to departure (DEPARTS IN) pre-takeoff, then to arrival (ARRIVING IN)', () => {
    const noTelemetry = { ...sampleFlight, altitudeFt: '--', speedMph: '--', heading: '--' }
    const preDep = renderMarkup({ ...noTelemetry, status: 'Boarding', minsToDeparture: 45 }, 'full', 0, 'https://example.com')
    expect(preDep).toContain('>DEPARTS IN<')
    expect(preDep).toContain('45m')
    expect(preDep).not.toContain('>ARRIVING IN<')
    expect(preDep).not.toContain('class="info-primary info-primary--past"')

    const airborne = renderMarkup(
      { ...noTelemetry, status: 'In Flight', minsToDeparture: -20, minsRemaining: 140 },
      'full',
      0,
      'https://example.com'
    )
    expect(airborne).toContain('>ARRIVING IN<')
    expect(airborne).toContain('2h 20m')
    expect(airborne).not.toContain('>DEPARTS IN<')

    // half variants have room for the full labels too
    const halfPre = renderMarkup({ ...noTelemetry, status: 'Boarding', minsToDeparture: 45 }, 'half_vertical', 0, 'https://example.com')
    expect(halfPre).toContain('>DEPARTS IN<')
    expect(halfPre).not.toContain('DEP IN<')
  })

  it('shows ARRIVED (how long ago) instead of a stale "Arriving" countdown once the flight has landed', () => {
    // Regression: an Arrived flight still carries progressPct/minsRemaining, so the countdown
    // used to render "ARRIVING IN / Arriving" for a flight that landed hours ago.
    const arrived = {
      ...sampleFlight,
      status: 'Arrived',
      altitudeFt: '--',
      speedMph: '--',
      heading: '--',
      progressPct: 100,
      minsRemaining: -312,
      eta: '14:54',
    }
    const full = renderMarkup(arrived, 'full', 0, 'https://example.com')
    expect(full).toContain('>ARRIVED<')
    expect(full).toContain('>5h 12m ago<')
    expect(full).toContain('class="info-primary info-primary--past"') // historical -> rendered quieter than a live countdown
    expect(full).toContain('>14:54<') // landing clock stays under the arrival airport
    expect(full).not.toContain('>ARRIVING IN<')
    expect(full).not.toContain('>Arriving<')

    const half = renderMarkup(arrived, 'half_horizontal', 0, 'https://example.com')
    expect(half).toContain('>ARRIVED<')
    expect(half).not.toContain('ARRIVING IN')

    const likely = renderMarkup({ ...arrived, status: 'Likely Arrived' }, 'full', 0, 'https://example.com')
    expect(likely).toContain('>ARRIVED<')
    expect(likely).not.toContain('>Arriving<')

    // no countdown data: fall back to the landing clock
    const noCountdown = renderMarkup({ ...arrived, minsRemaining: null }, 'full', 0, 'https://example.com')
    expect(noCountdown).toContain('class="info-value">14:54<')
  })

  it('escapes HTML in the last-updated label', () => {
    const out = renderMarkup({ ...sampleFlight, lastUpdated: '<script>' }, 'full', 0, 'https://example.com')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })
})
