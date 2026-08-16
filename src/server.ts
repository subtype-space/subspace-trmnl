import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js' // validate and build config object
import { logger } from './utils/logger.js'
import express from 'express'
import { initTrmnlDB, pruneStaleTokens } from './utils/dbConnector.js'
import trmnlRouter from './v1/routers/trmnlRouter.js'
import statusRouter from './v1/routers/statusRouter.js'
import helmet from 'helmet'

import { rateLimiter } from './utils/rateLimiter.js'

logger.info('Starting up subspace-trmnl!')

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
    logger.info(`${req.method} ${req.path}`)
    next()
  },
  helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }),
  express.static(path.join(__dirname, 'public'), { maxAge: '7d' })
)

server.use('/health', rateLimiter, express.json(), statusRouter)
server.use('/v1/trmnl', rateLimiter, trmnlRouter)

server.use((err: any, _req: any, res: any, _next: any) => {
  logger.error('[UNHANDLED]', err?.stack ?? err)
  if (res.headersSent) return
  res.status(500).json({ error: 'server_error', error_description: 'Internal Server Error' })
})

const httpServer = server.listen(PORT, () => {
  logger.info('Using log level', config.api.logLevel)
  logger.info('Using API version:', config.api.activeVersion)
  logger.info('subspace-trmnl now listening on PORT:', config.api.port)
})

/**
 * Was having issues for the service taking too long to drain connections
 * So we force stop after after a determinate amount of time
 * @param signal The SIGXXX to intercept
 */
function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`)
  httpServer.closeAllConnections()
  httpServer.close(() => {
    logger.info('Server closed')
    process.exit(0)
  })
  setTimeout(() => {
    logger.warn('service took too long to shut down, killing...')
    process.exit(1)
  }, 8000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))