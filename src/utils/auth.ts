// TODO: fine-grained tool access
// https://developers.cloudflare.com/agents/model-context-protocol/authorization/

import { Request, Response, NextFunction } from 'express'
import { logger } from './logger.js'

// all of this may change due to keycloak oauth support
export function logIncomingAuth(req: Request, res: Response, next: NextFunction) {
  logger.info(
    `[AUTH] Connection from ${req.headers['cf-connecting-ip'] ?? req.ip} - ${req.headers['cf-ipcountry'] ?? 'unknown country'}`
  )

  // For Keycloak-specific OIDC
  // TODO -- users may not want Keycloak, make this optional/toggle disable
  const user = req.kauth?.grant?.access_token?.content
  if (user) {
    logger.info(`[AUTH] Authenticated as ${user.preferred_username ?? user.clientId ?? 'unknown'} (${user.sub})`)
  } else {
    logger.warn('[AUTH] No grant found on request')
  }

  next()
}