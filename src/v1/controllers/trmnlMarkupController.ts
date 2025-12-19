import { RequestHandler } from 'express'
import { logger } from '../../utils/logger.js'
import { attachUserUuid } from '../../utils/dbConnector.js'

type TrmnlMeta = {
  user?: { name?: string; time_zone_iana?: string; utc_offset?: number }
  device?: { friendly_id?: string; percent_charged?: number; wifi_strength?: number; height?: number; width?: number }
  system?: { timestamp_utc?: number }
  plugin_settings?: { instance_name?: string }
}

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export const trmnlMarkupController: RequestHandler = async (req, res) => {
  const tokenHash = (req as any).trmnl?.tokenHash as string | undefined
  const userUuid = req.body?.user_uuid
  const trmnlRaw = req.body?.trmnl

  if (!tokenHash) {
    res.status(500).json({ error: 'missing trmnl auth context' })
    return
  }

  if (typeof userUuid === 'string' && userUuid) {
    await attachUserUuid(tokenHash, userUuid)
  }

  let meta: TrmnlMeta | null = null
  if (typeof trmnlRaw === 'string' && trmnlRaw) {
    try {
      meta = JSON.parse(trmnlRaw)
    } catch (e) {
      logger.warn('[TRMNL] Failed to parse trmnl metadata JSON')
    }
  }

  const instanceName = meta?.plugin_settings?.instance_name ?? 'coming soon'

  // TODO: Replace with real WMATA score later
  const status = 'MIXED'
  const subtitle = 'Some delays detected'

  const full = `
  <div class="view view--full">
    <div class="layout">
      <div class="columns">
        <div class="column">
          <div class="markdown gap--large">
            <span class="title">${escapeHtml(instanceName)}</span>

            <div class="content-element content content--center">
              <div style="font-size: 72px; font-weight: 700; letter-spacing: 2px;">
                ${escapeHtml(status)}
              </div>
              <div class="label mt-2">${escapeHtml(subtitle)}</div>
            </div>

            <div class="mt-4" style="display:flex; justify-content:space-between;">
              <span class="label label--underline">WMATA</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  `.trim()

  res.json({
    markup: full,
    markup_half_horizontal: full.replace('view--full', 'view--half_horizontal'),
    markup_half_vertical: full.replace('view--full', 'view--half_vertical'),
    markup_quadrant: full.replace('view--full', 'view--quadrant'),
    shared: '',
  })
}