import crypto from 'crypto'
import { RequestHandler } from 'express'
import { logger } from '../../../utils/logger.js'
import { storeTrmnlToken } from '../../../utils/dbConnector.js'

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')

const ALLOWED_CALLBACK_HOSTS = new Set(['usetrmnl.com', 'www.usetrmnl.com', 'trmnl.com', 'www.trmnl.com'])

/**
 * Builds the install controller shared by the metro and flights plugins: exchange the
 * TRMNL-issued code for an access token, hash it, and redirect back to the callback URL.
 * @param clientId TRMNL client_id for this plugin
 * @param clientSecret TRMNL client_secret for this plugin
 * @param logTag log prefix, e.g. '[TRML]' or '[AERO]'
 */
export function createTrmnlInstallController(clientId: string, clientSecret: string, logTag: string): RequestHandler {
  return async (req, res): Promise<void> => {
    logger.debug(`${logTag} Incoming install request`, { query: req.query })
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

    // Just in case, make sure we only permit callback urls set to trmnl.com domain
    if (!ALLOWED_CALLBACK_HOSTS.has(url.hostname) || url.protocol !== 'https:') {
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
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
      }).toString(),
    })

    const raw = await trmnlResp.text()

    if (!trmnlResp.ok) {
      logger.warn(`${logTag} token exchange failed`, raw)
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
    logger.info(`${logTag} Storing hashed access token...`)
    logger.debug(hash)
    await storeTrmnlToken(hash)

    logger.debug(`${logTag} Redirecting user back to`, url.toString())
    res.redirect(url.toString())
  }
}
