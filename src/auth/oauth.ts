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
import { RequestHandler, Request, Response, NextFunction } from 'express'
import { getOAuthEnv } from '../utils/oauthEnv.js'
import { createOAuthURLs } from '../utils/generateOAuthURL.js'
import { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { logger } from '../utils/logger.js'
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'

// requireBearerAuth is looking for instanceof error types, so we try to match and throw specific errors
import { InsufficientScopeError, InvalidTokenError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js'

const { authServerUrl, realm, mcpServerUrl, clientId, clientSecret } = getOAuthEnv()
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

  logger.debug('[AUTH] Checking introspection raw data')

  const raw = await response.text()
  let data: any
  try {
    data = JSON.parse(raw)
    logger.debug(`[AUTH] Auth server introspection response: ${raw}`)
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

  logger.info('[AUTH] Authenticating user with following info:', {
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

// Auth context for passing auth info to MCP tool handlers via AsyncLocalStorage
export type AuthInfo = {
  token: string
  clientId: string
  scopes: string[]
  expiresAt: number
  extra?: {
    sub?: string
    azp?: string
    preferred_username?: string
  }
}

const authStorage = new AsyncLocalStorage<AuthInfo>()

export function runWithAuth<T>(authInfo: AuthInfo, fn: () => T): T {
  return authStorage.run(authInfo, fn)
}

export function getAuthInfo(): AuthInfo | undefined {
  return authStorage.getStore()
}

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

export function hasScope(scope: string): boolean {
  const auth = getAuthInfo()
  return auth?.scopes.includes(scope) ?? false
}
