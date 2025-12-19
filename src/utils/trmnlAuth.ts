import crypto from 'crypto'
import { Request, Response, NextFunction, RequestHandler } from 'express'
import { isKnownTrmnlToken, touchTrmnlToken } from '../utils/trmnlStore.js'
import { logger } from './logger.js'

const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex')

export const requireTrmnlAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const auth = req.header('authorization') ?? ''
  const match = auth.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    res.status(401).send('Unauthorized')
    return
  }

  const tokenHash = sha256(match[1])

  if (!(await isKnownTrmnlToken(tokenHash))) {
    res.status(401).send('Unauthorized')
    return
  }

  await touchTrmnlToken(tokenHash)
  ;(req as any).trmnl = { tokenHash }

  next()
}