/**
 * User info extracted from X-User-Authorization header (BFF pattern)
 */
export type UserInfo = {
  sub: string
  name?: string
  email?: string
  preferredUsername?: string
  roles: string[]
  token: string
}

export type AuthInfo = {
  // Service token info (from Authorization header)
  token: string
  clientId: string
  scopes: string[]
  expiresAt: number
  extra?: {
    sub?: string
    azp?: string
    preferred_username?: string
  }
  // User info from X-User-Authorization header (BFF pattern, defense-in-depth)
  user?: UserInfo
}