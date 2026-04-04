[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E01UIU2O)

# subspace-api
subspace-api is an Express-based RESTful API and stateless Model Context Protocol (MCP) server.

If you are utilizing this API as provided and hosted by us, please be sure to abide by the [TOS](https://wiki.subtype.space/s/tos). Otherwise, you are free to clone and self-host provided you abide by the GNU GPLv3 license, and the TOS will not pertain to you.

## Features

- **MCP Server** — Stateless Model Context Protocol server over HTTP, secured with OAuth 2.0 bearer tokens
- **Weather tools** — NWS alerts and forecasts via MCP
- **Stock quotes** — Real-time stock data via MCP (powered by yahoo-finance2)
- **DC Metro (WMATA)** — Rail incident reports and live arrival predictions; also exposed as MCP tools
- **Flight Tracker** — Live flight status via AeroDataBox (RapidAPI); TRMNL plugin for e-ink display
- **Discord Activity** — OAuth token exchange endpoint for Discord activities

# Getting Started
## With Docker (preferably compose)
### Building your own image
```bash
docker compose build && docker compose up -d
```
### Pulling from stable releases
```bash
docker compose pull && docker compose up -d
```

## Manual build
```bash
npm run build && npm run start
```

# Environment Variables

## Core (required)
| Env var | Purpose |
|---------|---------|
| `API_CLIENT_ID` | OAuth client ID for token introspection against your IdP |
| `API_CLIENT_SECRET` | OAuth client secret for token introspection |
| `AUTH_SERVER_URL` | Base URL of the Keycloak (or compatible) authentication server |
| `AUTH_REALM` | Keycloak realm name used for both incoming clients and the MCP OAuth client |
| `MCP_SERVER_URL` | The resource server URL — incoming tokens must include this in their audience claim |

## Core (optional)
| Env var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `9595` | Port the server listens on |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `ACTIVE_VERSION` | `v1` | API version prefix (not fully implemented) |
| `TZ` | — | Container timezone for log timestamps (e.g. `America/New_York`) |

## TRMNL plugin settings
These are required if you are running TRMNL plugins (metro or flight tracker).

| Env var | Required | Purpose |
|---------|----------|---------|
| `TRMNL_CLIENT_ID` | Yes | OAuth 2.0 client ID provided by TRMNL for your plugin |
| `TRMNL_CLIENT_SECRET` | Yes | OAuth 2.0 client secret paired with `TRMNL_CLIENT_ID` |
| `WMATA_PRIMARY_KEY` | For metro plugin | WMATA API key for DC Metro arrival predictions and incidents |
| `TRMNL_FLIGHTS_CLIENT_ID` | For flight plugin | OAuth 2.0 client ID for the TRMNL flight tracker plugin |
| `TRMNL_FLIGHTS_CLIENT_SECRET` | For flight plugin | OAuth 2.0 client secret paired with `TRMNL_FLIGHTS_CLIENT_ID` |
| `AERODATABOX_API_KEY` | For flight plugin | RapidAPI key for AeroDataBox (live flight status data) |
| `TRMNL_DB_PATH` | No | Path to SQLite database file (default: `./trmnl.sqlite`) |
| `TRMNL_IP_ALLOW_PRIVATE` | No | Set to `true` to bypass TRMNL worker IP allowlist check (useful for local dev) |

## Discord activity settings
| Env var | Purpose |
|---------|---------|
| `ACTIVITY_DISCORD_CLIENT_ID` | Discord OAuth client ID for the activity token exchange endpoint |
| `ACTIVITY_DISCORD_CLIENT_SECRET` | Discord OAuth client secret |

# AI Disclosure
Parts of this project were assisted with Claude Code by having it provide examples for implementation.
Some parts of the codebase were refactored by Claude Code suggestion to improve efficiency.

It is subspace's responsibility to examine the output of these LLMs for accuracy, implementation detail, and direction.

# Disclaimer & Fair Use

This flight tracker contains logos and banners of various airlines and aviation operators.

**Fair Use Notice:** These images are the property of their respective owners (airlines and operators). They are provided here for **educational and identification purposes only** (e.g., to identify airlines in flight tracking applications).

- This use is considered **Fair Use** under copyright law as it is non-commercial, transformative (aggregating for identification), and does not impede the owners' ability to profit from their branding.
- The repository does not claim ownership of any trademarks or copyrighted material.
