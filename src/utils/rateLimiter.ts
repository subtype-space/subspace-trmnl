import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit'
import { logger } from './logger.js'
import { Request, Response } from 'express'
import { getTRMNLIPs } from '../auth/trmnlAuth.js'

let ips: Set<string> = new Set()

async function refreshTRMNLIPs() {
  ips = await getTRMNLIPs()
}

function isTrmnlWorkerIp(ip: string) {
  return ips.has(ip)
}

// warm up trmnl worker ips and refresh every 24 hours
refreshTRMNLIPs()
setInterval(() => void refreshTRMNLIPs(), 24 * 60 * 60 * 1000).unref()

function getClientIp(req: Request): string {
  const h = req.headers['cf-connecting-ip']
  const cf = Array.isArray(h) ? h[0] : h
  return (cf ?? req.ip ?? 'unknown').toString()
}

function getAuthSub(req: Request): string | undefined {
  const authInfo = (req as any).authInfo
  const sub = authInfo?.extra?.sub
  return typeof sub === 'string' && sub.length > 0 ? sub : undefined
}

export const rateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: (req: Request): number => {
    const ip = getClientIp(req)
    const sub = getAuthSub(req)
    if (isTrmnlWorkerIp(ip)) {
      logger.info(`Rate limit check for TRMNL IP: ${ip}`)
      return 60
    }
    logger.info(`Rate limit check for ${sub ? 'authenticated' : 'anon'} - ${ip}`)
    return sub ? 60 : 5
  },
  keyGenerator: (req: Request) => {
    const sub = getAuthSub(req)
    return sub ? `user:${sub}` : `ip:${getClientIp(req)}`
  },
  handler: (req: Request, res: Response) => {
    const ip = getClientIp(req)
    logger.warn('Rate limiting IP address:', ip)
    res.status(429).json({ error: 'Too Many Requests', message: 'Rate limited' })
  },
})
