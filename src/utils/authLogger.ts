import { Request, Response, NextFunction } from 'express'
import { logger } from './logger.js'

// Log incoming IP address and country for each request
// Mainly for debugging to prevent abuse or checking for TRMNL worker IPs. This is not an auth check, just logging
export function logIncomingIP(req: Request, _res: Response, next: NextFunction) {
  const ip = (req.headers["cf-connecting-ip"] as string) ?? req.ip
  const country = (req.headers["cf-ipcountry"] as string) ?? "unknown country"

  const auth = req.headers.authorization ?? ""
  const hasBearer = auth.toLowerCase().startsWith("bearer ")

  logger.info(`Connection from ${ip} - ${country} - bearer=${hasBearer}`)
  next()
}

export function logAuthedIdentity(req: Request, _res: Response, next: NextFunction) {
  const authInfo = (req as any).authInfo ?? null
  if (authInfo) {
    logger.info(`[AUTH] Incoming Authenticated client=${authInfo.clientId}`)
    logger.debug(`[AUTH] Debug scopes: ${(authInfo.scopes ??[]).join(' ')}`)
  } else {
    logger.debug('[AUTH] No authInfo on request')
  }
  next()
}
