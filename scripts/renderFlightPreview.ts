// This is a helper script to generate mock HTML representative of TRMNL devices.
// It should generate all forms, including TRMNL X dimensions
import { renderMarkup } from "../src/integrations/aerodatabox/formatters.js";
import { writeFileSync } from "node:fs"; // ignore typecheck error, typelinting is fine via CI
import { config } from '../src/config.js'
import type { FlightDisplayData } from "../src/types/trmnl/flightTypes.js";
import type { MarkupVariant } from "../src/integrations/aerodatabox/formatters.js";

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

function generatePage(generatedVariant: string): string {
  return `<!doctype html><html><head><style>
    body { margin:24px; background:#e9e9ee; }
    .grid { display:flex; flex-wrap:wrap; gap:22px; align-items:flex-start; }
  </style></head><body>
    <div class="grid">${generatedVariant}</div>
  </body></html>`
}


const baseUrl = new URL(config.auth.mcpServerUrl).origin

const variants = ['full', 'half_horizontal', 'half_vertical', 'quadrant'] as MarkupVariant[]
console.log('Generating OG TRMNL render')
const generatedVariants = variants.map(v => {
  const [w, h] = SIZES[v]
  return generateVariant(renderMarkup(sampleFlight, v, 0, baseUrl), v, w, h, 'screen--og')
}).join('')


console.log('Generating TRMNL X render')
const generatedXVariants = variants.map(v => {
  const [w, h] = xSIZES[v]
  return generateVariant(renderMarkup(sampleFlight, v, 0, baseUrl), v, w, h, 'screen--v2 screen--lg')
}).join('')


writeFileSync('flight-preview.html', generatePage(generatedVariants + generatedXVariants))
