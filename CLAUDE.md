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
- `src/integrations/` - External API clients (WMATA metro, Proxmox)
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
- `get-proxmox-nodes` - Proxmox cluster node status
- `get-proxmox-vms` - List VMs/containers across cluster
- `get-proxmox-vm-status` - Detailed VM/container status by VMID
- `proxmox-vm-action` - VM actions (skeleton, not fully implemented)

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
- `PROXMOX_API_URL` - Proxmox VE API URL
- `PROXMOX_API_TOKEN` - Proxmox API token (format: `USER@REALM!TOKENID=UUID`)
- `PROXMOX_SKIP_TLS_VERIFY` - Set to `true` for self-signed certs

## Release strategy

If on the dev branch, do not create tags or push tags to this branch. Tags should ideally only be created on the v1 branch.
If creating a new release, be sure to ask the user if they wish to create one. This should happen after a merge request is done in GitHub. If creating a new release, grab the latest tag and incriment it (e.g. 1.5.5 -> 1.5.6), unless user specifies otherwise.