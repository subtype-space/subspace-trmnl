import './utils/env.js' // I hate how I have to do this but whatever. Stupid shim.
import { logger } from './utils/logger.js'
import express, { Request, NextFunction, Response, RequestHandler } from 'express'
import trmnlRouter from './v1/routers/trmnlRouter.js'
import statusRouter from './v1/routers/statusRouter.js'
import helmet from 'helmet'
import session from 'express-session'

import KeycloakConnect from 'keycloak-connect'
import { keycloakConfig } from './configs/keycloakConfig.js'

// OAuth implementation
import { oauthMetadataRouter, authMiddleware } from './utils/oauth.js'

// MCP import shenanigans
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerTools } from './v1/mcp/registerTools.js'

import { logAuthedIdentity, logIncomingAuth } from './utils/auth.js'
import { rateLimiter } from './utils/rateLimiter.js'
import { wrap } from 'module'

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
logger.debug(mcpServer)

// Express setup
const server = express()
const PORT = process.env.PORT || 9595
const ACTIVE_VERSION = process.env.API_VERSION || 'v1'
const memoryStore = new session.MemoryStore()
const keycloak = new KeycloakConnect({ store: memoryStore }, keycloakConfig)

server.use((req, _res, next) => {
  logger.info(`[REQ] ${req.method} ${req.path}`)
  next()
})

// reverse proxy -- removing this will cause issues with secure cookies
server.set('trust proxy', 1)

logger.info('Setting up middleware...')
// SESSION_SECRET should just be a super long random base64 encoded string
// server.use(
//   session({
//     secret: process.env.SESSION_SECRET!,
//     resave: false,
//     saveUninitialized: true,
//     store: memoryStore,
//     cookie: {
//       secure: true, // Setting this to true requires trust proxy set in express
//     },
//   })
// )
// server.use(keycloak.middleware())
server.use(helmet())
server.use(rateLimiter)
server.use(express.json())
// Declare regular REST API routing
logger.info('Initializing routes...')

//server.use('/v1/trmnl', express.json(), trmnlRouter) disable this route because it's just not active right now
server.use('/', statusRouter)
server.use('/health', express.json(), statusRouter)

const safe = (fn: RequestHandler): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

const authMiddlewareWithDiag: RequestHandler = (req, res, next) => {
  const origJson = res.json.bind(res)
  res.json = (body: any) => {
    logger.error('[AUTH] authMiddleware responded', {
      status: res.statusCode,
      wwwAuthenticate: res.getHeader('www-authenticate') ?? res.getHeader('WWW-Authenticate') ?? 'none',
      body,
    })
    return origJson(body)
  }
  return (authMiddleware as any)(req, res, next)
}

const wrappedAuth: RequestHandler = async (req, res, next) => {
  try {
    await new Promise<void>((resolve, reject) => {
      (authMiddleware as any)(req, res, (err?: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
    next();
  } catch (e: any) {
    logger.error("[AUTH] wrappedAuth caught error from requireBearerAuth", {
      name: e?.name,
      message: e?.message,
      stack: e?.stack,
    });
    // If the SDK already wrote a response, don’t double-send
    if (res.headersSent) return;
    res.status(500).json({ error: "server_error", error_description: "Internal Server Error" });
  }
};


server.all(
  '/mcp',
  (req, res, next) => {
    res.on('finish', () => {
      logger.info(`[MCP] response ${res.statusCode}`)
      logger.info(`[MCP] www-authenticate=${res.getHeader('www-authenticate') ?? 'none'}`)
    })
    next()
  },
  logIncomingAuth,
  wrappedAuth,
  (req, _res, next) => {
    logger.info('[MCP] after auth middleware', {
      hasAuth: Object.prototype.hasOwnProperty.call(req as any, 'auth'),
      authType: typeof (req as any).auth,
      extensible: Object.isExtensible(req),
    })
    next()
  },
  safe(async (req: Request, res: Response) => {
    await mcpTransport.handleRequest(req, res, req.body)
  })
)

// // MCP Setup - stateless
// server.all('/mcp', logIncomingAuth, authMiddleware, logAuthedIdentity, async (req, res) => {
//   try {
//     await mcpTransport.handleRequest(req, res, req.body)
//   } catch (err) {
//     logger.error('MCP transport error:', err)
//     res.status(500).json({
//       error: 'MCP transport failure',
//       detail: err
//     })
//   }
// })

server.get('/mcp/health', async (_: Request, res: Response) => {
  if (!mcpReady) {
    res.status(503).json({
      status: 'unhealthy',
      reason: 'MCP server not connected to transport',
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
// server.get('/.well-known/oauth-protected-resource', async (_: Request, res: Response) => {
//   const baseURL = `https://api.subtype.space`
//   res.json({
//     resource: baseURL,
//     authorization_servers: [`https://auth.subtype.space`],
//   })
// })

// server.get('/.well-known/oauth-authorization-server', async (_: Request, res: Response) => {
//   const baseURL = `https://api.subtype.space`
//   res.json({
//     resource: baseURL,
//     authorization_servers: [`https://auth.subtype.space`],
//   })
// })

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
