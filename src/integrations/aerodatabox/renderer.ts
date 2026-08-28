import type { FlightDisplayData } from '../../types/aerodatabox/types.js'
import type { MarkupVariant } from '../../types/trmnl/types.js'
import escapeHtml from 'escape-html'
import { buildArcSvg, formatDuration, planeSvg, AIRLINE_NAMES } from './formatters.js'

// Airline logo banners are static and long-cached (see server.ts maxAge). The caller
// passes `assetVersion` (gated behind ASSET_CACHE_BUST in config) when it wants the URL
// tagged so a deploy busts the cache instead of waiting out the maxAge window. Deliberately
// not importing config.js here — this module is exercised directly in tests without the
// server's required env vars set, and config.js throws at import time without them.
function buildLogoUrl(baseUrl: string, airlineIcao: string, assetVersion?: string): string {
  const url = `${baseUrl}/public/radarbox_banners/${encodeURIComponent(airlineIcao)}.png`
  return assetVersion ? `${url}?v=${encodeURIComponent(assetVersion)}` : url
}

// Only surface the scheduled "was HH:MM" anchor for *notable* deviations. The actual time is
// already shown, so a plane landing 2-14 min off schedule isn't worth an extra line — that's
// detail, not glance. This 15-min bar matches the On-time/Delayed/Early adherence threshold, so
// an anchor appears exactly when the flight is off-schedule enough to earn a verdict. Departure
// and arrival are gated independently (a late pushback can anchor without the on-time arrival).
const ANCHOR_MIN_DEVIATION_MIN = 15

function wasAnchor(delayMin: number | null, schedTime: string): string {
  return delayMin != null && Math.abs(delayMin) > ANCHOR_MIN_DEVIATION_MIN && schedTime !== '--'
    ? `was ${escapeHtml(schedTime)}`
    : ''
}

// No-telemetry countdown: before wheels-up we count down to departure, after to arrival.
function countdown(f: FlightDisplayData): { preDeparture: boolean; mins: number | null } {
  const preDeparture = f.minsToDeparture != null && f.minsToDeparture > 0
  return { preDeparture, mins: preDeparture ? f.minsToDeparture : f.minsRemaining }
}

// Terminal states: once the flight has landed the arrival countdown is meaningless
// (it would read a stale "Arriving"), so the no-telemetry tile shows the landing instead.
function isArrived(f: FlightDisplayData): boolean {
  return f.status === 'Arrived' || f.status === 'Likely Arrived'
}

// The primary no-telemetry tile: departs-in / arrives-in while active, or the landed time once arrived.
// `terse` picks the short labels (DEP IN / ARR IN) used on the space-constrained half variants.
function progressTile(f: FlightDisplayData, terse: boolean): { label: string; value: string } {
  if (isArrived(f)) {
    // bit of a misnomer. eta resolves to actual times in priority:
    // runwayTime > revisedTime > predictedTime > scheduledTime
    // We just show 'landed' as a fallback case. Shouldn't really happen though
    return { label: 'ARRIVED', value: f.eta !== '--' ? escapeHtml(f.eta) : 'Landed' }
  }
  const countdownState = countdown(f)
  const label = terse
    ? countdownState.preDeparture
      ? 'DEP IN'
      : 'ARR IN'
    : countdownState.preDeparture
      ? 'DEPARTS IN'
      : 'ARRIVING IN'
  return { label, value: countdownState.mins != null ? escapeHtml(formatDuration(countdownState.mins)) : '--' }
}

/**
 * This is the main function that returns the HTML to a TRMNL device.
 * TRMNL requests that all variants are returned in the payload for all available markups.
 *
 * @param flight Metadata of the flight to display, or null to render the empty state
 * @param variant Dynamically set font size and etc. based on variant
 * @param _utcOffset Based on user, set and apply utc offset to show relevant time zones
 * @param baseUrl The URL that hosts the public static images for flight corporation logos
 * @param assetVersion When set, appended as a `?v=` query param on logo URLs to bust the static asset cache
 * @returns A whole lotta HTML
 */
export function renderMarkup(
  flight: FlightDisplayData | null,
  variant: MarkupVariant,
  _utcOffset: number,
  baseUrl: string,
  assetVersion?: string
): string {
  const logoWidth =
    variant === 'full' ? '320px' : variant === 'half_vertical' ? '200px' : variant === 'half_horizontal' ? '220px' : '160px'
  const logoHeight =
    variant === 'full' ? '140px' : variant === 'half_vertical' ? '90px' : variant === 'half_horizontal' ? '100px' : '70px'

  if (!flight) {
    return renderEmptyMarkup(variant)
  }

  const lastUpdated = flight.lastUpdated
  const flightCards = renderFlightCard(flight, variant, baseUrl, assetVersion)

  // TRMNL X helper
  const s = (px: number) => `calc(${px}px * var(--s, 1))`

  return `
<style>
  .flight-card { --s: 1; }
  .screen--lg .flight-card { --s: 1.3; }

  /* full variant: hero arc + stat tiles. Stretch the framework chain so the
     card can distribute its blocks top-to-bottom and fill the taller X screen. */
  .view--full, .view--full .layout, .view--full .columns, .view--full .column, .view--full .markdown { display: flex; flex-direction: column; flex: 1; width: 100%; }
  .view--full .flight-card { justify-content: space-between; padding: ${s(20)} ${s(40)}; }
  /* No live telemetry -> no tiles; center the remaining header + arc so the card doesn't
     look top-heavy with an empty lower half. */
  .view--full .flight-card--compact { justify-content: center; gap: ${s(56)}; }
  .view--full .flight-top { align-items: center; }
  .flight-arc-wrap { display: flex; align-items: center; gap: ${s(10)}; width: 100%; }
  .arc-end { display: flex; flex-direction: column; align-items: center; min-width: ${s(96)}; }
  .arc-code { font-size: ${s(40)}; font-weight: 800; line-height: 1; }
  .arc-time { font-size: ${s(18)}; font-weight: 600; color: #333; margin-top: ${s(4)}; }
  .arc-sched { font-size: ${s(14)}; font-weight: 600; color: #666; margin-top: ${s(2)}; }
  .arc-svg { flex: 1 1 0; min-width: 0; height: auto; display: block; overflow: visible; }
  .stat-tiles { display: flex; gap: ${s(12)}; width: 100%; }
  .stat-tile { flex: 1; border: ${s(2)} solid black; border-radius: ${s(10)}; padding: ${s(10)} ${s(6)}; display: flex; flex-direction: column; align-items: center; gap: ${s(3)}; }
  .stat-tile-label { font-size: ${s(15)}; font-weight: 700; letter-spacing: 1.5px; }
  .stat-tile-value { font-size: ${s(26)}; font-weight: 800; }

  /* TRMNL X (screen--lg): the taller screen leaves room to breathe, so center the
     blocks with a fixed gap (OG stays space-between — its content already fills the
     shorter screen and a forced gap would overflow/clip the header), and bump just
     the logo + header (arc + tiles already fill the width). */
  .screen--lg .view--full .flight-card { justify-content: center; gap: ${s(44)}; }
  .screen--lg .view--full .airline-logo { max-width: ${s(370)}; max-height: ${s(165)}; }
  .screen--lg .view--full .airline-name { font-size: ${s(34)}; }
  .screen--lg .view--full .flight-number { font-size: ${s(50)}; }
  .screen--lg .view--full .flight-aircraft { font-size: ${s(22)}; }
  .screen--lg .view--full .flight-status { font-size: ${s(27)}; }

  .flight-card { margin: ${variant === 'full' ? '0' : variant === 'half_vertical' ? `${s(12)} 0 0` : variant === 'half_horizontal' ? `${s(8)} 0` : `${s(6)} ${s(8)}`}; padding: ${variant === 'full' ? `${s(12)} ${s(24)}` : '0'}; font-family: 'IBM Plex Sans', 'SF Pro Text', 'Segoe UI', sans-serif; display: flex; flex-direction: column; flex: 1; }
  .flight-details { margin-top: ${variant === 'full' ? s(60) : '0'}; }
  .flight-top { display: flex; align-items: center; gap: ${variant === 'quadrant' ? s(12) : s(20)}; width: 100%; }
  .view--half_horizontal .flight-top { display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto auto; align-items: center; column-gap: ${s(16)}; row-gap: ${s(2)}; }
  .view--half_horizontal .airline-logo { grid-column: 1; grid-row: 1; align-self: center; }
  .view--half_horizontal .flight-meta { grid-column: 3; grid-row: 1; }
  .flight-meta { display: flex; flex-direction: column; gap: ${variant === 'quadrant' ? s(3) : s(5)}; align-items: flex-end; text-align: right; margin-left: auto; }
  .airline-name { font-size: ${variant === 'quadrant' ? s(18) : variant === 'full' ? s(30) : s(24)}; font-weight: 700; letter-spacing: 0.2px; }
  .flight-number { font-size: ${variant === 'quadrant' ? s(26) : variant === 'full' ? s(44) : s(34)}; font-weight: 800; }
  .flight-aircraft { font-size: ${variant === 'quadrant' ? s(14) : variant === 'full' ? s(20) : s(17)}; font-weight: 500; color: #444; }
  .flight-status { font-size: ${variant === 'quadrant' ? s(16) : variant === 'full' ? s(24) : s(20)}; font-weight: 600; }
  .flight-route { display: flex; align-items: center; gap: ${s(12)}; width: 100%; font-size: ${variant === 'quadrant' ? s(20) : s(28)}; font-weight: 700; margin: ${variant === 'quadrant' ? `${s(8)} 0 ${s(5)}` : `${s(14)} 0 ${s(8)}`}; }
  .view--half_vertical { display: flex; flex-direction: column; flex: 1; align-items: stretch; width: 100%; }
  .view--half_vertical .flight-top { margin-bottom: ${s(36)}; }
  .view--half_vertical .flight-details { margin-top: auto; display: flex; flex-direction: column; gap: ${s(16)}; }
  .view--half_vertical .flight-stats { margin-top: ${s(36)}; font-size: ${s(14)}; gap: ${s(10)}; justify-content: space-between; }
  .view--half_vertical .flight-route { width:100%; margin: 0; }
  .view--half_vertical .stat-item { display: flex; flex-direction: column; align-items: center; }
  .view--half_vertical .stat-value { font-size: ${s(16)}; font-weight: 700; }
  .view--half_horizontal .flight-top .flight-route { grid-column: 1 / -1; grid-row: 2; margin: ${s(6)} 0 0; font-size: ${s(22)}; }
  .view--half_horizontal .flight-top .flight-stats { grid-column: 2; grid-row: 1; flex-direction: column; align-items: flex-start; justify-self: center; gap: ${s(2)}; font-size: ${s(16)}; margin-top: 0; }
  .view--half_horizontal .flight-stat-aircraft { font-weight: 600; }
  .view--half_horizontal .airline-name { font-size: ${s(20)}; }
  .view--half_horizontal .flight-number { font-size: ${s(30)}; }
  .view--half_horizontal .flight-aircraft { display: none; }
  .view--half_horizontal .flight-status { font-size: ${s(18)}; }
  .view--half_horizontal .route-plane { font-size: ${s(28)}; }
  .route-line { flex: 1; height: ${s(2)}; background: black; position: relative; }
  .route-line-flown { height: ${s(3)}; background: black; }
  .route-line-remaining { height: 0; background: none; border-top: ${s(3)} dotted black; }
  .route-plane { font-size: ${variant === 'quadrant' ? s(28) : variant === 'full' ? s(48) : s(36)}; line-height: 1; }
  .route-plane .plane-icon { display: block; }
  .route-end { display: inline-flex; flex-direction: column; align-items: center; line-height: 1.1; }
  .route-time { font-size: 0.6em; font-weight: 600; color: #333; margin-top: ${s(2)}; }
  .route-sched { font-size: 0.5em; font-weight: 600; color: #666; }
  .flight-stats { display: flex; ${variant === 'full' ? 'justify-content: space-between;' : `gap: ${variant === 'quadrant' ? s(14) : s(26)};`} font-size: ${variant === 'full' ? s(24) : variant === 'quadrant' ? s(15) : s(20)}; margin-top: ${variant === 'quadrant' ? s(3) : s(7)}; }
  .stat-label { font-weight: 700; }
  .airline-logo { width: 100%; max-width: calc(${logoWidth} * var(--s, 1)); max-height: calc(${logoHeight} * var(--s, 1)); object-fit: contain; }
</style>
<div class="view view--${variant}">
  <div class="layout">
    <div class="columns">
      <div class="column">
        <div class="markdown">
          ${flightCards}
        </div>
      </div>
    </div>
  </div>
</div>

<div class="title_bar">
  <span class="title">Flight Tracker</span>
  <span class="instance">Updated ${escapeHtml(lastUpdated)}</span>
</div>
`.trim()
}

function renderFullCard(f: FlightDisplayData, baseUrl: string, assetVersion?: string): string {
  const logoUrl = buildLogoUrl(baseUrl, f.airlineIcao, assetVersion)
  const airlineCode = f.airlineIata || ''
  const airlineName = AIRLINE_NAMES[airlineCode] ?? (airlineCode || f.flightIata)
  const flightCode =
    airlineCode && f.flightIata.startsWith(airlineCode)
      ? `${airlineCode} ${f.flightIata.slice(airlineCode.length)}`
      : f.flightIata

  const altDisplay = `${escapeHtml(f.altitudeFt)}${f.altitudeFt !== '--' && f.altitudeFt !== 'Ground' ? ' ft' : ''}`
  const spdDisplay = `${escapeHtml(f.speedMph)}${f.speedMph !== '--' ? ' mph' : ''}`

  // Check for live telemetry, if there is none, fallback to est mins remaining and progress complete
  const hasLiveData = f.altitudeFt !== '--' || f.speedMph !== '--' || f.heading !== '--'
  const hasFallback = f.minsToDeparture != null || f.minsRemaining != null || f.progressPct != null
  const depSched = wasAnchor(f.depDelayMin, f.schedDep)
  const arrSched = wasAnchor(f.delayMin, f.schedEta)
  const baseTiles = hasLiveData
    ? [
        { label: 'ALT', value: altDisplay },
        { label: 'SPD', value: spdDisplay },
        { label: 'HDG', value: escapeHtml(f.heading) },
      ]
    : hasFallback
      ? [progressTile(f, false), { label: 'TRIP', value: f.progressPct != null ? `${f.progressPct}%` : '--' }]
      : []

  const baseHtml = baseTiles
    .map(
      (tile) =>
        `<div class="stat-tile"><span class="stat-tile-label">${tile.label}</span><span class="stat-tile-value">${tile.value}</span></div>`
    )
    .join('')
  const tilesHtml = baseHtml
  const showTiles = tilesHtml !== ''

  return `
  <div class="flight-card${showTiles ? '' : ' flight-card--compact'}">
    <div class="flight-top">
      <img class="image-dither airline-logo" src="${logoUrl}" onerror="this.style.display='none'" />
      <div class="flight-meta">
        <span class="airline-name">${escapeHtml(airlineName)}</span>
        <span class="flight-number">${escapeHtml(flightCode)}</span>
        <span class="flight-aircraft">${escapeHtml(f.aircraftModel)}</span>
        <span class="flight-status">${escapeHtml(f.status)}${f.delayString ? ` <span class="flight-adherence">· ${escapeHtml(f.delayString)}</span>` : ''}</span>
      </div>
    </div>
    <div class="flight-arc-wrap">
      <div class="arc-end">
        <span class="arc-code">${escapeHtml(f.depAirport || '---')}</span>
        <span class="arc-time">${escapeHtml(f.depTime)}</span>
        ${depSched ? `<span class="arc-sched">${depSched}</span>` : ''}
      </div>
      ${buildArcSvg(f.progressPct)}
      <div class="arc-end">
        <span class="arc-code">${escapeHtml(f.arrAirport || '---')}</span>
        <span class="arc-time">${escapeHtml(f.eta)}</span>
        ${arrSched ? `<span class="arc-sched">${arrSched}</span>` : ''}
      </div>
    </div>
    ${showTiles ? `<div class="stat-tiles">${tilesHtml}</div>` : ''}
  </div>`
}

function renderFlightCard(f: FlightDisplayData, variant: MarkupVariant, baseUrl: string, assetVersion?: string): string {
  if (variant === 'full') return renderFullCard(f, baseUrl, assetVersion)

  const logoUrl = buildLogoUrl(baseUrl, f.airlineIcao, assetVersion)
  const showStats = variant !== 'quadrant'
  const showRoute = true
  const embedRouteInTop = variant === 'half_horizontal'
  const airlineCode = f.airlineIata || ''
  const airlineName = AIRLINE_NAMES[airlineCode] ?? (airlineCode || f.flightIata)
  const flightCode =
    airlineCode && f.flightIata.startsWith(airlineCode)
      ? `${airlineCode} ${f.flightIata.slice(airlineCode.length)}`
      : f.flightIata

  // If we have progress data, use flex ratios to position the plane icon
  const hasProgress = f.progressPct != null
  const leftFlex = hasProgress ? Math.max(f.progressPct!, 2) : 1
  const rightFlex = hasProgress ? Math.max(100 - f.progressPct!, 2) : 1
  // Flown segment is solid only when we know progress; otherwise both sides dotted (position unknown)
  const leftLineClass = hasProgress ? 'route-line route-line-flown' : 'route-line route-line-remaining'

  const depSched = wasAnchor(f.depDelayMin, f.schedDep)
  const arrSched = wasAnchor(f.delayMin, f.schedEta)
  const routeHtml = showRoute
    ? `
    <div class="flight-route">
      <span class="route-end"><span class="route-code">${escapeHtml(f.depAirport || '---')}</span><span class="route-time">${escapeHtml(f.depTime)}</span>${depSched ? `<span class="route-sched">${depSched}</span>` : ''}</span>
      <span class="${leftLineClass}" style="flex: ${leftFlex};"></span>
      <span class="route-plane">${planeSvg()}</span>
      <span class="route-line route-line-remaining" style="flex: ${rightFlex};"></span>
      <span class="route-end"><span class="route-code">${escapeHtml(f.arrAirport || '---')}</span><span class="route-time">${escapeHtml(f.eta)}</span>${arrSched ? `<span class="route-sched">${arrSched}</span>` : ''}</span>
    </div>`
    : ''

  // Live telemetry with fallback to mins remaining and progress complete
  const hasLiveData = f.altitudeFt !== '--' || f.speedMph !== '--' || f.heading !== '--'
  const hasFallback = f.minsToDeparture != null || f.minsRemaining != null || f.progressPct != null
  const aircraftStat =
    variant === 'half_horizontal' ? `<span class="stat-item flight-stat-aircraft">${escapeHtml(f.aircraftModel)}</span>` : ''
  const stat = (label: string, value: string) =>
    `<span class="stat-item"><span class="stat-label">${label}:</span> <span class="stat-value">${value}</span></span>`
  let statsInner = ''
  if (hasLiveData) {
    statsInner = `${aircraftStat}
      ${stat('ALT', `${escapeHtml(f.altitudeFt)}${f.altitudeFt !== '--' && f.altitudeFt !== 'Ground' ? ' ft' : ''}`)}
      ${stat('SPD', `${escapeHtml(f.speedMph)}${f.speedMph !== '--' ? ' mph' : ''}`)}
      ${stat('HDG', escapeHtml(f.heading))}`
  } else if (hasFallback) {
    const fallbackTile = progressTile(f, true)
    statsInner = `${aircraftStat}
      ${stat(fallbackTile.label, fallbackTile.value)}
      ${stat('TRIP', f.progressPct != null ? `${f.progressPct}%` : '--')}`
  } else {
    statsInner = aircraftStat
  }
  const statsHtml = showStats && statsInner ? `<div class="flight-stats">${statsInner}</div>` : ''

  const routeBlock = showRoute ? routeHtml : ''
  const statsBlock = showStats ? statsHtml : ''
  const detailsContent = `${statsBlock}${routeBlock}`
  const detailsBlock = embedRouteInTop ? '' : `<div class="flight-details">${detailsContent}</div>`

  return `
  <div class="flight-card">
    <div class="flight-top">
      <img class="image-dither airline-logo" src="${logoUrl}" onerror="this.style.display='none'" />
      <div class="flight-meta">
        <span class="airline-name">${escapeHtml(airlineName)}</span>
        <span class="flight-number">${escapeHtml(flightCode)}</span>
        <span class="flight-aircraft">${escapeHtml(f.aircraftModel)}</span>
        <span class="flight-status">${escapeHtml(f.status)}</span>
      </div>
      ${embedRouteInTop ? routeBlock : ''}
      ${embedRouteInTop ? statsBlock : ''}
    </div>
    ${detailsBlock}
  </div>`
}

function renderEmptyMarkup(variant: MarkupVariant): string {
  const textSize = variant === 'quadrant' ? '20px' : '28px'
  return `
<style>
  /* TRMNL X scale-up: see renderMarkup for the rationale. */
  .flight-empty { --s: 1; font-size: calc(${textSize} * var(--s, 1)); font-weight: 600; padding: calc(40px * var(--s, 1)) 0; }
  .screen--lg .flight-empty { --s: 1.3; }
</style>
<div class="view view--${variant}">
  <div class="layout">
    <div class="columns">
      <div class="column">
        <div class="markdown" style="text-align:center;">
          <div class="flight-empty">
            Configure flights in settings
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="title_bar">
  <span class="title">Flight Tracker</span>
</div>
`.trim()
}