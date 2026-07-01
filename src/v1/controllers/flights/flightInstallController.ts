import crypto from 'crypto'
import { RequestHandler } from 'express'
import { config } from '../../../config.js'
import { logger } from '../../../utils/logger.js'
import { storeTrmnlToken } from '../../../utils/dbConnector.js'

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')

const flightInstallController: RequestHandler = async (req, res): Promise<void> => {
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

  const allowedHosts = new Set(['usetrmnl.com', 'www.usetrmnl.com', 'trmnl.com', 'www.trmnl.com'])

  if (!allowedHosts.has(url.hostname) || url.protocol !== 'https:') {
    res.status(400).json({ error: 'Bad Request', message: 'Invalid callback URL' })
    return
  }

  const trmnlResp = await fetch('https://trmnl.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code: token,
      client_id: config.trmnl.flightsClientId,
      client_secret: config.trmnl.flightsClientSecret,
      grant_type: 'authorization_code',
    }).toString(),
  })

  const raw = await trmnlResp.text()

  if (!trmnlResp.ok) {
    logger.warn('[TRMNL] token exchange failed', raw)
    res.status(502).json({ error: 'Bad Gateway', message: 'trmnl_exchange_failed' })
    return
  }

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

  logger.debug('[TRMNL] Redirecting user back to', url.toString())
  res.redirect(url.toString())
  return
}

export default flightInstallController
