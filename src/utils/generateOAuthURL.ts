import { logger } from './logger.js'
export function createOAuthURLs() {
  const authServer = process.env.AUTH_SERVER_URL
  const realm = process.env.AUTH_REALM

  if (!authServer || !realm) {
    logger.error('[AUTH] ENV VAR AUTH_SERVER_URL or AUTH_REALM not set. No auth possible.')
    return null
  }

  const realmBase = new URL(`/realms/${realm}/`, authServer)
  const issuer = realmBase.toString().replace(/\/$/, '')

  logger.debug(`[AUTH] Generated OAuthURLs: realmBase set to ${realmBase}\nissuer ${issuer}`)

  return {
    issuer: issuer,
    introspection_endpoint: new URL('protocol/openid-connect/token/introspect', realmBase).toString(),
    authorization_endpoint: new URL('protocol/openid-connect/auth', realmBase).toString(),
    token_endpoint: new URL('protocol/openid-connect/token', realmBase).toString(),
  }
}
