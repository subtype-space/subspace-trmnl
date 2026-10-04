// Flight tracker preview scenarios. This test is powered by Claude, thanks buddy
import { formatDelayString } from '../../src/integrations/aerodatabox/formatters.js'
import type { FlightDisplayData } from '../../src/types/aerodatabox/types.js'

// Base in-flight sample; scenarios below override just the fields that matter per case.
const baseFlight: FlightDisplayData = {
  flightIata: 'UA1074',
  airlineIata: 'UA',
  airlineIcao: 'UAL',
  depAirport: 'BOS',
  arrAirport: 'SFO',
  status: 'Cruising',
  altitudeFt: '37,000',
  speedMph: '503',
  aircraftModel: 'Boeing 737 MAX 9',
  heading: '251°',
  delayString: null, // filled per-scenario from delayMin below
  depTime: '08:12',
  schedDep: '08:12',
  depDelayMin: 0,
  eta: '14:36',
  schedEta: '14:36',
  delayMin: 0,
  minsToDeparture: null, // departed (in-flight base); pre-flight scenario overrides
  minsRemaining: 138,
  progressPct: 62,
  lastUpdated: 'recently',
}

// Each scenario exercises a different schedule/data state: the on-time verdict (15-min rule),
// the late/early callouts (notable deviations >15 min only), and the no-telemetry info row (departs-in / arriving-in).
// eta/depTime are the actual times; schedEta/schedDep are the originals. adherence is derived below.
export type Scenario = { title: string; flight: FlightDisplayData }
export const scenarios: Scenario[] = [
  { title: 'On time (0)', flight: { ...baseFlight, delayMin: 0, schedEta: '14:36' } },
  {
    title: 'Minor delay — 12 min (On time, no callout: under the 15-min gate)',
    flight: { ...baseFlight, depDelayMin: 12, schedDep: '08:00', delayMin: 12, schedEta: '14:24' },
  },
  {
    title: 'Delayed — 35 min (35m late · was 07:37 / 14:01)',
    flight: { ...baseFlight, depDelayMin: 35, schedDep: '07:37', delayMin: 35, schedEta: '14:01' },
  },
  {
    title: 'Heavily delayed — 95 min (1h 35m late · was 06:37 / 13:01)',
    flight: { ...baseFlight, depDelayMin: 95, schedDep: '06:37', delayMin: 95, schedEta: '13:01' },
  },
  {
    title: 'Early — arrives 22 min ahead (22m early · was 14:58)',
    flight: { ...baseFlight, delayMin: -22, schedEta: '14:58' },
  },
  {
    title: 'Late departure (20), early arrival (22) — both notable, both called out',
    flight: { ...baseFlight, depDelayMin: 20, schedDep: '07:52', delayMin: -22, schedEta: '14:58' },
  },
  {
    title: 'Departed 26 late, arriving 10 early — origin called out, arrival under the gate (On time)',
    flight: { ...baseFlight, depDelayMin: 26, schedDep: '07:46', depTime: '08:12', delayMin: -10, schedEta: '14:46', eta: '14:36' },
  },
  {
    title: 'Descending into SFO (near arrival)',
    flight: {
      ...baseFlight,
      status: 'Descending',
      altitudeFt: '13,000',
      speedMph: '340',
      progressPct: 92,
      minsRemaining: 18,
      delayMin: 0,
      schedEta: '14:36',
    },
  },
  { title: 'Delay unknown', flight: { ...baseFlight, delayMin: null, schedEta: '--' } },
  {
    title: 'In flight, no telemetry (ARRIVING IN + arc %, mid-route)',
    flight: {
      ...baseFlight,
      status: 'In Flight',
      altitudeFt: '--',
      speedMph: '--',
      heading: '--',
      progressPct: 55,
      minsRemaining: 140, // ~2h 20m to go
      delayMin: 0,
      schedEta: '14:36',
    },
  },
  {
    title: 'Arrived, no telemetry (quiet ARRIVED 5h 12m ago, not a stale "Arriving")',
    flight: {
      ...baseFlight,
      status: 'Arrived',
      altitudeFt: '--',
      speedMph: '--',
      heading: '--',
      progressPct: 100,
      minsRemaining: -312, // landed ~5h ago
      depDelayMin: 13,
      schedDep: '15:45',
      depTime: '15:58',
      delayMin: -56,
      schedEta: '15:50',
      eta: '14:54',
    },
  },
  {
    title: 'Pre-flight, no live data (DEPARTS IN)',
    flight: {
      ...baseFlight,
      status: 'Boarding',
      altitudeFt: '--',
      speedMph: '--',
      heading: '--',
      progressPct: 0,
      minsToDeparture: 45, // departs in 45m
      minsRemaining: 372, // 6h 12m until arrival
      delayMin: null,
      schedEta: '--',
    },
  },
  {
    title: 'Return leg SFO → BOS, pre-flight, departing 40 late (same structure as the outbound leg)',
    flight: {
      ...baseFlight,
      flightIata: 'UA1075',
      depAirport: 'SFO',
      arrAirport: 'BOS',
      status: 'Delayed',
      altitudeFt: '--',
      speedMph: '--',
      heading: '--',
      progressPct: 0,
      depTime: '16:50',
      schedDep: '16:10',
      depDelayMin: 40,
      eta: '01:22',
      schedEta: '00:47',
      delayMin: 35,
      minsToDeparture: 95,
      minsRemaining: 427,
    },
  },
]

// Derive the on-time verdict the same way the app does, so the preview stays honest.
// Mirrors statusMapper: the verdict is dropped when the status already says it (no "Delayed · Delayed").
for (const s of scenarios) {
  const verdict = formatDelayString(s.flight.delayMin)
  s.flight.delayString = ['Delayed', 'Canceled', 'Diverted'].includes(s.flight.status) ? null : verdict
}
