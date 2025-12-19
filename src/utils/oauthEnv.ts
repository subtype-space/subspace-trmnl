// oauthEnv.ts does the configuration and validation

import { logger } from "./logger.js"

// Generate custom env type that we can shuttle around
export type OAuthEnv = {
  mcpServerUrl: string
  authServerUrl: string
  realm: string
  clientId: string
  clientSecret?: string
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    logger.error(`[ENV ] Missing required env var: ${name}`)
    throw new Error(`[ENV ] Missing required env var: ${name}`)
  }
  return v
}

let cached: OAuthEnv | null = null

export function getOAuthEnv(): OAuthEnv {
  if (cached) return cached
  cached = Object.freeze({
    mcpServerUrl: required("MCP_SERVER_URL"),
    authServerUrl: required("AUTH_SERVER_URL"),
    realm: required("AUTH_REALM"),
    clientId: required("API_CLIENT_ID"),
    clientSecret: process.env.API_CLIENT_SECRET,
  })

  logger.info('[ENV ] OAuth configuration successfully loaded!', {
    authServerUrl: cached.authServerUrl,
    realm: cached.realm,
    resource: cached.mcpServerUrl
  })

  return cached
}