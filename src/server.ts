import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js' // validate and build config object
import { logger } from './utils/logger.js'
import express, { Request, NextFunction, Response, RequestHandler } from 'express'
import { initTrmnlDB } from './utils/dbConnector.js'
import trmnlRouter from './v1/routers/trmnlRouter.js'
import statusRouter from './v1/routers/statusRouter.js'
import helmet from 'helmet'

// OAuth implementation
import { oauthMetadataRouter, authMiddleware, userAuthMiddleware } from './auth/oauth.js'

// MCP import shenanigans
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerTools } from './v1/mcp/registerTools.js'

import { logAuthedIdentity, logIncomingAuth } from './utils/authLogger.js'
import { rateLimiter } from './utils/rateLimiter.js'
import { runWithAuth } from './auth/oauth.js'
import { AuthInfo } from './types/oauth/types.js'

logger.info('Starting up subspace-api!')
logger.info('Initializing stateless MCP server...')
const mcpServer = new McpServer(
  {
    name: 'subspace-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// Create transport stateless
const mcpTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
})
logger.info('Registering tools with MCP server...')
registerTools(mcpServer)

let mcpReady = false
try {
  await mcpServer.connect(mcpTransport)
  logger.info('MCP server is ready')
  mcpReady = true
} catch (err) {
  logger.error('There was an error connecting the MCP server to transport', err)
}

// TODO: switch to PG connection vs flat file
logger.info('Initializing DB...')
initTrmnlDB()

// Express setup
const server = express()
const PORT = config.api.port
const ACTIVE_VERSION = config.api.activeVersion

// reverse proxy -- removing this will cause issues with secure cookies
server.set('trust proxy', 1)

logger.info('Setting up middleware...')
server.use(helmet())
server.use(express.json())
// Declare regular REST API routing
logger.info('Initializing routes...')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
server.use(
  '/public',
  (req, _res, next) => {
    logger.info(`[STATIC] ${req.method} ${req.path}`)
    next()
  },
  helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }),
  express.static(path.join(__dirname, 'public'), { maxAge: '7d' })
)

server.use('/health', rateLimiter, express.json(), statusRouter)
server.use('/v1/trmnl', rateLimiter, trmnlRouter)

// Wrapper around the handleRequest - I don't know if this is actually needed but it was suggested to me
const safe = (fn: RequestHandler): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

server.all(
  '/mcp',
  logIncomingAuth,
  authMiddleware,
  userAuthMiddleware, // BFF pattern: verify X-User-Authorization for defense-in-depth
  rateLimiter,
  logAuthedIdentity,
  safe(async (req: Request, res: Response) => {
    const authInfo = (req as any).authInfo as AuthInfo | undefined
    if (authInfo) {
      // Wrap MCP handler with auth context using AsyncLocalStorage.
      // This makes authInfo available to tool handlers via getAuthInfo()/requireScope()
      // without having to pass it through the MCP SDK's internal call chain.
      // See oauth.ts for detailed explanation of why this is needed.
      await runWithAuth(authInfo, async () => {
        await mcpTransport.handleRequest(req, res, req.body)
      })
    } else {
      await mcpTransport.handleRequest(req, res, req.body)
    }
  })
)

server.get('/mcp/health', async (_: Request, res: Response) => {
  if (!mcpReady) {
    res.status(503).json({
      status: 'unhealthy',
      reason: 'MCP server not ready',
    })
    return
  }
  res.status(200).json({ status: 'ok' })
})

// discord activity auth
// Discord enpoint to return oauth2 token after user authentication
server.post('/discord/token', logIncomingAuth, async (req, res) => {
  // Exchange the code for an access_token
  const response = await fetch(`https://discord.com/api/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: process.env.ACTIVITY_DISCORD_CLIENT_ID!,
      client_secret: process.env.ACTIVITY_DISCORD_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code: req.body.code,
    }),
  })

  // Retrieve the access_token from the response
  const { access_token } = await response.json()

  // Return the access_token to our client as { access_token: "..."}
  res.send({ access_token })
})

// oauth
// oauthMetadataRouter should automatically mount /.well-known/oauth-protected-resource and etc.
server.use(oauthMetadataRouter)

server.use((err: any, _req: any, res: any, _next: any) => {
  logger.error('[UNHANDLED]', err?.stack ?? err)
  if (res.headersSent) return
  res.status(500).json({ error: 'server_error', error_description: 'Internal Server Error' })
})

server.listen(PORT, () => {
  logger.info('Using log level', config.api.logLevel)
  logger.info('Using API version:', config.api.activeVersion)
  logger.debug('MCP Server debug:', mcpServer)
  logger.info('subspace API now listening on PORT:', config.api.port)
})
