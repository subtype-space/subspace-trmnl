# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
# Build TypeScript
npm run build

# Start server (requires build first)
npm run start

# Build and start in one command
npm run build && npm run start

# Docker build and run
docker compose build && docker compose up -d

# Pull from registry and run
docker compose pull && docker compose up -d
```

## Code Style

- Uses Prettier with: no semicolons, single quotes, 2-space tabs, 128 char line width
- ES modules (`"type": "module"` in package.json) - use `.js` extensions in imports even for TypeScript files
- TypeScript strict mode enabled, targeting ES2022

## Architecture

### TRMNL Plugin Backend
The server (`src/server.ts`) is an Express REST API serving TRMNL e-ink plugins (DC Metro rail predictions, flight tracker).

### Directory Structure
- `src/v1/` - Versioned API (routers, controllers)
- `src/auth/` - TRMNL plugin auth (`trmnlAuth.ts`, hash-based tokens stored in SQLite)
- `src/integrations/` - External API clients (WMATA metro, AeroDataBox flights)
- `src/types/` - TypeScript type definitions
- `src/utils/` - Shared utilities (logger, database, rate limiter)

### Database
Uses better-sqlite3 for local persistence (SQLite). Database initialization and queries are in `src/utils/dbConnector.ts`. The DB path defaults to `./trmnl.sqlite` or can be set via `TRMNL_DB_PATH` env var.

### Key Routes
- `/health` - API health check
- `/v1/trmnl/*` - TRMNL plugin endpoints (DC Metro, flight tracker)

### Deprecated: MCP server + Keycloak OAuth
`deprecated/` holds the old MCP tool server (weather, stock, WMATA-as-MCP-tools) and the Keycloak OAuth resource-server code that protected it, moved out of `src/` on 2026-08-16 because nothing was calling it — see git history for context. `tsconfig.json` only includes `src/**/*`, so this folder isn't built. Kept as a reference rather than deleted; restoring it means restoring `config.auth` in `src/config.ts` too.

## Environment Variables

Required for core functionality:
- `PUBLIC_BASE_URL` - Public origin this service is reached at (used to build absolute URLs in TRMNL markup, e.g. airline logo banners)
- `WMATA_PRIMARY_KEY` - WMATA API key for metro data

Optional:
- `PORT` - Server port (default: 9595)
- `LOG_LEVEL` - Logging level (default: info)
- `TRMNL_DB_PATH` - SQLite database path
- `ASSET_CACHE_BUST` - Append `?v=<app version>` to static asset URLs (airline logo banners) so a deploy busts the 7-day `maxAge` cache instead of waiting it out (default: false)

## Flight tracker API economics (as of July 2026)

The flight tracker runs on AeroDataBox via api.market ($15/mo, 24k units). Each lookup is ~2 units and we sit around 55-60% of quota at 180 installs, so there's room to roughly double before needing the next tier. Revisit at ~85% sustained usage — upgrade the AeroDataBox tier, don't switch providers. TRMNL revenue (~$32/mo) covers the API cost.

We evaluated the Flightradar24 API and passed on it. Their API (unlike their website) has no schedule or status data — no scheduled times, delays, or cancellations — and at 8 credits per flight we'd have zero quota headroom. Their 60k credit Explorer promo also shrinks to 30k after Dec 31, 2026, and credit top-ups require an active subscription, so there's no cheap standalone option. If schedule coverage ever becomes the real problem, compare against FlightAware AeroAPI or OAG, not FR24.

Data quality note: `CanceledUncertain` from AeroDataBox usually means "no live data attached" (their marketing-number-to-callsign mapping breaks on regional/codeshare flights, e.g. UA4012), not a confirmed cancellation. aeroClient logs these occurrences — check the logs before assuming flights are actually being canceled.

Airline logo banners (`/public/radarbox_banners/*.png`) missing on a rendered TRMNL screen is very likely **Cloudflare hotlink protection**, not a bug in `renderer.ts` or the AeroDataBox lookup. TRMNL's rendering pipeline fetches these images server-side (no browser `Referer` header) to dither them for e-ink, so hotlink protection blocks the fetch silently — no error surfaces anywhere in our logs, and the generated `<img src>` tests fine with a plain `curl`. Static asset `maxAge`/cache TTL is unrelated and won't fix this; check the Cloudflare hotlink protection setting for the zone first.

## Release strategy

If on the dev branch, do not create tags or push tags to this branch. Tags should ideally only be created on the v1 branch.
CI/CD automatically cuts a GitHub release when a tag is pushed to the v1 branch — do not manually create releases via `gh release create`. To trigger a release, push a tag to v1 and CI/CD will handle the rest.
If creating a new release, be sure to ask the user if they wish to create one. This should happen after a merge request is done in GitHub. If creating a new release, grab the latest tag and incriment it (e.g. 1.5.5 -> 1.5.6), unless user specifies otherwise.

Major version bump example: 1.5.5 -> 2.0.0 | 2.5.3 -> 3.0.0
Minor version bump example: 1.5.5 -> 1.6.0 | 2.9.3 -> 2.10.0
Patch version bump example: 1.5.5 -> 1.5.6 | 1.9.9 -> 1.9.10

When bumping the version on the v1 branch, use `npm version <patch|minor|major> --no-git-tag-version` instead of hand-editing the `version` field in `package.json`. This updates `package.json` and `package-lock.json` together so their `version` fields never drift — a PR check (`.github/workflows/pr-check.yml`) fails the build if they disagree. Commit both files, then tag and push per the flow above.