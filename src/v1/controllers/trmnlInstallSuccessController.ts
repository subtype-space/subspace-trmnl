import { RequestHandler } from 'express'
import { logger } from '../../utils/logger.js'
import { attachUserUuid, upsertSettings } from '../../utils/dbConnector.js'

export const trmnlInstallSuccessController: RequestHandler = async (req, res) => {
  // requireTrmnlAuth should already have run and set req.trmnl.tokenHash
  const tokenHash = (req as any).trmnl?.tokenHash
  const userUuid = req.body?.user?.uuid

  if (!tokenHash) {
    res.status(500).json({ error: 'missing trmnl auth context' })
    return
  }

  if (typeof userUuid !== 'string' || !userUuid) {
    res.status(400).json({ error: 'missing user.uuid' })
    return
  }

  await attachUserUuid(tokenHash, userUuid)
  logger.info('[TRMNL] install success for uuid', { userUuid })
  const pluginSettingId = req.body?.user?.plugin_setting_id

  if (typeof pluginSettingId === 'number') {
    await upsertSettings({
      user_uuid: userUuid,
      plugin_setting_id: pluginSettingId,
    })
  }

  res.status(200).json({ ok: true })
}
