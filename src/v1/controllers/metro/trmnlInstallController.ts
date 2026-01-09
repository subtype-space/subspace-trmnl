import crypto from 'crypto'
import { RequestHandler } from 'express'
import { logger } from '../../../utils/logger.js'
import { storeTrmnlToken } from '../../../utils/dbConnector.js'

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')

// oWo
// retrieve the access token from TRMNL (step 1ish and 2ish in auth flow)
const trmnlInstallController: RequestHandler = async (req, res): Promise<void> => {
  const token = req.query.code as string | undefined
  const callback = req.query.installation_callback_url as string

  if (!token || !callback) {
    res.status(400).json({ error: 'Bad Request', message: 'missing token or callback' })
    return
  }

  let url: URL
  try {
    url = new URL(callback)
  } catch {
    res.status(400).json({ error: 'Bad Request', message: 'Invalid callback URL' })
    return
  }

  // Just in case, make sure we only permit callback urls set to usetrmnl.com domain
  const allowedHosts = new Set(['usetrmnl.com', 'www.usetrmnl.com'])

  if (!allowedHosts.has(url.hostname)) {
    res.status(400).json({ error: 'Bad Request', message: 'Invalid callback URL' })
    return
  }

  const trmnlResp = await fetch('https://usetrmnl.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code: token,
      client_id: process.env.TRMNL_CLIENT_ID!,
      client_secret: process.env.TRMNL_CLIENT_SECRET!,
      grant_type: 'authorization_code',
    }).toString(),
  })

  const raw = await trmnlResp.text()

  if (!trmnlResp.ok) {
    logger.warn('[TRMNL] token exchange failed', raw)
    res.status(502).json({ error: 'Bad Gateway', message: 'trmnl_exchange_failed' })
    return
  }
  // dont log raw access tokens, even in debug
  // dont do it andrew
  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    res.status(502).json({ error: 'Bad Gateway', message: 'trmnl_invalid_response' })
    return
  }

  const access_token = data?.access_token
  if (typeof access_token !== 'string') {
    res.status(502).json({ error: 'Bad Gateway', message: 'missing_access_token' })
    return
  }

  const hash = sha256(access_token)
  logger.info('[TRMNL] Storing hashed access token...')
  logger.debug(hash)
  await storeTrmnlToken(hash)

  logger.debug('[TRMNL] Redirecting user back to', callback)
  res.redirect(callback)
  return
}

export default trmnlInstallController
