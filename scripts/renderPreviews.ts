// Generates mock HTML representative of TRMNL devices for every plugin, across all variants
// and both OG/X screen sizes, in one page. Scenario modules (scripts/scenarios/<name>.ts) hold only
// scenario data; this script owns turning each plugin's own scenario shape into rendered markup.
import { writeFileSync } from 'node:fs' // ignore typecheck error, typelinting is fine via CI
import type { MarkupVariant } from '../src/types/trmnl/types.js'
import { config } from '../src/config.js'
import { renderMarkup as renderFlight } from '../src/integrations/aerodatabox/renderer.js'
import { renderMarkup as renderMetro } from '../src/integrations/wmata/renderer.js'
import { scenarios as flightScenarios } from './scenarios/flights.js'
import { scenarios as metroScenarios } from './scenarios/metro.js'

const baseUrl = new URL(config.api.publicBaseUrl).origin


const plugins = [
  {
    title: 'Flight tracker',
    scenarios: flightScenarios.map((sc) => ({
      scenarioTitle: sc.title,
      render: (variant: MarkupVariant) => renderFlight(sc.flight, variant, 0, baseUrl),
    })),
  },
  {
    title: 'DC Metro',
    scenarios: metroScenarios.map((sc) => ({
      scenarioTitle: sc.title,
      render: (variant: MarkupVariant) => renderMetro(sc.markup, variant),
    })),
  },
]

const SIZES: Record<MarkupVariant, [number, number]> = {
  full:            [800, 480],
  half_horizontal: [800, 240],
  half_vertical:   [400, 480],
  quadrant:        [400, 240],
}

const xSIZES: Record<MarkupVariant, [number, number]> = {
  full:            [1040, 780],
  half_horizontal: [1040, 390],
  half_vertical:   [520,  780],
  quadrant:        [520,  390],
}

// The variants to preview. Trim this to render fewer.
const VARIANTS = Object.keys(SIZES) as MarkupVariant[]

const FRAMEWORK_CSS = 'https://trmnl.com/css/latest/plugins.css'
const FRAMEWORK_JS = 'https://trmnl.com/js/latest/plugins.js'

// wraps a plugin's rendered markup in a given variant for both OG and X screen sizes. Wraps into iframe
function generateiFrameForVariant(markup: string, variant: string, w: number, h: number, screenClass: string): string {
  const doc = `<!doctype html><html><head>
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
      <div class="view view--${variant}">${markup}</div>
    </div>
  </body></html>`.replaceAll('"', '&quot;')

  return `<figure style="margin:0">
    <figcaption style="font:12px monospace;color:#555;margin-bottom:6px">${variant} (${screenClass}) — ${w}×${h}</figcaption>
    <iframe srcdoc="${doc}" width="${w}" height="${h}" style="border:0;display:block" scrolling="no"></iframe>
  </figure>`
}

// render a given scenario for all variants in the SIZE array for both OG and X screen sizes
function renderScenario(scenario: { scenarioTitle: string; render: (variant: MarkupVariant) => string }): string {
  console.log(`  Scenario: ${scenario.scenarioTitle}`)
  const og = VARIANTS.map((variant) => {
    const [w, h] = SIZES[variant]
    return generateiFrameForVariant(scenario.render(variant), variant, w, h, 'screen--og')
  }).join('')
  const x = VARIANTS.map((variant) => {
    const [w, h] = xSIZES[variant]
    return generateiFrameForVariant(scenario.render(variant), variant, w, h, 'screen--v2 screen--lg')
  }).join('')
  return `<section><h2>${scenario.scenarioTitle}</h2><div class="grid">${og}${x}</div></section>`
}

function generatePage(sectionsHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    body { margin:24px; background:#e9e9ee; font-family: system-ui, -apple-system, sans-serif; }
    .grid { display:flex; flex-wrap:wrap; gap:22px; align-items:flex-start; }
    section { margin-bottom:40px; }
    h1 { color:#111; font-size:26px; margin:0 0 16px; }
    h2 { color:#1a1a1a; font-size:18px; margin:0 0 14px; border-bottom:2px solid #bbb; padding-bottom:6px; }
  </style></head><body>${sectionsHtml}</body></html>`
}

// sections are the number of plugins
// each plugin has a number of scenarios to generate
// for every scenario, we generate markup for each variant for both OG and X screen sizes
const sections = plugins
  .map((plugin) => {
    console.log(`${plugin.title}:`)
    const scenariosHtml = plugin.scenarios.map(renderScenario).join('')
    return `<section><h1>${plugin.title}</h1>${scenariosHtml}</section>`
  })
  .join('')

writeFileSync('preview.html', generatePage(sections))
console.log('\nWrote preview.html')
