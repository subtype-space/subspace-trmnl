# subspace-api
subspace-api is an express-based RESTful API and stateless Model Context Protocol (MCP) server.

If you are utilizing this API provided and hosted by us, please be sure to abide by the [TOS](https://wiki.subtype.space/s/tos). Otherwise, you are free to clone and self host provided you abide by the GNU GPLv3 license, and the TOS will not pertain to you!

# Getting Started
## With Docker (preferrably compose)
### Building your own image
```
docker compose build && docker compose up -d
```
### Pulling from stable releases
```
docker compose pull && docker compose up -d
```

## Manual build
Single line start, attached
```
npm run build && npm run start
```

# Setting up your .env
| Env var | Purpose |
|---------|--------|
| ACTIVE_VERSION | Defaults to 'v1', currently not implemented fully. |
| ACTIVITY_DISCORD_CLIENT_ID | Used for Discord OAuth when serving a Discord activity |
| ACTIVITY_DISCORD_CLIENT_SECRET | Used for Discord OAuth when serving a Discord activity |
| API_CLIENT_ID | REQUIRED to perform token introspection. Used to communicate with Auth server |
| API_CLIENT_SECRET | See above. |
| AUTH_SERVER_URL | The authentication server for OAuth implementation |
| AUTH_REALM | (keycloak based) the realm associated with both incoming clients, and the MCP server OAuth client |
| LOG_LEVEL | Defaults to 'info'. Set the logging level. |
| MCP_SERVER_URL | This sets the Protected Resource of what the incoming clients should have in their audience claim |
| PORT | Defaults to 9595. The port for the API and MCP server to listen on. |
| WMATA_PRIMARY_KEY | The API key to use for obtaining WMATA status. |
| TZ | (Optional) Lets the container/logger format log messages with the machine's local time zone. |

# AI Disclosure
Parts of this project were assisted with OpenAI/Claude Code by having them provide examples for implementation.
Some parts of the code base were refactored by Claude Code/OpenAI suggestion to improve efficiency (TS is new to me)

It is subspace's responsibilty to examine the output of these LLMs to look for accuracy, implementation detail, and direction.

# Disclaimer & Fair Use

This flight tracker contains logos and banners of various airlines and aviation operators.

**Fair Use Notice:** These images are the property of their respective owners (airlines and operators). They are provided here for **educational and identification purposes only** (e.g., to identify airlines in flight tracking applications).

* This use is considered **Fair Use** under copyright law as it is non-commercial, transformative (aggregating for identification), and does not impede the owners' ability to profit from their branding.
* The repository does not claim ownership of any trademarks or copyrighted material.