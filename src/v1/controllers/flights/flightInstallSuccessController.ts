import { RequestHandler } from 'express'
import { logger } from '../../../utils/logger.js'
import { bindUserUuidToToken, upsertFlightSettings } from '../../../utils/dbConnector.js'

export const flightInstallSuccessController: RequestHandler = async (req, res) => {
  logger.info('[AERO] Incoming install success request')
  const tokenHash = (req as any).trmnl?.tokenHash
  const userUuid = req.body?.user?.uuid

  if (!tokenHash) {
    res.status(500).json({ error: 'Internal Server Error', message: 'missing trmnl auth context' })
    return
  }

  if (typeof userUuid !== 'string' || !userUuid) {
    res.status(400).json({ error: 'Bad Request', message: 'missing user.uuid' })
    return
  }

  logger.debug('[AERO] Binding user UUID to token hash', { tokenHash, userUuid })

  bindUserUuidToToken(tokenHash, userUuid)
  const pluginSettingId = req.body?.user?.plugin_setting_id

  if (typeof pluginSettingId === 'number') {
    await upsertFlightSettings({
      user_uuid: userUuid,
      plugin_setting_id: pluginSettingId,
      flight_numbers: '',
    })
  }

  logger.info('[AERO] install success', { tokenHash, userUuid })
  res.status(200).json({ ok: true })
}
