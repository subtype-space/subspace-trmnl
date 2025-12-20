import { RequestHandler } from 'express'
import { getSettingsByUuid, upsertSettings } from '../../utils/dbConnector.js'
import { logger } from '../../utils/logger.js'

export const trmnlManageGetController: RequestHandler = async (req, res) => {
  const uuid = req.query.uuid as string | undefined
  if (!uuid) {
    res.status(400).send('missing uuid')
    return
  }

  logger.info('[TRMNL] Displaying plugin settings page')
  const settings = await getSettingsByUuid(uuid)
  const lines = new Set((settings?.lines ?? '').split(',').filter(Boolean))
  const crass = (settings?.crass_level ?? 0) === 1

  res.type('text/html').send(`
    <html><body style="font-family: system-ui; max-width: 520px; margin: 24px auto;">
      <h2>Metro settings</h2>

      <form method="POST" action="/v1/trmnl/manage">
        <input type="hidden" name="uuid" value="${uuid}"/>

        <div style="margin: 12px 0;">
          <strong>Lines to monitor</strong><br/>
          ${['RD','BL','OR','SV','GR','YL'].map(l =>
            `<label style="display:block; margin-top:6px;">
              <input type="checkbox" name="lines" value="${l}" ${lines.has(l) ? 'checked' : ''}/>
              ${l}
            </label>`
          ).join('')}
        </div>

        <div style="margin: 12px 0;">
          <label>
            <input type="checkbox" name="crass" value="1" ${crass ? 'checked' : ''}/>
            Crass mode (\"you’re f***ed\" vs \"you’re screwed\")
          </label>
        </div>

        <button type="submit">Save</button>
      </form>

      ${
        settings?.plugin_setting_id
          ? `<p style="margin-top:16px;">
               <a href="https://usetrmnl.com/plugin_settings/${settings.plugin_setting_id}?force_refresh=true">
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
  // If only one checkbox checked, express gives string; if multiple, it’s string[]
  const rawLines = req.body?.lines
  const linesArr =
    Array.isArray(rawLines) ? rawLines :
    typeof rawLines === 'string' ? [rawLines] :
    []

  const lines = linesArr.join(',')
  const crassLevel = req.body?.crass === '1' ? 1 : 0
  logger.debug(`[TRMNL] ${uuid} updated user settings to ${lines} - ${crassLevel ? 'enabled' : 'disabled'}`)

  await upsertSettings({ user_uuid: uuid, lines, crass_level: crassLevel })

  res.redirect(`/v1/trmnl/manage?uuid=${encodeURIComponent(uuid)}`)
}