/**
 * Custom middleware that performs authentication specifically against TRMNL workers and TRMNL endpoints
 * Middleware exposes a way to parse the Bearer auth token sent from TRMNL and validate it
 * against their .well-known JWKS
 */
import crypto from 'crypto'
import { Request, Response, NextFunction, RequestHandler } from 'express'
import { isKnownTokenHash, touchTrmnlToken } from '../utils/dbConnector.js'
import { logger } from '../utils/logger.js'
import { config } from '../config.js'
import { getUserUuidByTokenHash } from '../utils/dbConnector.js'
import * as jose from 'jose'

let cachedIPs: Set<string> | null = null
let cachedAtMs = 0
let inFlight: Promise<Set<string>> | null = null

const TRMNL_TTL_IPS_MS = 12 * 60 * 60 * 1000 // 12hr cache

// Disallow TRMNL worker IP bypass by default
const TRMNL_IP_ALLOW_BYPASS: boolean = (config.trmnl.bypassIPCheck === 'true')

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')

// This is all middleware
// Do not apply the same type of oauth here
export const requireTrmnlAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  logger.info('[AUTH] TRMNL Auth MW - checking for TRMNL credentials')

  const auth = req.headers.authorization
  if (!auth || typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) {
    logger.warn('[AUTH] - TRMNL No auth header detected or is invalid')
    res.status(401).json({error: 'Unauthorized', message: 'Missing authorization'})
    return
  }

  // Strip 'Bearer ' and only hash token
  const tokenHash = sha256(auth.slice(7).trim())

  if (!(await isKnownTokenHash(tokenHash))) {
    logger.info('[AUTH] Unrecognized TRMNL token hash')
    logger.debug(tokenHash)
    res.status(401).json({ error: 'Unauthorized', message: 'Access Denied'})
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
  logger.debug('[AUTH] Checking if UUID is bound')
  // tokenHash "should" be the access token we get from TRMNL that gets hashed - it gets binded to a UUID
  const tokenHash = (req as any).trmnl?.tokenHash as string | undefined
  if (!tokenHash) {
    logger.warn('[AUTH] No token provided')
    res.status(401).json({ error: 'Unauthorized', message: 'missing trmnl auth context' })
    return
  }

  const uuid = readUuid(req)
  if (!uuid) {
    logger.warn('[AUTH] Missing UUID')
    res.status(400).json({ error: 'Bad Request', message: 'missing uuid' })
    return
  }

  const bound = await getUserUuidByTokenHash(tokenHash)
  if (!bound) {
    // IMPORTANT: do not bind here; install_success is the place to bind.
    logger.warn('[AUTH] UUID not bound')
    res.status(401).json({ error: 'Unauthorized', message: 'uuid_not_bound' })
    return
  }

  if (bound !== uuid) {
    logger.warn('[AUTH] token/uuid mismatch for ', tokenHash)
    res.status(401).json({ error: 'Unauthorized', message: 'Unauthorized access' })
    return
  }

  logger.debug('[AUTH] Successfully found binding for ', { tokenHash, bound })

  ;(req as any).trmnl = { ...(req as any).trmnl, userUuid: bound }
  next()
}

export const trmnlAuthByIP: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  logger.info('[AUTH] Check TRMNL authentication')

  try {
    if (TRMNL_IP_ALLOW_BYPASS) {
      logger.warn('[AUTH] Bypassing TRMNL worker IP check')
      next()
      return
    }

    // NOTE: Some worker IPs can be ipv6 based. No normalization is done here.
    // that's a risk I'm willing (and hoping) doesn't break anything major.
    const ips = await getTRMNLIPs()
    const ip = (req.headers["cf-connecting-ip"] as string) ?? req.ip

   if (!ips.has(ip)) {
      logger.warn(`[AUTH] Connection from ${ip} not permitted. Non-TRMNL worker IP address.`)
      res.status(403).json({ error: 'Forbidden', message: 'Non-TRMNL worker IP address'})
      return
    }
    next()
  } catch (e) {
    logger.warn(e)
    res.status(503).json({ error: 'Server Error', message: 'Authentication temporarily unavailable'})
    return
  }
}

// ============================================================================
// TRMNL JWT Verification (for plugin management pages)
// ============================================================================

const TRMNL_JWKS_URL = 'https://trmnl.com/.well-known/jwks.json'
let trmnlJwks: jose.JWTVerifyGetKey | null = null

async function getTrmnlJWKS(): Promise<jose.JWTVerifyGetKey> {
  if (!trmnlJwks) {
    logger.info(`[AUTH] Fetching TRMNL JWKS from ${TRMNL_JWKS_URL}`)
    trmnlJwks = jose.createRemoteJWKSet(new URL(TRMNL_JWKS_URL))
  }
  return trmnlJwks
}

/**
 * Middleware that validates the TRMNL-signed JWT on the manage endpoint.
 * Ensures the JWT signature is valid, not expired, and that `sub` matches the UUID.
 * Uses a 15-minute clock tolerance since the JWT has a short (~2 min) expiry
 * but users may take longer to fill out the settings form.
 */
export const requireTrmnlJwt: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const jwt = (req.query.jwt as string) || req.body?.jwt
  const uuid = (req.query.uuid as string) || req.body?.uuid

  if (!jwt || typeof jwt !== 'string') {
    logger.warn('[AUTH] Missing JWT in TRMNL manage request')
    res.status(401).send('Unauthorized')
    return
  }

  if (!uuid || typeof uuid !== 'string') {
    logger.warn('[AUTH] Missing UUID in TRMNL manage request')
    res.status(400).send('Bad Request - missing UUID')
    return
  }

  try {
    const keySet = await getTrmnlJWKS()
    const { payload } = await jose.jwtVerify(jwt, keySet, {
      clockTolerance: 900,
    })

    if (payload.sub !== uuid) {
      logger.warn('[AUTH] TRMNL JWT sub does not match UUID')
      res.status(403).send('Forbidden')
      return
    }

    next()
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      logger.warn('[AUTH] TRMNL JWT expired')
      res.status(401).send('Session expired — please reopen settings from TRMNL')
    } else if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
      logger.warn('[AUTH] TRMNL JWT signature invalid')
      res.status(401).send('Unauthorized')
    } else {
      logger.error('[AUTH] TRMNL JWT verification error:', error)
      res.status(401).send('Unauthorized')
    }
  }
}

export async function getTRMNLIPs(): Promise<Set<string>> {
  const now = Date.now()

  if (cachedIPs && now - cachedAtMs < TRMNL_TTL_IPS_MS) {
    return cachedIPs
  }

  if (inFlight) return inFlight

  inFlight = (async () => {
    logger.info('[AUTH] Refreshing list of TRMNL worker IPs')

    const res = await fetch('https://trmnl.com/api/ips')
    if (!res.ok) {
      inFlight = null
      throw new Error('Failed to fetch TRMNL IP list')
    }

    const json = await res.json()

    const ips = new Set<string>([
      ...(json.data?.ipv4 ?? []),
      ...(json.data?.ipv6 ?? []),
    ])

    cachedIPs = ips
    cachedAtMs = Date.now()
    inFlight = null

    return ips
  })()

  return inFlight
}
