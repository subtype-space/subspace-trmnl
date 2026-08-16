/**
 * Built with reference from MCP documentation and AI assisted debugging.
 * https://modelcontextprotocol.io/docs/tutorials/security/authorization
 *
 * Documentation on implementing the OAuth spec into MCP is lacking, so please take this class with a grain of salt.
 * This was also created to replace the now deprecated keycloak-connect node package.
 *
 * Also, this effectively switches the MCP server from a bearer only mode to a resource server (or protected resource)
 * Basically this just loops in the resource server communicating with the authentication server to validate credentials after
 *   an access token and all that.
 *
 * OAuth hard.
 */
import { AsyncLocalStorage } from 'async_hooks'
import * as jose from 'jose'
import { RequestHandler, Request, Response, NextFunction } from 'express'
import { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
// requireBearerAuth is looking for instanceof error types, so we try to match and throw specific errors
import { InsufficientScopeError, InvalidTokenError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { config } from '../src/config.js'
import { UserInfo, AuthInfo } from './types-oauth/types.js'
import { logger } from '../src/utils/logger.js'
import { createOAuthURLs } from './generateOAuthURL.js'

// JWKS cache for user token verification (X-User-Authorization)
let jwks: jose.JWTVerifyGetKey | null = null

const { authServerUrl, realm, mcpServerUrl, clientId, clientSecret } = config.auth
const oauthURLs = createOAuthURLs({ authServerUrl, realm })
const oauthMetadata: OAuthMetadata = {
  ...oauthURLs,
  response_types_supported: ['code'],
}

// Use the SDK to generate the OAuth routes...handy!
export const oauthMetadataRouter = mcpAuthMetadataRouter({
  oauthMetadata,
  resourceServerUrl: new URL(mcpServerUrl),
  scopesSupported: ['mcp:tools'],
  resourceName: 'subspace-api',
})

// ============================================================================
// User Token Verification (X-User-Authorization header, BFF pattern)
// ============================================================================

/**
 * Get or create JWKS key set for user token verification
 */
async function getJWKS(): Promise<jose.JWTVerifyGetKey> {
  if (!jwks) {
    // Derive JWKS URL from the OAuth issuer
    // Ensure issuer ends with / for proper URL concatenation
    const issuer = oauthURLs.issuer.endsWith('/') ? oauthURLs.issuer : `${oauthURLs.issuer}/`
    const jwksUrl = new URL('protocol/openid-connect/certs', issuer)
    logger.info(`[AUTH] Fetching JWKS from ${jwksUrl}`)
    jwks = jose.createRemoteJWKSet(jwksUrl)
  }
  return jwks
}

/**
 * Extract roles from Keycloak token
 * Keycloak puts roles in:
 * - realm_access.roles (realm roles)
 * - resource_access.{client_id}.roles (client roles)
 */
function extractRoles(payload: jose.JWTPayload): string[] {
  const roles: string[] = []

  // Realm roles
  const realmAccess = payload.realm_access as { roles?: string[] } | undefined
  if (realmAccess?.roles) {
    roles.push(...realmAccess.roles)
  }

  // Client roles (from all clients)
  const resourceAccess = payload.resource_access as Record<string, { roles?: string[] }> | undefined
  if (resourceAccess) {
    for (const [clientId, access] of Object.entries(resourceAccess)) {
      if (access.roles) {
        for (const role of access.roles) {
          // Add both raw role and prefixed version for flexible matching
          roles.push(role)
          roles.push(`${clientId}:${role}`)
        }
      }
    }
  }

  return roles
}

/**
 * Verify a user access token (from X-User-Authorization header) using JWKS
 * Returns user info with roles, or null if invalid
 */
async function verifyUserToken(token: string): Promise<UserInfo | null> {
  try {
    const keySet = await getJWKS()

    const { payload } = await jose.jwtVerify(token, keySet, {
      issuer: oauthURLs.issuer,
      // User tokens from Keycloak typically have 'account' as audience
      // but we don't strictly require a specific audience for user tokens
      // since they're issued by our trusted Keycloak realm (verified by issuer + signature)
    })

    // Validate token has required claims
    if (!payload.sub) {
      logger.warn('[AUTH] User token missing sub claim')
      return null
    }

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      logger.warn('[AUTH] User token expired or missing exp claim')
      return null
    }

    const roles = extractRoles(payload)

    const user: UserInfo = {
      sub: payload.sub || '',
      name: payload.name as string | undefined,
      email: payload.email as string | undefined,
      preferredUsername: payload.preferred_username as string | undefined,
      roles,
      token,
    }

    logger.info(`[AUTH] Verified user token: ${user.preferredUsername || user.sub} with roles: [${roles.join(', ') || 'none'}]`)
    return user
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      logger.warn('[AUTH] User token expired')
    } else if (error instanceof jose.errors.JWTClaimValidationFailed) {
      logger.warn('[AUTH] User token validation failed:', (error as Error).message)
    } else if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
      logger.warn('[AUTH] User token signature invalid')
    } else {
      logger.error('[AUTH] User token verification error:', error)
    }
    return null
  }
}

/**
 * Middleware to handle X-User-Authorization header for BFF pattern (defense-in-depth)
 *
 * This runs AFTER authMiddleware and adds user info to the existing authInfo.
 * The BFF sends the user's access token in this header so we can verify
 * the user's identity and roles server-side, even though BFF also filters tools.
 */
export const userAuthMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const authInfo = (req as any).authInfo as AuthInfo | undefined
  if (!authInfo) {
    // No service auth - skip user auth
    return next()
  }

  const userAuthHeader = req.headers['x-user-authorization']
  if (!userAuthHeader || typeof userAuthHeader !== 'string') {
    // No user token provided - continue without user context
    // This is fine for service-to-service calls that don't have a user context
    logger.debug('[AUTH] No X-User-Authorization header present')
    return next()
  }

  // Extract token from "Bearer <token>" format
  if (!userAuthHeader.toLowerCase().startsWith('bearer ')) {
    logger.warn('[AUTH] Invalid X-User-Authorization format (expected "Bearer <token>")')
    return next()
  }

  const userToken = userAuthHeader.slice(7).trim()
  const user = await verifyUserToken(userToken)

  if (user) {
    authInfo.user = user
    logger.info(`[AUTH] BFF user context attached: ${user.preferredUsername || user.sub}`)
  } else {
    logger.warn('[AUTH] X-User-Authorization token invalid, continuing without user context')
  }

  next()
}

// ============================================================================
// Service Token Middleware (Authorization header)
// ============================================================================

// This Middleware is still technically MCP SDK based, but could be extensible
// If wanting to protect non-mcp endpoints, gotta fix the requiredScopes stuff
export const authMiddleware: RequestHandler = (req, res, next) => {
  const bearer = requireBearerAuth({
    verifier: {
      verifyAccessToken: async (token: string) => {
        const authInfo = await verifyToken(token)
        ;(req as any).authInfo = authInfo //attach?
        return authInfo
      },
    },
    requiredScopes: ['mcp:tools'],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(mcpServerUrl)),
  })

  return bearer(req, res, next)
}

async function verifyToken(token: string) {
  const endpoint = oauthMetadata.introspection_endpoint
  logger.debug(`[AUTH] introspection endpoint: ${endpoint}`)

  if (!endpoint) {
    logger.error('[AUTH] no introspection endpoint in metadata')
    throw new ServerError('Introspection not possible at this time.')
  }

  const params = new URLSearchParams({
    token: token,
    client_id: clientId,
  })

  if (clientSecret) {
    params.set('client_secret', clientSecret)
  }

  // This performs a POST to the auth server endpoint with the OIDC/OAuth client credentials that "belong" to the API server
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
  } catch (e) {
    logger.error('[AUTH] introspection fetch threw', e)
    throw new ServerError('Introspection failed')
  }

  if (!response.ok) {
    const txt = await response.text()
    logger.error('[AUTH] introspection not OK', { status: response.status })

    // Format the error
    try {
      const obj = JSON.parse(txt)
      logger.error(JSON.stringify(obj, null, 2))
    } catch {
      logger.error(txt)
    }

    logger.error(`Invalid or expired token: ${txt}`)
    throw new InvalidTokenError('Invalid or expired token')
  }

  const raw = await response.text()
  let data: any
  try {
    data = JSON.parse(raw)
  } catch (e) {
    logger.error('[AUTH] failed to parse introspection JSON', { error: String(e), body: raw })
    throw new ServerError('Failed to parse introspection JSON')
  }

  if (!data.active) {
    logger.error('[AUTH] inactive token')
    throw new InvalidTokenError('Token is inactive')
  }

  const audRaw = data.aud
  const audiences = Array.isArray(audRaw) ? audRaw : typeof audRaw === 'string' ? [audRaw] : []

  const configured = mcpServerUrl
  // After looking at the SDK code, checkResourceAllowed may freak out if you pass in non-URL audiences
  // To be honest, I'm not sure what the 'correct' method is, but my gut feeling is telling me that the
  // MCP sdk only supports URLs returned in the claim
  const allowed = audiences.some((a) => {
    // Only run URL-based matching if `a` is a URL
    try {
      new URL(a)
    } catch {
      return false // ignore non-URL audiences
    }

    return checkResourceAllowed({
      requestedResource: a,
      configuredResource: configured,
    })
  })

  if (!allowed) {
    logger.warn(`[AUTH] Audience not allowed. Expected ${configured} but got ${audiences.join(',')}`)
    throw new InsufficientScopeError('Audience not allowed')
  }

  const exp = data.exp
  if (typeof exp !== 'number' || Number.isNaN(exp)) {
    logger.error('[AUTH] Invalid token - token has no expiration time')
    throw new InvalidTokenError('Token has no expiration time')
  }

  const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : []

  logger.debug('[AUTH] Authenticating user with following info:', {
    clientId: data.client_id,
    scopes: scopes,
    expiresAt: exp,
    extra: {
      sub: data.sub,
      azp: data.azp,
      preferred_username: data.preferred_username,
    },
  })

  return {
    token,
    clientId: data.client_id,
    scopes: scopes,
    expiresAt: exp,
    extra: {
      sub: data.sub,
      azp: data.azp,
      preferred_username: data.preferred_username,
    },
  }
}

/**
 * AsyncLocalStorage-based auth context for MCP tool handlers
 *
 * Problem: MCP tool handlers don't have access to the Express request object,
 * so we can't directly access req.authInfo from inside a tool handler.
 *
 * The call chain looks like:
 *   Express Request (has authInfo after middleware)
 *     → MCP Transport (handleRequest)
 *       → MCP Server (internal routing)
 *         → Tool Handler (needs authInfo but can't access Express req!)
 *
 * Solution: AsyncLocalStorage provides "context" that flows through async calls
 * without explicitly passing it as a parameter. It's like thread-local storage
 * in other languages - each concurrent request gets its own isolated context.
 *
 * Usage:
 *   1. In server.ts, wrap MCP handler: runWithAuth(authInfo, async () => { ... })
 *   2. In tool handlers, call: requireScope('proxmox:read') or getAuthInfo()
 *
 * Without this, we'd have to either:
 *   - Pass authInfo through every function (invasive, ugly)
 *   - Use a global variable (breaks with concurrent requests)
 *   - Monkey-patch the MCP SDK (fragile)
 */

const authStorage = new AsyncLocalStorage<AuthInfo>()

/**
 * Wraps a function with auth context. Any code inside fn() can call
 * getAuthInfo() or requireScope() to access the auth info.
 */
export function runWithAuth<T>(authInfo: AuthInfo, fn: () => T): T {
  return authStorage.run(authInfo, fn)
}

/**
 * Retrieves the current auth context. Returns undefined if called
 * outside of a runWithAuth() wrapper.
 */
export function getAuthInfo(): AuthInfo | undefined {
  return authStorage.getStore()
}

/**
 * Throws an error if the current user doesn't have the required scope.
 * Call this at the start of any tool handler that needs authorization.
 */
export function requireScope(scope: string): void {
  const auth = getAuthInfo()
  if (!auth) {
    logger.warn(`[AUTH] No auth context available, denying access for scope: ${scope}`)
    throw new Error('Unauthorized: No auth context')
  }
  if (!auth.scopes.includes(scope)) {
    logger.warn(`[AUTH] User ${auth.extra?.preferred_username ?? auth.clientId} missing scope: ${scope}`)
    throw new Error(`Forbidden: Missing required scope '${scope}'`)
  }
  logger.debug(`[AUTH] Scope '${scope}' verified for ${auth.extra?.preferred_username ?? auth.clientId}`)
}

/**
 * Returns true if the current user has the specified scope.
 * Useful for conditional logic rather than hard failures.
 */
export function hasScope(scope: string): boolean {
  const auth = getAuthInfo()
  return auth?.scopes.includes(scope) ?? false
}

// ============================================================================
// Role-based Authorization (for BFF pattern, defense-in-depth)
// ============================================================================

/**
 * Throws an error if the current user doesn't have the required role.
 * Call this at the start of any tool handler that needs role-based authorization.
 *
 * In BFF pattern, roles come from the user token (X-User-Authorization),
 * not from the service token (Authorization). Calls without a user token
 * are denied - this enforces that protected tools can only be called via BFF.
 */
export function requireRole(role: string): void {
  const auth = getAuthInfo()
  if (!auth) {
    logger.warn(`[AUTH] No auth context available, denying access for role: ${role}`)
    throw new Error('Unauthorized: No auth context')
  }

  if (!auth.user) {
    logger.warn(`[AUTH] No user context (missing X-User-Authorization), denying access for role: ${role}`)
    throw new Error('Forbidden: User authentication required for this operation')
  }

  if (!auth.user.roles.includes(role)) {
    logger.warn(`[AUTH] User ${auth.user.preferredUsername ?? auth.user.sub} missing role: ${role}`)
    throw new Error(`Forbidden: Missing required role '${role}'`)
  }

  logger.debug(`[AUTH] Role '${role}' verified for ${auth.user.preferredUsername ?? auth.user.sub}`)
}

/**
 * Returns true if the current user has the specified role.
 * Useful for conditional logic rather than hard failures.
 */
export function hasRole(role: string): boolean {
  const auth = getAuthInfo()
  return auth?.user?.roles.includes(role) ?? false
}

/**
 * Returns true if the current user has any of the specified roles.
 */
export function hasAnyRole(roles: string[]): boolean {
  const auth = getAuthInfo()
  if (!auth?.user) return false
  return roles.some((role) => auth.user!.roles.includes(role))
}

/**
 * Get the current user info (from BFF token), if available.
 */
export function getUserInfo(): UserInfo | undefined {
  return getAuthInfo()?.user
}
