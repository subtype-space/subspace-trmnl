import { Request, Response, NextFunction } from "express"
import { logger } from "./logger.js"

export function logIncomingAuth(req: Request, _res: Response, next: NextFunction) {
  const ip = (req.headers["cf-connecting-ip"] as string) ?? req.ip
  const country = (req.headers["cf-ipcountry"] as string) ?? "unknown country"

  const auth = req.headers.authorization ?? ""
  const hasBearer = auth.toLowerCase().startsWith("bearer ")

  logger.info(`[AUTH] Connection from ${ip} - ${country} bearer=${hasBearer}`)
  next()
}

export function logAuthedIdentity(req: Request, _res: Response, next: NextFunction) {
  const authInfo = (req as any).auth ?? (req as any).mcpAuth ?? (req as any).oauth ?? null
  if (authInfo) {
    logger.info(`[AUTH] Authenticated client=${authInfo.clientId} scopes=${(authInfo.scopes ?? []).join(" ")}`)
  }
  next()
}
