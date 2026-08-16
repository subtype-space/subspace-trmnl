[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E01UIU2O)

# subspace-trmnl
subspace-trmnl is the service running TRMNL Plugins created by subtype.

This service is provided free of charge to all TRMNL device owners.

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

## Core (optional)
| Env var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `9595` | Port the server listens on |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `ACTIVE_VERSION` | `v1` | API version prefix (not fully implemented) |
| `TZ` | - | Container timezone for log timestamps (e.g. `America/New_York`) |
| `PUBLIC_BASE_URL` | - | Used to build absolute URLs to serve static resources |

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

# AI Disclosure
Parts of this project were assisted with Claude Code by having it provide examples for implementation.
Some parts of the codebase were refactored by Claude Code suggestion to improve efficiency.
Unless noted, the code base was largely written by hand. Some parts of implementing the OAuth 2.0 spec were assisted by LLM.
Some parts for the TRMNL Flight Tracker logic regarding calculations were assisted by LLM, as with information display, but not generated out of thin air.

It is subspace's responsibility to examine the output of these LLMs for accuracy, implementation detail, and direction.

# Disclaimer & Fair Use

This flight tracker contains logos and banners of various airlines and aviation operators.

**Fair Use Notice:** These images are the property of their respective owners (airlines and operators). They are provided here for **educational and identification purposes only** (e.g., to identify airlines in flight tracking applications).

- This use is considered **Fair Use** under copyright law as it is non-commercial, transformative (aggregating for identification), and does not impede the owners' ability to profit from their branding.
- The repository does not claim ownership of any trademarks or copyrighted material.
