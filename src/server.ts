import './utils/env.js' // I hate how I have to do this but whatever. Stupid shim.
import { logger } from './utils/logger.js'
import express, { Request, NextFunction, Response, RequestHandler } from 'express'
import { initTrmnlDB } from './utils/dbConnector.js'
import trmnlRouter from './v1/routers/trmnlRouter.js'
import statusRouter from './v1/routers/statusRouter.js'
import helmet from 'helmet'

// OAuth implementation
import { oauthMetadataRouter, authMiddleware } from './auth/oauth.js'

// MCP import shenanigans
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerTools } from './v1/mcp/registerTools.js'

import { logAuthedIdentity, logIncomingAuth } from './utils/authLogger.js'
import { rateLimiter } from './utils/rateLimiter.js'

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
const PORT = process.env.PORT || 9595
const ACTIVE_VERSION = process.env.API_VERSION || 'v1'

// reverse proxy -- removing this will cause issues with secure cookies
server.set('trust proxy', 1)

logger.info('Setting up middleware...')
server.use(helmet())
server.use(rateLimiter)
server.use(express.json())
// Declare regular REST API routing
logger.info('Initializing routes...')

server.use('/', statusRouter)
server.use('/health', express.json(), statusRouter)
server.use('/v1/trmnl', trmnlRouter)

// Wrapper around the handleRequest - I don't know if this is actually needed but it was suggested to me
const safe = (fn: RequestHandler): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

const mark = (name: string) => (req: Request, _res: Response, next: NextFunction) => {
  logger.info(`[PIPE] ${name} authInfo=${Boolean((req as any).authInfo)}`)
  next()
}

server.all(
  '/mcp',
  mark('A before logIncomingAuth'),
  logIncomingAuth,
  mark('B before authMiddleware'),
  authMiddleware,
  mark('C before rateLimiter'),
  rateLimiter,
  mark('D before handler'),
  safe(async (req: Request, res: Response) => {
    await mcpTransport.handleRequest(req, res, req.body)
  })
)

// server.all(
//   '/mcp',
//   logIncomingAuth,
//   authMiddleware,
//   rateLimiter,
//   logAuthedIdentity,
//   safe(async (req: Request, res: Response) => {
//     await mcpTransport.handleRequest(req, res, req.body)
//   })
// )

server.get('/mcp/health', async (_: Request, res: Response) => {
  if (!mcpReady) {
    res.status(503).json({
      status: 'unhealthy',
      reason: 'MCP server not ready',
    })
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
  logger.info(`Using log level: ${process.env.LOG_LEVEL || 'info'}`)
  logger.info('Using API version:', ACTIVE_VERSION)
  logger.debug('MCP Server debug:', mcpServer)
  logger.info('subspace API now listening on PORT:', PORT)
})
