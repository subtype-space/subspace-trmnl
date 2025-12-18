import { createOAuthURLs } from './generateOAuthURL.js'
import { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { logger } from './logger.js'
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'

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
    verifyAccessToken: verifyToken,
  },
  requiredScopes: [],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(mcpServerUrl!)),
})

async function verifyToken(token: string) {
  logger.debug(`Attempting to verify token: ${token}`)
  if (!mcpServerUrl || !authServerUrl || !realm || !clientId) {
    logger.error('[AUTH] missing env', {
      mcpServerUrl: !!mcpServerUrl,
      authServerUrl: !!authServerUrl,
      realm: !!realm,
      clientId: !!clientId,
    })
    throw new Error('Auth not configured')
  }

  const endpoint = oauthMetadata.introspection_endpoint
  logger.info(`[AUTH] introspection endpoint=${endpoint}`)

  if (!endpoint) {
    logger.error('[AUTH] no introspection endpoint in metadata')
    throw new Error('No introspection endpoint')
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
    throw new Error('Introspection failed')
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
    throw new Error('Invalid or expired token')
  }

  const raw = await response.text()
  let data: any
  try {
    data = JSON.parse(raw)
  } catch (e) {
    logger.error('[AUTH] failed to parse introspection JSON', { error: String(e), body: raw })
    throw new Error('Failed to parse introspection JSON')
  }

  if (!data.active) {
    logger.error('[AUTH] inactive token')
    throw new Error('Invalid or inactive token')
  }

  const audRaw = data.aud
  const audiences = Array.isArray(audRaw) ? audRaw : typeof audRaw === 'string' ? [audRaw] : []
  const allowed = audiences.some((a) =>
    checkResourceAllowed({
      requestedResource: a,
      configuredResource: mcpServerUrl!,
    })
  )

  if (!allowed) {
    logger.warn(`[AUTH] Retrieved audiences not allowed. Expected ${mcpServerUrl} but got ${audiences.join(',')}`)
    throw new Error('Audience not allowed')
  }

  return {
    token,
    clientId: data.client_id,
    scopes: data.scope ? data.scope.split(' ') : [],
    expiresAt: data.exp,
  }
}
