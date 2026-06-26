import { renderMarkup } from "../src/integrations/aerodatabox/formatters.js";
import { writeFileSync } from "node:fs";
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

/**
 * 
 * @param fragment The markup fragment from renderMarkup
 * @param variant The plugin display variant
 * @param w screen width (useful for TRMNL X or testing on other devices)
 * @param h screen height, see note above
 */
function generateVariant(fragment: string, variant: string, w: number, h: number, screenClass = ''): string {
  const cls = `screen${screenClass ? ` ${screenClass}` : ''}`
  const label = `${variant}${screenClass ? ` (${screenClass})` : ''} — ${w}×${h}`
  return `<figure style="margin:0">
    <figcaption style="font:12px monospace;color:#555;margin-bottom:6px">${label}</figcaption>
    <div class="${cls}" style="width:${w}px;height:${h}px">
      <div class="view view--${variant}">${fragment}</div>
    </div>
  </figure>`
}


function generatePage(generatedVariant: string): string {
  return `<!doctype html><html><head><style>
    body { margin:24px; background:#e9e9ee; }
    .grid { display:flex; flex-wrap:wrap; gap:22px; align-items:flex-start; }
    .screen { box-sizing:border-box; border:1px solid #000; overflow:hidden; display:flex; flex-direction:column; }
    .screen .view, .screen .layout, .screen .columns,
    .screen .column, .screen .markdown { display:flex; flex-direction:column; flex:1; }
  </style></head><body>
    <div class="grid">${generatedVariant}</div>
  </body></html>`
}


const baseUrl = new URL(config.auth.mcpServerUrl).origin

const variants = ['full', 'half_horizontal', 'half_vertical', 'quadrant'] as MarkupVariant[]
const generatedVariants = variants.map(v => {
    const [w, h] = SIZES[v]
    return generateVariant(renderMarkup(sampleFlight, v, 0, baseUrl), v, w, h)
}).join('')

// TRMNL X: full variant on the larger screen (screen--lg drives --s: 1.3)
const xFull = generateVariant(renderMarkup(sampleFlight, 'full', 0, baseUrl), 'full', 1040, 780, 'screen--lg')


writeFileSync('flight-preview.html', generatePage(generatedVariants + xFull))

