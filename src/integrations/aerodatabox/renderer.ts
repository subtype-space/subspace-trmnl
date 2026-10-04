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

// The logo leads the header on the left. No ICAO -> no image at all; a failed load hides the image
// and flags the header so it re-aligns left (see .flight-top--no-logo).
function logoHtml(f: FlightDisplayData, baseUrl: string, assetVersion?: string): string {
  if (!f.airlineIcao) return ''
  const src = buildLogoUrl(baseUrl, f.airlineIcao, assetVersion)
  return `<img class="image-dither airline-logo" src="${src}" onerror="this.style.display='none';this.parentElement.classList.add('flight-top--no-logo')" />`
}

// Only call out a schedule deviation once it's notable — the same 15-min window the
// on-time verdict uses, so a "+12m" never sits next to an "On time" status.
const ANCHOR_MIN_DEVIATION_MIN = 15

type Deviation = { delta: string; sched: string }

// Explicit delay amount ("35m late" / "22m early") plus the original clock, or null when on schedule/unknown.
function deviation(delayMin: number | null, schedTime: string): Deviation | null {
  if (delayMin == null || Math.abs(delayMin) <= ANCHOR_MIN_DEVIATION_MIN || schedTime === '--') return null
  const amount = formatDuration(Math.abs(delayMin))
  return { delta: `${amount} ${delayMin > 0 ? 'late' : 'early'}`, sched: `sched ${escapeHtml(schedTime)}` }
}

// How much of the deviation each variant has room for under the airport code:
// stacked (delta + sched on two lines), inline (one line), or terse (delta only).
type DeviationLayout = 'stacked' | 'inline' | 'terse'

function deviationHtml(dev: Deviation | null, layout: DeviationLayout, prefix: 'arc' | 'route'): string {
  if (!dev) return ''
  const delta = `<span class="${prefix}-delta">${dev.delta}</span>`
  if (layout === 'terse') return delta
  if (layout === 'inline') return `<span class="${prefix}-delta">${dev.delta} <span class="${prefix}-dim">· ${dev.sched}</span></span>`
  return `${delta}<span class="${prefix}-sched">${dev.sched}</span>`
}

// No-telemetry countdown: before wheels-up we count down to departure, after to arrival.
function countdown(f: FlightDisplayData): { preDeparture: boolean; mins: number | null } {
  const preDeparture = f.minsToDeparture != null && f.minsToDeparture > 0
  return { preDeparture, mins: preDeparture ? f.minsToDeparture : f.minsRemaining }
}

// Terminal states: once the flight has landed the arrival countdown is meaningless
// (it would read a stale "Arriving"), so the info row shows the landing instead.
function isArrived(f: FlightDisplayData): boolean {
  return f.status === 'Arrived' || f.status === 'Likely Arrived'
}

// The primary info-row item: departs-in / arrives-in while active, or the landed time once arrived.
// Shown in every state (with or without telemetry) so outbound and return legs keep the same structure.
// Every layout that has an info row has room for the full DEPARTS IN / ARRIVING IN labels.
// `past` marks the landed state: historical, so the row renders it quieter than a live countdown.
function progressItem(f: FlightDisplayData): { label: string; value: string; past?: boolean } | null {
  if (isArrived(f)) {
    // bit of a misnomer. eta resolves to actual times in priority:
    // runwayTime > revisedTime > predictedTime > scheduledTime
    // We just show 'landed' as a fallback case. Shouldn't really happen though
    // The landing clock already sits under the arrival airport, so prefer "how long ago" here.
    if (f.minsRemaining != null && f.minsRemaining < 0) {
      return { label: 'ARRIVED', value: `${escapeHtml(formatDuration(-f.minsRemaining))} ago`, past: true }
    }
    return { label: 'ARRIVED', value: f.eta !== '--' ? escapeHtml(f.eta) : 'Landed', past: true }
  }
  const countdownState = countdown(f)
  if (countdownState.mins == null) return null
  const label = countdownState.preDeparture ? 'DEPARTS IN' : 'ARRIVING IN'
  return { label, value: escapeHtml(formatDuration(countdownState.mins)) }
}

// Live telemetry is secondary: only worth showing while airborne. On the ground (or landed)
// altitude/speed/heading are noise, and any unknown ('--') reading is dropped rather than shown.
function telemetryParts(f: FlightDisplayData, includeHeading: boolean): string[] {
  if (isArrived(f) || f.altitudeFt === 'Ground') return []
  const parts: string[] = []
  if (f.altitudeFt !== '--') parts.push(`${escapeHtml(f.altitudeFt)} ft`)
  if (f.speedMph !== '--') parts.push(`${escapeHtml(f.speedMph)} mph`)
  if (includeHeading && f.heading !== '--') parts.push(escapeHtml(f.heading))
  return parts
}

// Departed but not yet landed: the remaining route switches from dotted (planned) to solid gray.
function isInFlight(f: FlightDisplayData): boolean {
  return !isArrived(f) && !countdown(f).preDeparture
}

// The arc's % label only means something mid-flight — 0% pre-departure and 100% after landing say nothing.
function showProgressPct(f: FlightDisplayData): boolean {
  return f.progressPct != null && f.progressPct > 0 && f.progressPct < 100 && isInFlight(f)
}

function formatFlightCode(f: FlightDisplayData): { airlineName: string; flightCode: string } {
  const airlineCode = f.airlineIata || ''
  const airlineName = AIRLINE_NAMES[airlineCode] ?? (airlineCode || f.flightIata)
  const flightCode =
    airlineCode && f.flightIata.startsWith(airlineCode)
      ? `${airlineCode} ${f.flightIata.slice(airlineCode.length)}`
      : f.flightIata
  return { airlineName, flightCode }
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
 * @param emptyMessage Text shown when flight is null. Defaults to the "go configure" prompt -
 * pass a different message when the empty state is actually a failure to read settings, not a genuinely empty configuration.
 * @returns A whole lotta HTML
 */
export function renderMarkup(
  flight: FlightDisplayData | null,
  variant: MarkupVariant,
  _utcOffset: number,
  baseUrl: string,
  assetVersion?: string,
  emptyMessage?: string
): string {
  const logoWidth =
    variant === 'full' ? '320px' : variant === 'half_vertical' ? '200px' : variant === 'half_horizontal' ? '220px' : '160px'
  const logoHeight =
    variant === 'full' ? '140px' : variant === 'half_vertical' ? '90px' : variant === 'half_horizontal' ? '100px' : '70px'

  if (!flight) {
    return renderEmptyMarkup(variant, emptyMessage)
  }

  const lastUpdated = flight.lastUpdated
  const flightCards = renderFlightCard(flight, variant, baseUrl, assetVersion)

  // TRMNL X helper
  const s = (px: number) => `calc(${px}px * var(--s, 1))`

  return `
<style>
  .flight-card { --s: 1; }
  .screen--lg .flight-card { --s: 1.3; }

  /* full variant: header, hero arc, then a single info row, as one vertically centered block.
     The route sits close under the header (the arc's own viewBox already carries headroom for
     the progress label), with a little more air before the info row. */
  .view--full, .view--full .layout, .view--full .columns, .view--full .column, .view--full .markdown { display: flex; flex-direction: column; flex: 1; width: 100%; }
  .view--full .flight-card { justify-content: center; padding: ${s(12)} ${s(40)}; }
  .view--full .flight-arc-wrap { margin-top: ${s(20)}; }
  .view--full .flight-info { margin-top: ${s(28)}; }
  .view--full .flight-top { align-items: center; }
  .flight-arc-wrap { display: flex; align-items: center; gap: ${s(10)}; width: 100%; }
  .arc-end { display: flex; flex-direction: column; align-items: center; min-width: ${s(96)}; }
  .arc-code { font-size: ${s(34)}; font-weight: 800; line-height: 1; }
  .arc-time { font-size: ${s(22)}; font-weight: 700; margin-top: ${s(4)}; }
  .arc-end--arr .arc-time { font-weight: 800; }
  .arc-delta { font-size: ${s(15)}; font-weight: 700; margin-top: ${s(2)}; white-space: nowrap; }
  .arc-sched { font-size: ${s(13)}; font-weight: 600; white-space: nowrap; }
  .arc-svg { flex: 1 1 0; min-width: 0; height: auto; display: block; overflow: visible; }
  .flight-info { display: flex; align-items: baseline; justify-content: space-between; gap: ${s(16)}; width: 100%; }
  .info-primary { display: flex; align-items: baseline; gap: ${s(10)}; }
  .info-primary--past .info-label { font-size: ${s(13)}; }
  .info-primary--past .info-value { font-size: ${s(22)}; font-weight: 700; }
  .info-label { font-size: ${s(15)}; font-weight: 700; letter-spacing: 1.5px; }
  .info-value { font-size: ${s(30)}; font-weight: 800; }
  .info-telemetry { font-size: ${s(18)}; font-weight: 600; margin-left: auto; white-space: nowrap; }

  /* TRMNL X (screen--lg): same centered block (the --s scale already grows the gaps);
     bump just the logo + header, since the arc + info row already fill the width. */
  .screen--lg .view--full .airline-logo { max-width: ${s(370)}; max-height: ${s(165)}; }
  .screen--lg .view--full .airline-name { font-size: ${s(27)}; }
  .screen--lg .view--full .flight-number { font-size: ${s(56)}; }
  .screen--lg .view--full .flight-aircraft { font-size: ${s(19)}; }
  .screen--lg .view--full .flight-status { font-size: ${s(30)}; }

  .flight-card { margin: ${variant === 'full' ? '0' : variant === 'half_vertical' ? `${s(12)} 0 0` : variant === 'half_horizontal' ? `${s(8)} 0` : `${s(6)} ${s(8)}`}; padding: ${variant === 'full' ? `${s(12)} ${s(24)}` : '0'}; font-family: 'IBM Plex Sans', 'SF Pro Text', 'Segoe UI', sans-serif; display: flex; flex-direction: column; flex: 1; }
  .flight-details { margin-top: ${variant === 'full' ? s(60) : '0'}; }
  .flight-top { display: flex; align-items: center; gap: ${variant === 'quadrant' ? s(12) : s(20)}; width: 100%; }
  .view--half_horizontal .flight-top { display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto auto; align-items: center; column-gap: ${s(16)}; row-gap: ${s(2)}; }
  .view--half_horizontal .airline-logo { grid-column: 1; grid-row: 1; align-self: center; }
  .view--half_horizontal .flight-meta { grid-column: 3; grid-row: 1; }
  .flight-meta { display: flex; flex-direction: column; gap: ${variant === 'quadrant' ? s(2) : s(4)}; align-items: flex-end; text-align: right; margin-left: auto; flex-shrink: 0; }
  /* No logo (unknown airline or the image failed): left-align the header so it sits over the
     origin instead of hanging off the right edge with nothing to balance it. */
  .flight-top--no-logo .flight-meta { align-items: flex-start; text-align: left; margin-left: 0; }
  .view--half_horizontal .flight-top--no-logo .flight-meta { grid-column: 1; }
  /* Header hierarchy: flight number + status lead; airline name and aircraft are supporting text. */
  .airline-name { font-size: ${variant === 'quadrant' ? s(15) : variant === 'full' ? s(24) : s(20)}; font-weight: 600; letter-spacing: 0.2px; }
  .flight-number { font-size: ${variant === 'quadrant' ? s(26) : variant === 'full' ? s(48) : s(34)}; font-weight: 800; line-height: 1.05; white-space: nowrap; }
  .flight-aircraft { font-size: ${variant === 'quadrant' ? s(13) : variant === 'full' ? s(17) : s(15)}; font-weight: 500; }
  .flight-status { font-size: ${variant === 'quadrant' ? s(16) : variant === 'full' ? s(26) : s(20)}; font-weight: 700; }
  .flight-route { display: flex; align-items: center; gap: ${s(12)}; width: 100%; font-size: ${variant === 'quadrant' ? s(18) : s(24)}; font-weight: 700; margin: ${variant === 'quadrant' ? `${s(8)} 0 ${s(5)}` : `${s(14)} 0 ${s(8)}`}; }
  .view--half_vertical { display: flex; flex-direction: column; flex: 1; align-items: stretch; width: 100%; }
  .view--half_vertical .flight-card { justify-content: center; gap: ${s(28)}; margin: 0; }
  .view--half_vertical .flight-details { display: flex; flex-direction: column; gap: ${s(14)}; }
  .view--half_vertical .flight-stats { justify-content: space-between; align-items: baseline; margin-top: 0; }
  .view--half_vertical .flight-route { width:100%; margin: 0; }
  .view--half_horizontal .flight-top .flight-route { grid-column: 1 / -1; grid-row: 2; margin: ${s(6)} 0 0; font-size: ${s(20)}; }
  .view--half_horizontal .flight-top .flight-stats { grid-column: 2; grid-row: 1; flex-direction: column; align-items: flex-start; justify-self: center; gap: ${s(2)}; margin-top: 0; }
  .view--half_horizontal .flight-stat-aircraft { font-size: ${s(15)}; font-weight: 500; }
  .view--half_horizontal .airline-name { font-size: ${s(18)}; }
  .view--half_horizontal .flight-number { font-size: ${s(30)}; }
  .view--half_horizontal .flight-aircraft { display: none; }
  .view--half_horizontal .flight-status { font-size: ${s(18)}; }
  .view--half_horizontal .route-plane { font-size: ${s(28)}; }
  .route-line { flex: 1; height: ${s(2)}; background: black; position: relative; }
  .route-line-flown { height: ${s(3)}; background: black; }
  .route-line-remaining { height: 0; background: none; border-top: ${s(3)} dotted black; }
  .route-line--airborne { height: ${s(4)}; background: #888; border-top: none; }
  .route-plane { font-size: ${variant === 'quadrant' ? s(28) : variant === 'full' ? s(48) : s(36)}; line-height: 1; }
  .route-plane .plane-icon { display: block; }
  .route-end { display: inline-flex; flex-direction: column; align-items: center; line-height: 1.1; }
  .route-time { font-size: 0.7em; font-weight: 700; margin-top: ${s(2)}; }
  .route-end--arr .route-time { font-weight: 800; }
  .route-delta { font-size: 0.55em; font-weight: 700; white-space: nowrap; }
  .route-sched { font-size: 0.5em; font-weight: 600; white-space: nowrap; }
  .flight-stats { display: flex; flex-wrap: wrap; gap: ${s(4)} ${s(16)}; font-size: ${s(16)}; margin-top: ${s(7)}; }
  .stat-label { font-size: 0.85em; font-weight: 700; letter-spacing: 1px; }
  .stat-value { font-size: 1.15em; font-weight: 800; }
  .stat-item--past .stat-value { font-size: 1em; font-weight: 700; }
  .stat-telemetry { font-weight: 600; white-space: nowrap; }
  .airline-logo { width: 100%; min-width: 0; flex: 0 1 auto; max-width: calc(${logoWidth} * var(--s, 1)); max-height: calc(${logoHeight} * var(--s, 1)); object-fit: contain; }
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
  const { airlineName, flightCode } = formatFlightCode(f)

  // One info row in every state: the countdown / landed time leads, live telemetry trails as
  // secondary text when airborne. Keeps outbound and return legs structurally identical.
  const primary = progressItem(f)
  const telemetry = telemetryParts(f, true)
  const primaryHtml = primary
    ? `<span class="info-primary${primary.past ? ' info-primary--past' : ''}"><span class="info-label">${primary.label}</span><span class="info-value">${primary.value}</span></span>`
    : ''
  const telemetryHtml = telemetry.length ? `<span class="info-telemetry">${telemetry.join(' · ')}</span>` : ''
  const showInfo = primaryHtml !== '' || telemetryHtml !== ''

  return `
  <div class="flight-card">
    <div class="flight-top${f.airlineIcao ? '' : ' flight-top--no-logo'}">
      ${logoHtml(f, baseUrl, assetVersion)}
      <div class="flight-meta">
        <span class="airline-name">${escapeHtml(airlineName)}</span>
        <span class="flight-number">${escapeHtml(flightCode)}</span>
        <span class="flight-status">${escapeHtml(f.status)}${f.delayString ? ` <span class="flight-adherence">· ${escapeHtml(f.delayString)}</span>` : ''}</span>
        <span class="flight-aircraft">${escapeHtml(f.aircraftModel)}</span>
      </div>
    </div>
    <div class="flight-arc-wrap">
      <div class="arc-end">
        <span class="arc-code">${escapeHtml(f.depAirport || '---')}</span>
        <span class="arc-time">${escapeHtml(f.depTime)}</span>
        ${deviationHtml(deviation(f.depDelayMin, f.schedDep), 'stacked', 'arc')}
      </div>
      ${buildArcSvg(f.progressPct, showProgressPct(f), isInFlight(f))}
      <div class="arc-end arc-end--arr">
        <span class="arc-code">${escapeHtml(f.arrAirport || '---')}</span>
        <span class="arc-time">${escapeHtml(f.eta)}</span>
        ${deviationHtml(deviation(f.delayMin, f.schedEta), 'stacked', 'arc')}
      </div>
    </div>
    ${showInfo ? `<div class="flight-info">${primaryHtml}${telemetryHtml}</div>` : ''}
  </div>`
}

function renderFlightCard(f: FlightDisplayData, variant: MarkupVariant, baseUrl: string, assetVersion?: string): string {
  if (variant === 'full') return renderFullCard(f, baseUrl, assetVersion)

  const showStats = variant !== 'quadrant'
  const embedRouteInTop = variant === 'half_horizontal'
  const { airlineName, flightCode } = formatFlightCode(f)

  // If we have progress data, use flex ratios to position the plane icon
  const hasProgress = f.progressPct != null
  const leftFlex = hasProgress ? Math.max(f.progressPct!, 2) : 1
  const rightFlex = hasProgress ? Math.max(100 - f.progressPct!, 2) : 1
  // Flown segment is solid only when we know progress; otherwise both sides use the remaining style (position unknown).
  // Remaining is dotted before departure and solid gray once airborne.
  const remainingClass = `route-line route-line-remaining${isInFlight(f) ? ' route-line--airborne' : ''}`
  const leftLineClass = hasProgress ? 'route-line route-line-flown' : remainingClass

  const devLayout: DeviationLayout =
    variant === 'half_vertical' ? 'stacked' : variant === 'half_horizontal' ? 'inline' : 'terse'
  const depDev = deviationHtml(deviation(f.depDelayMin, f.schedDep), devLayout, 'route')
  const arrDev = deviationHtml(deviation(f.delayMin, f.schedEta), devLayout, 'route')
  const routeHtml = `
    <div class="flight-route">
      <span class="route-end"><span class="route-code">${escapeHtml(f.depAirport || '---')}</span><span class="route-time">${escapeHtml(f.depTime)}</span>${depDev}</span>
      <span class="${leftLineClass}" style="flex: ${leftFlex};"></span>
      <span class="route-plane">${planeSvg()}</span>
      <span class="${remainingClass}" style="flex: ${rightFlex};"></span>
      <span class="route-end route-end--arr"><span class="route-code">${escapeHtml(f.arrAirport || '---')}</span><span class="route-time">${escapeHtml(f.eta)}</span>${arrDev}</span>
    </div>`

  // Same info row as the full variant: countdown / landed time first, telemetry (alt + speed only —
  // heading isn't worth the width here) as secondary text when airborne.
  const primary = progressItem(f)
  const telemetry = telemetryParts(f, false)
  const aircraftStat =
    variant === 'half_horizontal' ? `<span class="stat-item flight-stat-aircraft">${escapeHtml(f.aircraftModel)}</span>` : ''
  const primaryStat = primary
    ? `<span class="stat-item${primary.past ? ' stat-item--past' : ''}"><span class="stat-label">${primary.label}</span> <span class="stat-value">${primary.value}</span></span>`
    : ''
  const telemetryStat = telemetry.length ? `<span class="stat-item stat-telemetry">${telemetry.join(' · ')}</span>` : ''
  const statsInner = `${aircraftStat}${primaryStat}${telemetryStat}`
  const statsHtml = showStats && statsInner ? `<div class="flight-stats">${statsInner}</div>` : ''

  // half_vertical reads top-down: route first (origin/destination/arrival), then the info row.
  const detailsBlock = embedRouteInTop ? '' : `<div class="flight-details">${routeHtml}${statsHtml}</div>`

  return `
  <div class="flight-card">
    <div class="flight-top${f.airlineIcao ? '' : ' flight-top--no-logo'}">
      ${logoHtml(f, baseUrl, assetVersion)}
      <div class="flight-meta">
        <span class="airline-name">${escapeHtml(airlineName)}</span>
        <span class="flight-number">${escapeHtml(flightCode)}</span>
        <span class="flight-status">${escapeHtml(f.status)}</span>
        <span class="flight-aircraft">${escapeHtml(f.aircraftModel)}</span>
      </div>
      ${embedRouteInTop ? routeHtml : ''}
      ${embedRouteInTop ? statsHtml : ''}
    </div>
    ${detailsBlock}
  </div>`
}

function renderEmptyMarkup(variant: MarkupVariant, message = 'Configure flights in settings'): string {
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
            ${escapeHtml(message)}
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