import { RequestHandler } from 'express'
import escapeHtml from 'escape-html'
import { logger } from '../../../utils/logger.js'
import { getFlightSettingsByUuid, upsertFlightSettings } from '../../../utils/dbConnector.js'
import { wrapSettingsPage } from '../../../utils/settingsLayout.js'

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
    ? `<p class="error">${escapeHtml(opts.error)}</p>`
    : ''

  const backLink = opts.pluginSettingId
    ? `<a class="back-link" href="https://trmnl.com/plugin_settings/${opts.pluginSettingId}/edit?force_refresh=true">← Back to TRMNL</a>`
    : ''

  const body = `
    <form method="POST" action="/v1/trmnl/flights/manage">
      <input type="hidden" name="uuid" value="${safeUuid}"/>
      <input type="hidden" name="jwt" value="${safeJwt}"/>

      <div class="card">
        <div class="field-label">Flight numbers</div>
        <input
          type="text"
          name="flightNumbers"
          value="${escapeHtml(opts.flightNumbers)}"
          placeholder="UA804, DL123"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
        />
        ${errorHtml}
        <p class="hint">
          Enter up to 4 flight numbers separated by commas — e.g. <strong>UA804, DL123</strong>.
          IATA (UA804) and ICAO (UAL804) formats are both accepted.
        </p>
        <p class="hint section-gap">
          Multiple flights rotate on each screen refresh throughout the day.
        </p>
        <p class="hint section-gap">
          Live telemetry (speed, altitude, heading) may be unavailable for flights in areas with sparse ADS-B receiver coverage, such as over the Atlantic.
        </p>
        <p class="hint section-gap">
          Flights that use a code-share flight number may have difficulties resolving the corrrect aircraft. If you notice this issue, try using the flight number of the airline that is actually operating the flight.
        </p>
      </div>

      <button class="submit-btn" type="submit">Save settings</button>
    </form>

    ${backLink}

    <div class="footer">
      <p>Data: <a href="https://aerodatabox.com" target="_blank">AeroDataBox</a>. Coverage is best for U.S., Canadian, and European flights. Data is sourced from global receivers and may be inconsistent at times.</p>
      <p style="margin-top:6px;">Missing flight data? Email <a href="mailto:andrew@subtype.space">andrew@subtype.space</a></p>
    </div>
  `

  return wrapSettingsPage('Flight Tracker Settings', body)
}

export const flightManageGetController: RequestHandler = async (req, res) => {
  const uuid = req.query.uuid as string | undefined
  const jwt = req.query.jwt as string | undefined
  if (!uuid) {
    logger.warn('[AERO] Missing UUID in request for settings page')
    res.status(400).send('Bad Request - missing UUID')
    return
  }

  logger.info('[AERO] Displaying plugin settings page')
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

  logger.info('[AERO] Saving user flight settings')
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
  logger.debug(`[AERO] ${uuid} updated flights to ${flightNumbers}`)

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
