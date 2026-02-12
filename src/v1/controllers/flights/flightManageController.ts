import { RequestHandler } from 'express'
import { getFlightSettingsByUuid, upsertFlightSettings } from '../../../utils/dbConnector.js'
import { logger } from '../../../utils/logger.js'
import escapeHtml from 'escape-html'

const FLIGHT_PATTERN = /^[A-Z0-9]{2,3}\d{1,4}$/

function renderSettingsPage(opts: {
  uuid: string
  jwt: string
  flightNumbers: string
  pluginSettingId?: number | null
  error?: string
}): string {
  const safeUuid = escapeHtml(opts.uuid)
  const safeJwt = escapeHtml(opts.jwt)

  const errorHtml = opts.error
    ? `<p style="color: #c00; font-size: 14px; font-weight: 600; margin: 8px 0;">${escapeHtml(opts.error)}</p>`
    : ''

  const backLink = opts.pluginSettingId
    ? `<p style="margin-top:16px;">
        <a href="https://trmnl.com/plugin_settings/${opts.pluginSettingId}/edit?force_refresh=true">
        Back to TRMNL
        </a>
       </p>`
    : ''

  return `
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
            value="${escapeHtml(opts.flightNumbers)}"
            placeholder="UA804, DL123"
            style="width: 100%; padding: 8px; font-size: 16px; margin-top: 6px;"
          />
          ${errorHtml}
          <p style="color: #666; font-size: 14px; margin-top: 4px;">
            Enter flight numbers separated by commas (e.g. UA804, DL123). Max 4 flights.
            Both IATA (UA804) and ICAO (UAL804) formats are accepted. 
          </p>
          <p style="color: #666; font-size: 13px; margin-top: 6px;">
            If multiple flights are configured, they will rotate on each screen refresh throughout the day.
          </p>
          <p style="color: #666; font-size: 13px; margin-top: 4px;">
            For aircrafts in an area with no receivers in proximity (e.g. trans-atlantic travel), live telemetry for speed, altitude, and heading will be unavailable.
          </p>
        </div>

        <button type="submit" style="padding: 8px 16px; font-size: 16px;">Save</button>
      </form>

      ${backLink}

      <p style="color: #999; font-size: 13px; margin-top: 24px;">
        Source: <a href="https://aerodatabox.com" target="_blank">AeroDataBox</a>.
        Coverage is best for U.S., Canadian, and European flights.
        Data is sourced from receivers globally and can be inconsistent at times.
      </p>
      <p style="color: #999; font-size: 13px; margin-top: 8px;">
        Missing flight data? Email <a href="mailto:andrew@subtype.space">andrew@subtype.space</a>
      </p>
    </body></html>
  `
}

export const flightManageGetController: RequestHandler = async (req, res) => {
  const uuid = req.query.uuid as string | undefined
  const jwt = req.query.jwt as string | undefined
  if (!uuid) {
    logger.warn('[FLGHT] Missing UUID in request for settings page')
    res.status(400).send('Bad Request - missing UUID')
    return
  }

  logger.info('[FLGHT] Displaying plugin settings page')
  const settings = await getFlightSettingsByUuid(uuid)

  res.type('text/html').send(
    renderSettingsPage({
      uuid,
      jwt: jwt ?? '',
      flightNumbers: settings?.flight_numbers ?? '',
      pluginSettingId: settings?.plugin_setting_id,
    })
  )
}

export const flightManagePostController: RequestHandler = async (req, res) => {
  const uuid = req.body?.uuid
  if (typeof uuid !== 'string' || !uuid) {
    res.status(400).send('Bad Request - missing UUID')
    return
  }

  const jwt = req.body?.jwt ?? ''

  logger.info('[FLGHT] Saving user flight settings')
  const raw = req.body?.flightNumbers
  const rawStr = typeof raw === 'string' ? raw : ''

  const flights = rawStr
    .split(',')
    .map((s: string) => s.trim().toUpperCase())
    .filter(Boolean)

  const settings = await getFlightSettingsByUuid(uuid)

  // Validate each flight number
  const invalid = flights.filter((f: string) => !FLIGHT_PATTERN.test(f))
  if (invalid.length > 0) {
    res.status(400).type('text/html').send(
      renderSettingsPage({
        uuid,
        jwt,
        flightNumbers: rawStr,
        pluginSettingId: settings?.plugin_setting_id,
        error: `Invalid flight number(s): ${invalid.join(', ')}`,
      })
    )
    return
  }

  if (flights.length > 4) {
    res.status(400).type('text/html').send(
      renderSettingsPage({
        uuid,
        jwt,
        flightNumbers: rawStr,
        pluginSettingId: settings?.plugin_setting_id,
        error: 'Maximum 4 flights allowed',
      })
    )
    return
  }

  const flightNumbers = flights.join(',')
  logger.debug(`[FLGHT] ${uuid} updated flights to ${flightNumbers}`)

  await upsertFlightSettings({ user_uuid: uuid, flight_numbers: flightNumbers })

  const updatedSettings = await getFlightSettingsByUuid(uuid)
  const pluginSettingId = updatedSettings?.plugin_setting_id

  if (pluginSettingId) {
    res.redirect(`https://trmnl.com/plugin_settings/${pluginSettingId}/edit?force_refresh=true`)
    return
  }

  const jwtParam = typeof jwt === 'string' && jwt ? `&jwt=${encodeURIComponent(jwt)}` : ''
  res.redirect(`/v1/trmnl/flights/manage?uuid=${encodeURIComponent(uuid)}${jwtParam}`)
}
