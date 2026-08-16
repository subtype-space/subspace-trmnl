// By this point, all required env vars should be validated by oauthEnv.ts
import { logger } from '../src/utils/logger.js'

// Generate OAuth URLs for introspection, auth, and token endpoint given an auth and realm
export function createOAuthURLs(opts: { authServerUrl: string; realm: string }) {
  logger.debug('[AUTH] Generating OAuth URLs')
  const realmBase = new URL(`/realms/${opts.realm}/`, opts.authServerUrl)
  const issuer = realmBase.toString().replace(/\/$/, '')

  logger.debug(`[AUTH] Issuer URL set to ${issuer}`)

  return {
    issuer: issuer,
    introspection_endpoint: new URL('protocol/openid-connect/token/introspect', realmBase).toString(),
    authorization_endpoint: new URL('protocol/openid-connect/auth', realmBase).toString(),
    token_endpoint: new URL('protocol/openid-connect/token', realmBase).toString(),
  }
}
