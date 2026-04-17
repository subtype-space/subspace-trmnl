import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js' // validate and build config object
import { logger } from './utils/logger.js'
import express, { Request, Response } from 'express'
import { initTrmnlDB, pruneStaleTokens } from './utils/dbConnector.js'
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

// Factory: creates a fresh McpServer + transport per request.
// The MCP SDK disallows reconnecting a server to a new transport, so we must
// create a new instance each time rather than reusing a singleton.
function createMcpHandler() {
  const server = new McpServer(
    { name: 'subspace-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )
  registerTools(server)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  return { server, transport }
}

const mcpReady = true
logger.info('MCP server is ready')

// TODO: switch to PG connection vs flat file
logger.info('Initializing DB...')
initTrmnlDB()
pruneStaleTokens()
const TOKEN_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // once a day
setInterval(pruneStaleTokens, TOKEN_CLEANUP_INTERVAL_MS).unref()

// Express setup
const server = express()
const PORT = config.api.port

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

server.all(
  '/mcp',
  logIncomingAuth,
  authMiddleware,
  userAuthMiddleware, // BFF pattern: verify X-User-Authorization for defense-in-depth
  rateLimiter,
  logAuthedIdentity,
  async (req: Request, res: Response) => {
    const { server, transport } = createMcpHandler()
    await server.connect(transport)

    const authInfo = (req as any).authInfo as AuthInfo | undefined
    if (authInfo) {
      // Wrap MCP handler with auth context using AsyncLocalStorage.
      // This makes authInfo available to tool handlers via getAuthInfo()/requireScope()
      // without having to pass it through the MCP SDK's internal call chain.
      // See oauth.ts for detailed explanation of why this is needed.
      await runWithAuth(authInfo, async () => {
        await transport.handleRequest(req, res, req.body)
      })
    } else {
      await transport.handleRequest(req, res, req.body)
    }
  }
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

// oauth
// oauthMetadataRouter should automatically mount /.well-known/oauth-protected-resource and etc.
server.use(oauthMetadataRouter)

server.use((err: any, _req: any, res: any, _next: any) => {
  logger.error('[UNHANDLED]', err?.stack ?? err)
  if (res.headersSent) return
  res.status(500).json({ error: 'server_error', error_description: 'Internal Server Error' })
})

const httpServer = server.listen(PORT, () => {
  logger.info('Using log level', config.api.logLevel)
  logger.info('Using API version:', config.api.activeVersion)
  logger.info('subspace API now listening on PORT:', config.api.port)
})

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully')
  httpServer.close(() => {
    logger.info('Server closed')
    process.exit(0)
  })
})
