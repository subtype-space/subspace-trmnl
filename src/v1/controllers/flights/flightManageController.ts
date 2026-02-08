import { RequestHandler } from 'express'
import { getFlightSettingsByUuid, upsertFlightSettings } from '../../../utils/dbConnector.js'
import { logger } from '../../../utils/logger.js'
import escapeHtml from 'escape-html'

const FLIGHT_PATTERN = /^[A-Z0-9]{2}\d{1,4}$/

export const flightManageGetController: RequestHandler = async (req, res) => {
  const uuid = req.query.uuid as string | undefined
  const jwt = req.query.jwt as string | undefined
  if (!uuid) {
    logger.warn('[FLGHT] Missing UUID in request for settings page')
    res.status(400).send('Bad Request - missing UUID')
    return
  }

  const safeUuid = escapeHtml(uuid)
  const safeJwt = jwt ? escapeHtml(jwt) : ''

  logger.info('[FLGHT] Displaying plugin settings page')
  const settings = await getFlightSettingsByUuid(uuid)
  const flightNumbers = settings?.flight_numbers ?? ''

  res.type('text/html').send(`
    <html><body style="font-family: system-ui; max-width: 520px; margin: 24px auto;">
      <h2>Flight Tracker Settings</h2>

      <form method="POST" action="/v1/trmnl/flights/manage">
        <input type="hidden" name="uuid" value="${safeUuid}"/>
        <input type="hidden" name="jwt" value="${safeJwt}"/>

        <div style="margin: 12px 0;">
          <strong>Flight numbers</strong><br/>
          <input
            type="text"
            name="flightNumbers"
            value="${escapeHtml(flightNumbers)}"
            placeholder="UA804, DL123"
            style="width: 100%; padding: 8px; font-size: 16px; margin-top: 6px;"
          />
          <p style="color: #666; font-size: 14px; margin-top: 4px;">
            Enter IATA flight numbers separated by commas (e.g. UA804, DL123). Max 4 flights.
          </p>
        </div>

        <button type="submit" style="padding: 8px 16px; font-size: 16px;">Save</button>
      </form>

      ${
        settings?.plugin_setting_id
          ? `<p style="margin-top:16px;">
                <a href="https://trmnl.com/plugin_settings/${settings.plugin_setting_id}/edit?force_refresh=true">
                Back to TRMNL
                </a>
             </p>`
          : ''
      }
    </body></html>
  `)
}

export const flightManagePostController: RequestHandler = async (req, res) => {
  const uuid = req.body?.uuid
  if (typeof uuid !== 'string' || !uuid) {
    res.status(400).json({ error: 'Bad Request', message: 'missing uuid' })
    return
  }

  logger.info('[FLGHT] Saving user flight settings')
  const raw = req.body?.flightNumbers
  const rawStr = typeof raw === 'string' ? raw : ''

  const flights = rawStr
    .split(',')
    .map((s: string) => s.trim().toUpperCase())
    .filter(Boolean)

  // Validate each flight number
  const invalid = flights.filter((f: string) => !FLIGHT_PATTERN.test(f))
  if (invalid.length > 0) {
    res.status(400).json({ error: 'Bad Request', message: `Invalid flight number(s): ${invalid.join(', ')}` })
    return
  }

  if (flights.length > 4) {
    res.status(400).json({ error: 'Bad Request', message: 'Maximum 4 flights allowed' })
    return
  }

  const flightNumbers = flights.join(',')
  logger.debug(`[FLGHT] ${uuid} updated flights to ${flightNumbers}`)

  await upsertFlightSettings({ user_uuid: uuid, flight_numbers: flightNumbers })

  const settings = await getFlightSettingsByUuid(uuid)
  const pluginSettingId = settings?.plugin_setting_id

  if (pluginSettingId) {
    res.redirect(`https://trmnl.com/plugin_settings/${pluginSettingId}/edit?force_refresh=true`)
    return
  }

  const jwt = req.body?.jwt
  const jwtParam = typeof jwt === 'string' && jwt ? `&jwt=${encodeURIComponent(jwt)}` : ''
  res.redirect(`/v1/trmnl/flights/manage?uuid=${encodeURIComponent(uuid)}${jwtParam}`)
}
