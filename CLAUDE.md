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

### Dual-Purpose Server
The server (`src/server.ts`) runs both:
1. **Express REST API** - Traditional HTTP endpoints
2. **Stateless MCP Server** - Model Context Protocol server using `@modelcontextprotocol/sdk` with StreamableHTTPServerTransport

### Directory Structure
- `src/v1/` - Versioned API (routers, controllers, MCP tool implementations)
- `src/auth/` - OAuth/authentication (oauth.ts for MCP bearer auth, trmnlAuth.ts for TRMNL plugin auth)
- `src/integrations/` - External API clients (WMATA metro)
- `src/types/` - TypeScript type definitions
- `src/utils/` - Shared utilities (logger, database, rate limiter)

### Authentication Flow
- MCP endpoint (`/mcp`) uses OAuth 2.0 token introspection with a Keycloak-based auth server
- The auth middleware (`src/auth/oauth.ts`) validates bearer tokens by calling the introspection endpoint
- TRMNL plugin uses hash-based token validation stored in SQLite

### MCP Tools
Tools are registered in `src/v1/mcp/registerTools.ts`:
- `get-alerts` - NWS weather alerts by state
- `get-forecast` - Weather forecast by coordinates
- `get-stock` - Stock quotes via yahoo-finance2
- `get-wmata-incidents` - DC Metro rail incidents
- `get-wmata-station-info` - Metro station arrival predictions

### Database
Uses better-sqlite3 for local persistence (SQLite). Database initialization and queries are in `src/utils/dbConnector.ts`. The DB path defaults to `./trmnl.sqlite` or can be set via `TRMNL_DB_PATH` env var.

### Key Routes
- `/mcp` - MCP server endpoint (requires OAuth)
- `/mcp/health` - MCP health check
- `/health` - API health check
- `/v1/trmnl/*` - TRMNL plugin endpoints for DC Metro widget
- `/discord/token` - Discord OAuth token exchange

## Environment Variables

Required for core functionality:
- `API_CLIENT_ID`, `API_CLIENT_SECRET` - OAuth client credentials for token introspection
- `AUTH_SERVER_URL`, `AUTH_REALM` - Keycloak authentication server
- `MCP_SERVER_URL` - Resource server URL for audience validation
- `WMATA_PRIMARY_KEY` - WMATA API key for metro data

Optional:
- `PORT` - Server port (default: 9595)
- `LOG_LEVEL` - Logging level (default: info)
- `TRMNL_DB_PATH` - SQLite database path

## Flight tracker API economics (as of July 2026)

The flight tracker runs on AeroDataBox via api.market ($15/mo, 24k units). Each lookup is ~2 units and we sit around 55-60% of quota at 180 installs, so there's room to roughly double before needing the next tier. Revisit at ~85% sustained usage — upgrade the AeroDataBox tier, don't switch providers. TRMNL revenue (~$32/mo) covers the API cost.

We evaluated the Flightradar24 API and passed on it. Their API (unlike their website) has no schedule or status data — no scheduled times, delays, or cancellations — and at 8 credits per flight we'd have zero quota headroom. Their 60k credit Explorer promo also shrinks to 30k after Dec 31, 2026, and credit top-ups require an active subscription, so there's no cheap standalone option. If schedule coverage ever becomes the real problem, compare against FlightAware AeroAPI or OAG, not FR24.

Data quality note: `CanceledUncertain` from AeroDataBox usually means "no live data attached" (their marketing-number-to-callsign mapping breaks on regional/codeshare flights, e.g. UA4012), not a confirmed cancellation. aeroClient logs these occurrences — check the logs before assuming flights are actually being canceled.

## Release strategy

If on the dev branch, do not create tags or push tags to this branch. Tags should ideally only be created on the v1 branch.
CI/CD automatically cuts a GitHub release when a tag is pushed to the v1 branch — do not manually create releases via `gh release create`. To trigger a release, push a tag to v1 and CI/CD will handle the rest.
If creating a new release, be sure to ask the user if they wish to create one. This should happen after a merge request is done in GitHub. If creating a new release, grab the latest tag and incriment it (e.g. 1.5.5 -> 1.5.6), unless user specifies otherwise.

Major version bump example: 1.5.5 -> 2.0.0 | 2.5.3 -> 3.0.0
Minor version bump example: 1.5.5 -> 1.6.0 | 2.9.3 -> 2.10.0
Patch version bump example: 1.5.5 -> 1.5.6 | 1.9.9 -> 1.9.10

When bumping the version on the v1 branch, use `npm version <patch|minor|major> --no-git-tag-version` instead of hand-editing the `version` field in `package.json`. This updates `package.json` and `package-lock.json` together so their `version` fields never drift — a PR check (`.github/workflows/pr-check.yml`) fails the build if they disagree. Commit both files, then tag and push per the flow above.