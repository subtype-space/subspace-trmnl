import { RequestHandler } from 'express'
import { getSettingsByUuid, upsertSettings } from '../../utils/dbConnector.js'
import { logger } from '../../utils/logger.js'

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export const trmnlManageGetController: RequestHandler = async (req, res) => {
  const uuid = req.query.uuid as string | undefined
  if (!uuid) {
    res.status(400).send('missing uuid')
    return
  }

  const safeUuid = escapeHtml(uuid)

  logger.info('[TRMNL] Displaying plugin settings page')
  const settings = await getSettingsByUuid(uuid)
  const primary = (settings as any)?.primary_line ?? 'RD'
  const lines = new Set((settings?.lines ?? '').split(',').filter(Boolean))
  const crass = (settings?.crass_level ?? 0) === 1

  res.type('text/html').send(`
    <html><body style="font-family: system-ui; max-width: 520px; margin: 24px auto;">
      <h2>Metro settings</h2>

      <form method="POST" action="/v1/trmnl/manage">
        <input type="hidden" name="uuid" value="${safeUuid}"/>

        <div style="margin: 12px 0;">
          <strong>Line to monitor</strong><br/>
          ${['RD', 'BL', 'OR', 'SV', 'GR', 'YL']
            .map((l) =>
              `
                <label style="display:block; margin-top:6px;">
                  <input type="radio" name="primaryLine" value="${l}" ${primary === l ? 'checked' : ''}/>
                  ${l}
                </label>
              `.trim()
            )
            .join('')}
        </div>

        <div style="margin: 12px 0;">
          <strong>Show status for other lines</strong><br/>
${['RD', 'BL', 'OR', 'SV', 'GR', 'YL']
  .map((l) =>
    `
      <label style="display:block; margin-top:6px;">
        <input
          type="checkbox"
          name="lines"
          value="${l}"
          ${l === primary ? 'disabled' : ''}
          ${l !== primary && lines.has(l) ? 'checked' : ''}
        />
        ${l}${l === primary ? ' (primary)' : ''}
      </label>
    `.trim()
  )
  .join('')}
        </div>

        <div style="margin: 12px 0;">
          <label>
            <input type="checkbox" name="crass" value="1" ${crass ? 'checked' : ''}/>
            Crass mode (\"you\'re f***ed\" vs \"you\'re screwed\")
          </label>
        </div>

        <button type="submit">Save</button>
      </form>

      ${
        settings?.plugin_setting_id
          ? `<p style="margin-top:16px;">
                <a href="https://usetrmnl.com/plugin_settings/${settings.plugin_setting_id}/edit?force_refresh=true">
                Back to TRMNL
                </a>
             </p>`
          : ''
      }
    </body></html>
  `)
}

export const trmnlManagePostController: RequestHandler = async (req, res) => {
  const uuid = req.body?.uuid
  if (typeof uuid !== 'string' || !uuid) {
    res.status(400).send('missing uuid')
    return
  }

  logger.info('[TRMNL] Saving user settings')
  const rawLines = req.body?.lines
  const primaryLine = req.body?.primaryLine
  if (typeof primaryLine !== 'string' || !['RD', 'BL', 'OR', 'SV', 'GR', 'YL'].includes(primaryLine)) {
    res.status(400).send('missing/invalid primaryLine')
    return
  }
  const linesArr = Array.isArray(rawLines) ? rawLines : typeof rawLines === 'string' ? [rawLines] : []
  const filtered = linesArr.map((s) => s.trim().toUpperCase()).filter((l) => l && l !== primaryLine)
  const lines = filtered.join(',')
  const crassLevel = req.body?.crass === '1' ? 1 : 0
  logger.debug(`[TRMNL] ${uuid} updated user settings to ${lines} - ${crassLevel ? 'enabled' : 'disabled'}`)

  await upsertSettings({ user_uuid: uuid, primary_line: primaryLine, lines, crass_level: crassLevel })

  const settings = await getSettingsByUuid(uuid)
  const pluginSettingId = settings?.plugin_setting_id

  if (pluginSettingId) {
    res.redirect(`https://usetrmnl.com/plugin_settings/${pluginSettingId}/edit?force_refresh=true`)
    return
  }

  res.redirect(`/v1/trmnl/manage?uuid=${encodeURIComponent(uuid)}`)
}
