import 'dotenv/config'
import { createRequire } from 'module'
import type { CacheTtls, Provider } from './types/aerodatabox/types.js'

const require = createRequire(import.meta.url)
const { version: appVersion } = require('../package.json') as { version: string }

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(`[ENV ] Missing required env var: ${name}`)
  }
  return v
}

function minutes(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback * 60 * 1000
  const v = Number(raw)
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`[ENV ] Invalid ${name}: expected a positive number of minutes, got "${raw}"`)
  }
  return v * 60 * 1000
}

export const version = appVersion

export const config = {
    api: {
        port:           Number(process.env.PORT) || 9595,
        logLevel:       (process.env.LOG_LEVEL || 'info').toLowerCase(),
        activeVersion:  process.env.ACTIVE_VERSION || 'v1',
        // Public origin this service is reached at, e.g. https://trmnl.subtype.space
        // Used to build absolute URLs (airline logo banners, etc.) in TRMNL markup responses
        publicBaseUrl:  required('PUBLIC_BASE_URL'),
        // When ASSET_CACHE_BUST is on, static asset URLs (airline logo banners) get tagged
        // with `?v=<app version>` so a deploy forces TRMNL to re-fetch them instead of
        // serving the maxAge-cached copy. Off (undefined) by default since the banners
        // rarely change and most deploys don't touch them.
        assetVersion:   (process.env.ASSET_CACHE_BUST ?? 'false').toLowerCase() === 'true' ? appVersion : undefined
    },
    trmnl: {
        // Bypass checking the TRMNL worker IP address
        bypassIPCheck:  process.env.TRMNL_IP_ALLOW_PRIVATE || 'false',
        dbPath:         process.env.TRMNL_DB_PATH || './trmnl.sqlite',
        // These clientID and secret are provided by TRMNL, this is not the same as the ones in auth
        clientId:       required('TRMNL_CLIENT_ID'),
        clientSecret:   required('TRMNL_CLIENT_SECRET'),
        // Flights plugin (optional - only needed if running the flight tracker plugin)
        flightsClientId:     process.env.TRMNL_FLIGHTS_CLIENT_ID ?? '',
        flightsClientSecret: process.env.TRMNL_FLIGHTS_CLIENT_SECRET ?? '',
    },
    wmata: {
        apiKey:         process.env.WMATA_PRIMARY_KEY ?? '',
    },
    aerodatabox: {
        apiKey:         process.env.AERODATABOX_API_KEY ?? '',
        provider:       (process.env.AERODATABOX_PROVIDER ?? 'apimarket') as Provider,
        ttl: {
            // TRMNL refresh is capped at 30 min, so devices see ~2 renders per cached fetch — time-based fields (countdowns,
            // no-telemetry progress) still advance per render; only API data is held for the full TTL
            activeMs:              minutes('AERODATABOX_ACTIVE_TTL_MIN', 30),
            // Settled flights keep the same flight number until next day's operation — 4hr cache is safe
            settledMs:             minutes('AERODATABOX_SETTLED_TTL_MIN', 240),
            // if a flight number is not found, set the TTL to 55 minutes instead of 4 hours
            // don't want to cache for 4 hours for something that COULD change into something real
            notFoundMs:            minutes('AERODATABOX_NOT_FOUND_TTL_MIN', 55),
            // Gate/check-in/delay changes cluster in the last couple hours before departure — refresh faster there
            nearDepartureMs:       minutes('AERODATABOX_NEAR_DEPARTURE_TTL_MIN', 15),
            nearDepartureWindowMs: minutes('AERODATABOX_NEAR_DEPARTURE_WINDOW_MIN', 120),
        } satisfies CacheTtls,
    }
}