import crypto from 'crypto'
import { Request, Response, NextFunction, RequestHandler } from 'express'
import { isKnownTrmnlToken, touchTrmnlToken } from '../utils/dbConnector.js'
import { logger } from '../utils/logger.js'

const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex')

export const requireTrmnlAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.info('[AUTH] Checking TRMNL authentication')
  const auth = req.header('authorization') ?? ''
  const match = auth.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    logger.warn('[AUTH] - TRMNL No auth header detected')
    res.status(401).send('Unauthorized')
    return
  }

  const tokenHash = sha256(match[1])

  if (!(await isKnownTrmnlToken(tokenHash))) {
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