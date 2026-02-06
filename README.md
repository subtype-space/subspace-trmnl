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