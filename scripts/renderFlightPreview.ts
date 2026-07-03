// This is a helper script to generate mock HTML representative of TRMNL devices.
// It should generate all forms, including TRMNL X dimensions
// This test is powered by Claude, thanks buddy
import { renderMarkup } from '../src/integrations/aerodatabox/renderer.js'
import { formatDelayString } from '../src/integrations/aerodatabox/formatters.js'
import { writeFileSync } from "node:fs"; // ignore typecheck error, typelinting is fine via CI
import { config } from '../src/config.js'
import type { FlightDisplayData } from "../src/types/trmnl/flightTypes.js";
import type { MarkupVariant } from "../src/types/trmnl/types.js";

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
  aircraftIcao: '',
  heading: '251° W',
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
// the "was" anchors (notable deviations >15 min only), and the no-telemetry fallback (departs-in / arrives-in).
// eta/depTime are the actual times; schedEta/schedDep are the originals. adherence is derived below.
type Scenario = { title: string; flight: FlightDisplayData }
const scenarios: Scenario[] = [
  { title: 'On time (0)', flight: { ...baseFlight, delayMin: 0, schedEta: '14:36' } },
  {
    title: 'Minor delay — 12 min (On time, no anchor: under the 15-min gate)',
    flight: { ...baseFlight, depDelayMin: 12, schedDep: '08:00', delayMin: 12, schedEta: '14:24' },
  },
  {
    title: 'Delayed — 35 min (was 07:32 / 14:01)',
    flight: { ...baseFlight, depDelayMin: 35, schedDep: '07:37', delayMin: 35, schedEta: '14:01' },
  },
  {
    title: 'Heavily delayed — 95 min (was 06:37 / 13:01)',
    flight: { ...baseFlight, depDelayMin: 95, schedDep: '06:37', delayMin: 95, schedEta: '13:01' },
  },
  {
    title: 'Early — arrives 22 min ahead (was 14:58)',
    flight: { ...baseFlight, delayMin: -22, schedEta: '14:58' },
  },
  {
    title: 'Late departure (20), early arrival (22) — both notable, both anchor',
    flight: { ...baseFlight, depDelayMin: 20, schedDep: '07:52', delayMin: -22, schedEta: '14:58' },
  },
  {
    title: 'Departed 26 late, arriving 10 early — origin anchors, arrival under the gate (On time)',
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
    title: 'In flight, no telemetry (ARRIVING IN + TRIP, mid-route)',
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
    title: 'Arrived, no telemetry (ARRIVED landing time, not a stale "Arriving")',
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
    title: 'Pre-flight, no live data (DEPARTS IN + TRIP)',
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
]

// Derive the on-time verdict the same way the app does, so the preview stays honest.
for (const s of scenarios) s.flight.delayString = formatDelayString(s.flight.delayMin)

const SIZES: Record<string, [number, number]> = {
  full:            [800, 480],
  half_horizontal: [800, 240],
  half_vertical:   [400, 480],
  quadrant:        [400, 240],
}

const xSIZES: Record<string, [number, number]> = {
  full:            [1040, 780],
  half_horizontal: [1040, 390],
  half_vertical:   [520,  780],
  quadrant:        [520,  390],
}

const FRAMEWORK_CSS = 'https://trmnl.com/css/latest/plugins.css'
const FRAMEWORK_JS = 'https://trmnl.com/js/latest/plugins.js'

/**
 * Each variant is slotted into its own iframe so style overrides don't mash with each other
 * This method gets consumed by generateVariant()
 *
 * @param fragment   The markup fragment from renderMarkup
 * @param variant    The plugin display variant
 * @param w          screen width (full device size, or mashup-slot size per variant)
 * @param h          screen height, see note above
 * @param screenClass framework device class(es): `screen--og` or `screen--v2 screen--lg`
 */
function variantDoc(fragment: string, variant: string, w: number, h: number, screenClass: string): string {
  return `<!doctype html><html><head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${FRAMEWORK_CSS}" />
    <script src="${FRAMEWORK_JS}"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet">
    <style>
      html, body { margin:0; }
      .screen { transform:none !important; margin:0 !important; box-sizing:border-box; border:1px solid #000; }
    </style>
  </head><body class="environment trmnl">
    <div class="screen ${screenClass}" style="width:${w}px;height:${h}px">
      <div class="view view--${variant}">${fragment}</div>
    </div>
  </body></html>`
}

/**
 * Wrap a variant document in a captioned, sized iframe for the gallery page.
 */
function generateVariant(fragment: string, variant: string, w: number, h: number, screenClass: string): string {
  console.log(`Generating variant ${variant} (${screenClass})`)
  const label = `${variant} (${screenClass}) — ${w}×${h}`
  const doc = variantDoc(fragment, variant, w, h, screenClass).replaceAll('"', '&quot;')
  return `<figure style="margin:0">
    <figcaption style="font:12px monospace;color:#555;margin-bottom:6px">${label}</figcaption>
    <iframe srcdoc="${doc}" width="${w}" height="${h}" style="border:0;display:block" scrolling="no"></iframe>
  </figure>`
}

function generatePage(sectionsHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    body { margin:24px; background:#e9e9ee; font-family: system-ui, -apple-system, sans-serif; }
    .grid { display:flex; flex-wrap:wrap; gap:22px; align-items:flex-start; }
    section { margin-bottom:40px; }
    h2 { color:#1a1a1a; font-size:18px; margin:0 0 14px; border-bottom:2px solid #bbb; padding-bottom:6px; }
  </style></head><body>${sectionsHtml}</body></html>`
}


const baseUrl = new URL(config.auth.mcpServerUrl).origin
const variants = ['full', 'half_horizontal', 'half_vertical', 'quadrant'] as MarkupVariant[]

// Render every variant for both OG and TRMNL X for a single flight.
function renderScenarioGrid(flight: FlightDisplayData): string {
  const og = variants.map(v => {
    const [w, h] = SIZES[v]
    return generateVariant(renderMarkup(flight, v, 0, baseUrl), v, w, h, 'screen--og')
  }).join('')
  const x = variants.map(v => {
    const [w, h] = xSIZES[v]
    return generateVariant(renderMarkup(flight, v, 0, baseUrl), v, w, h, 'screen--v2 screen--lg')
  }).join('')
  return og + x
}

const sections = scenarios.map(sc => {
  console.log(`\nScenario: ${sc.title}`)
  return `<section><h2>${sc.title}</h2><div class="grid">${renderScenarioGrid(sc.flight)}</div></section>`
}).join('')

writeFileSync('flight-preview.html', generatePage(sections))
