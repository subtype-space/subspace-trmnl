import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit'
import { Request, Response } from 'express'
import { logger } from './logger.js'
import { getTRMNLIPs } from '../auth/trmnlAuth.js'

function getClientIp(req: Request): string {
  const h = req.headers['cf-connecting-ip']
  const cf = Array.isArray(h) ? h[0] : h
  return (cf ?? req.ip ?? 'unknown').toString()
}

export const rateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: async (req: Request): Promise<number> => {
    const ip = getClientIp(req)
    const ips = await getTRMNLIPs()
    if (ips.has(ip)) {
      logger.debug(`Rate limit check for TRMNL IP: ${ip}`)
      return 60
    }
    logger.info(`Rate limit check for anon - ${ip}`)
    logger.info(`${req.method} ${req.originalUrl}`)
    return 10
  },
  keyGenerator: (req: Request) => `ip:${getClientIp(req)}`,
  handler: (req: Request, res: Response) => {
    const ip = getClientIp(req)
    logger.warn('Rate limiting IP address:', ip)
    res.status(429).json({ error: 'Too Many Requests', message: 'Rate limited' })
  },
})
