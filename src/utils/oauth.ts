import { createOAuthURLs } from './generateOAuthURL.js'
import { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { logger } from './logger.js'
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { InsufficientScopeError, InvalidTokenError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js'

// Built with reference from MCP documentation:
// https://modelcontextprotocol.io/docs/tutorials/security/authorization
// You will need to generate an OAuth client for this API (if subtype isn't hosting) so it can pull credentials on its behalf
// In a way, this is 'sorta' replacing the keycloak middleware.

const oauthURLs = createOAuthURLs()
const oauthMetadata: OAuthMetadata = {
  ...oauthURLs!,
  response_types_supported: ['code'],
}

const mcpServerUrl = process.env.MCP_SERVER_URL
const authServerUrl = process.env.AUTH_SERVER_URL // e.g. https://auth.subtype.space
const realm = process.env.AUTH_REALM // e.g. subspace
const clientId = process.env.API_CLIENT_ID
const clientSecret = process.env.API_CLIENT_SECRET

export const oauthMetadataRouter = mcpAuthMetadataRouter({
  oauthMetadata,
  resourceServerUrl: new URL(mcpServerUrl!),
  scopesSupported: ['mcp:tools'],
  resourceName: 'subspace-api',
})

export const authMiddleware = requireBearerAuth({
  verifier: {
    verifyAccessToken: async (token: string) => {
      logger.info('[AUTH] running token validation')
      const authInfo = await verifyToken(token)

      logger.debug('[AUTH] pre-sdk-check authInfo', {
        hasScopes: Array.isArray((authInfo as any).scopes),
        scopesType: typeof (authInfo as any).scopes,
        expiresAt: (authInfo as any).expiresAt,
        expiresAtType: typeof (authInfo as any).expiresAt,
        keys: Object.keys(authInfo as any),
      })

      return authInfo
    },
  },
  requiredScopes: [],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(mcpServerUrl!)),
})

// export const authMiddleware = requireBearerAuth({
//   verifier: {
//     verifyAccessToken: verifyToken,
//   },
//   requiredScopes: [],
//   resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(mcpServerUrl!)),
// })

async function verifyToken(token: string) {
  if (!mcpServerUrl || !authServerUrl || !realm || !clientId) {
    logger.error('[AUTH] missing env', {
      mcpServerUrl: !!mcpServerUrl,
      authServerUrl: !!authServerUrl,
      realm: !!realm,
      clientId: !!clientId,
    })
    throw new ServerError('Auth not configured')
  }

  const endpoint = oauthMetadata.introspection_endpoint
  logger.info(`[AUTH] introspection endpoint: ${endpoint}`)

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

  let response: Response
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
    logger.debug(`[AUTH] Introspection response: ${raw}`)
  } catch (e) {
    logger.error('[AUTH] failed to parse introspection JSON', { error: String(e), body: raw })
    throw new ServerError('Failed to parse introspection JSON')
  }

  if (!data.active) {
    logger.error('[AUTH] inactive token')
    throw new InvalidTokenError('Token is inactive')
  }

  try {
    const audRaw = data.aud
    const audiences = Array.isArray(audRaw) ? audRaw : typeof audRaw === 'string' ? [audRaw] : []

    const configured = mcpServerUrl!

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
  } catch (e) {
    logger.error(`[AUTH] Error checking audiences ${e}`)
  }

  const exp = data.exp
  if (typeof exp !== 'number' || Number.isNaN(exp)) {
    logger.error('[AUTH] Invalid token - token has no expiration time')
    throw new InvalidTokenError('Token has no expiration time')
  }

  const scopes = typeof data.scope === 'string' ? data.scope.split(' ') : []
  logger.debug(`[AUTH] Detected scopes: ${scopes}`)
  logger.info('[AUTH] mapped authInfo', {
    clientId: data.client_id,
    expiresAt: exp,
    expiresAtType: typeof exp,
    scopesType: typeof scopes,
    scopesIsArray: Array.isArray(scopes),
    scopesLen: scopes.length,
  })

  logger.info('[AUTH] verifyToken returning; will pass to requireBearerAuth checks')

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
