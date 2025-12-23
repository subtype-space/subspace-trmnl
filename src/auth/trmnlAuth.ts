import crypto from 'crypto'
import { Request, Response, NextFunction, RequestHandler } from 'express'
import { isValidAccessToken, touchTrmnlToken } from '../utils/dbConnector.js'
import { logger } from '../utils/logger.js'
import { getUserUuidByTokenHash } from '../utils/dbConnector.js'

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')

export const requireTrmnlAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  logger.info('[AUTH] Checking TRMNL authentication')
  const auth = req.header('authorization') ?? ''
  const match = auth.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    logger.warn('[AUTH] - TRMNL No auth header detected')
    res.status(401).send('Unauthorized')
    return
  }

  const tokenHash = sha256(match[1])

  if (!(await isValidAccessToken(tokenHash))) {
    logger.info('[AUTH] Unrecognized TRMNL token hash')
    logger.debug(tokenHash)
    res.status(401).send('Unauthorized')
    return
  }

  // Attach token hash to request
  await touchTrmnlToken(tokenHash)
  ;(req as any).trmnl = { tokenHash }

  next()
}

function readUuid(req: any): string | undefined {
  // /markup + /uninstall (form or json)
  if (typeof req.body?.user_uuid === 'string' && req.body.user_uuid) return req.body.user_uuid

  // install_success (json)
  if (typeof req.body?.user?.uuid === 'string' && req.body.user.uuid) return req.body.user.uuid

  return undefined
}

export const requireTrmnlUuidMatch: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  logger.debug('Checking if UUID is bound')
  const tokenHash = (req as any).trmnl?.tokenHash as string | undefined
  if (!tokenHash) {
    logger.warn('[AUTH] No token provided')
    res.status(401).json({ error: 'missing trmnl auth context' })
    return
  }

  const uuid = readUuid(req)
  if (!uuid) {
    logger.warn('[AUTH] Missing UUID')
    res.status(400).json({ error: 'missing uuid' })
    return
  }

  const bound = getUserUuidByTokenHash(tokenHash)
  if (!bound) {
    // IMPORTANT: do not bind here; install_success is the place to bind.
    logger.warn('[AUTH] UUID not bound')
    res.status(401).json({ error: 'uuid_not_bound' })
    return
  }

  if (bound !== uuid) {
    logger.warn('[AUTH] token/uuid mismatch', { bound, uuid })
    res.status(401).json({ error: 'uuid_mismatch' })
    return
  }

  logger.debug('[AUTH] found binding', {bound, uuid})

  ;(req as any).trmnl = { ...(req as any).trmnl, userUuid: bound }
  next()
}