// AI disclosure, file calculating the plane path, progress, and plane icon tilt based on percentage complete
// was fully written by Claude. This is one of the files that had very little human writing.
export const AIRLINE_NAMES: Record<string, string> = {
  UA: 'United Airlines',
  AA: 'American Airlines',
  DL: 'Delta Air Lines',
  WN: 'Southwest Airlines',
  B6: 'JetBlue',
  AS: 'Alaska Airlines',
  NK: 'Spirit Airlines',
  F9: 'Frontier Airlines',
  HA: 'Hawaiian Airlines',
  G4: 'Allegiant Air',
  SY: 'Sun Country Airlines',
  BA: 'British Airways',
  LH: 'Lufthansa',
  AF: 'Air France',
  KL: 'KLM',
  EK: 'Emirates',
  QR: 'Qatar Airways',
  SQ: 'Singapore Airlines',
  CX: 'Cathay Pacific',
  NH: 'All Nippon Airways',
  JL: 'Japan Airlines',
  AC: 'Air Canada',
  WS: 'WestJet',
  AM: 'Aeromexico',
  KE: 'Korean Air',
  EY: 'Etihad Airways',
  TK: 'Turkish Airlines',
  CZ: 'China Southern',
  QF: 'Qantas',
  GB: 'ABX Air'
}

export function formatDelayString(delayMin: number | null): string | null {
  if (delayMin == null) return null
  if (delayMin > 15) return 'Delayed'
  if (delayMin < -15) return 'Early'
  return 'On time'
}

// Only used for fallback - format estimated time remaining as "XXh XXm" or "XXm"
export function formatDuration(mins: number): string {
  if (mins <= 0) return 'Arriving'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const PLANE_PATH =
  'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z'

// Center the icon on the origin and rotate it to face east (+x): it's drawn nose-up in a
// 0..24 box, so translate(-12,-12) centers it and rotate(90) turns it east. `scale` sizes it.
function planeTransform(scale: number): string {
  return `rotate(90) scale(${scale}) translate(-12 -12)`
}

// Plane path centered on the origin and pointing east (+x), ready to drop inside the arc's
// translate+rotate group. `scale` matches the 24-unit icon to the arc's coordinate space.
export function planeArcPath(scale: number): string {
  return `<path d="${PLANE_PATH}" transform="${planeTransform(scale)}" fill="black" />`
}

// Standalone plane icon sized to the current font-size (1em), pointing east (+x) — used on
// the flat half-variant route lines where travel is left-to-right (no extra rotation needed).
export function planeSvg(): string {
  return `<svg class="plane-icon" viewBox="-12 -12 24 24" width="1em" height="1em" xmlns="http://www.w3.org/2000/svg"><path d="${PLANE_PATH}" transform="${planeTransform(1)}" fill="black" /></svg>`
}

export function formatHeading(track: number | undefined): string {
  if (typeof track !== 'number') return '--'
  const deg = Math.round(track) % 360
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const idx = Math.round(deg / 45) % 8
  return `${deg}° ${cardinals[idx]}`
}

// Haversine distance in km between two lat/lon points
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Calculate flight progress as 0-100, or null if insufficient data
export function calcProgress(
  aircraftLat: number | undefined,
  aircraftLon: number | undefined,
  fromLat: number | undefined,
  fromLon: number | undefined,
  toLat: number | undefined,
  toLon: number | undefined
): number | null {
  if (aircraftLat == null || aircraftLon == null) return null
  if (fromLat == null || fromLon == null || toLat == null || toLon == null) return null

  const totalDist = haversineKm(fromLat, fromLon, toLat, toLon)
  if (totalDist < 1) return null // airports too close, avoid division issues

  const flownDist = haversineKm(fromLat, fromLon, aircraftLat, aircraftLon)
  const pct = Math.round((flownDist / totalDist) * 100)
  return Math.max(0, Math.min(100, pct))
}

// Build a great-circle-style arc with the plane positioned (and rotated to the
// path tangent) at progressPct. Flown segment is solid, remaining is dashed.
// Splitting the quadratic bezier at t via de Casteljau gives both halves exactly.
export function buildArcSvg(progressPct: number | null): string {
  const P0 = { x: 34, y: 100 }
  const P1 = { x: 300, y: -8 } // control point sets the (gentle) arc height
  const P2 = { x: 566, y: 100 }
  type Pt = { x: number; y: number }
  const lerp = (a: Pt, b: Pt, r: number): Pt => ({ x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r })
  // de Casteljau split of the quadratic at tt -> handles describing the point + its sub-curve control
  const split = (tt: number) => {
    const a = lerp(P0, P1, tt)
    const b = lerp(P1, P2, tt)
    return { a, b, c: lerp(a, b, tt) }
  }

  const t = progressPct != null ? Math.max(0, Math.min(1, progressPct / 100)) : 0
  const mid = split(t) // mid.c = plane position

  // Tangent direction of a quadratic bezier is proportional to (b - a)
  const angle = (Math.atan2(mid.b.y - mid.a.y, mid.b.x - mid.a.x) * 180) / Math.PI

  // Leave a symmetric gap on both sides of the plane so the glyph never overlaps the route lines.
  // |B'(t)| = 2|b-a| is the curve speed (px per unit t); ~one plane half-width is gapPx/speed in t.
  const speed = 2 * Math.hypot(mid.b.x - mid.a.x, mid.b.y - mid.a.y)
  const gapT = speed > 0 ? Math.min(42 / speed, 0.16) : 0.08
  const back = split(Math.max(t - gapT, 0)) // flown (solid) ends here, just behind the tail
  const fwd = split(Math.min(t + gapT, 1)) // remaining (dotted) starts here, just past the nose

  const n = (v: number) => v.toFixed(1)
  const flownPath = t - gapT > 0.01 ? `M${P0.x},${P0.y} Q${n(back.a.x)},${n(back.a.y)} ${n(back.c.x)},${n(back.c.y)}` : ''
  const remainingPath = t + gapT < 0.99 ? `M${n(fwd.c.x)},${n(fwd.c.y)} Q${n(fwd.b.x)},${n(fwd.b.y)} ${P2.x},${P2.y}` : ''

  // The plane path is centered on the origin pointing east (+x), so rotate by the tangent angle to align its nose with travel
  return `<svg class="arc-svg" viewBox="0 0 600 124" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      ${remainingPath ? `<path d="${remainingPath}" fill="none" stroke="black" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 11" />` : ''}
      ${flownPath ? `<path d="${flownPath}" fill="none" stroke="black" stroke-width="5" stroke-linecap="round" />` : ''}
      <g transform="translate(${n(mid.c.x)},${n(mid.c.y)}) rotate(${n(angle)})">${planeArcPath(2.6)}</g>
    </svg>`
}
