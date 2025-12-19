import crypto from 'crypto'
import { RequestHandler } from 'express'
import { logger } from '../../utils/logger.js'
import { storeTrmnlToken } from '../../utils/dbConnector.js'

const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex')

// oWo
// retrieve the access token from TRMNL (step 1ish and 2ish in auth flow)
const trmnlInstallController: RequestHandler = async (req, res): Promise<void> => {
  const token = req.query.code as string | undefined
  const callback = req.query.installation_callback_url as string | undefined

  if (!token || !callback) {
    res.status(400).json({ error: 'missing token or callback' })
    return
  }

  const trmnlResp = await fetch('https://usetrmnl.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      client_id: process.env.TRMNL_CLIENT_ID!,
      client_secret: process.env.TRMNL_CLIENT_SECRET!,
      grant_type: 'authorization_code',
    }),
  })

  if (!trmnlResp.ok) {
    const text = await trmnlResp.text()
    logger.warn('[TRMNL] token exchange failed', text)
    res.status(502).json({ error: 'trmnl_exchange_failed' })
    return
  }

  logger.debug(`[TRMNL] TRMNL exchange response: ${trmnlResp}`)
  // dont log raw access tokens, even in debug
  // dont do it andrew
  const { access_token } = await trmnlResp.json()

  if (typeof access_token !== 'string') {
    logger.warn('[TRMNL] unable to parse access_token')
    res.status(502).json({ error: 'unable to parse trmnl access_token' })
    return
  }

  const hash = sha256(access_token)
  logger.info('[TRMNL] Storing hashed access token...')
  await storeTrmnlToken(hash)

  logger.info('[TRMNL] installation complete')
  res.redirect(callback)
  return
}

export default trmnlInstallController