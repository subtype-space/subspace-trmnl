import { RequestHandler } from 'express'
import { logger } from '../../../utils/logger.js'
import { bindUserUuidToToken, upsertSettings } from '../../../utils/dbConnector.js'

export const trmnlInstallSuccessController: RequestHandler = async (req, res) => {
  // requireTrmnlAuth should already have run and set req.trmnl.tokenHash
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

  // Do not call bindUserUuIdToToken more than once
  // bindUserUuidToToken is from DB
  bindUserUuidToToken(tokenHash, userUuid)
  const pluginSettingId = req.body?.user?.plugin_setting_id

  // Set defaults
  const primary = 'RD'
  if (typeof pluginSettingId === 'number') {
    await upsertSettings({
      user_uuid: userUuid,
      plugin_setting_id: pluginSettingId,
      primary_line: primary,
      lines: defaultWatchLines(primary),
      crass_level: 0,

    })
  }
  logger.info('[TRML] install success for uuid', { userUuid })
  res.status(200).json({ ok: true })
}

const ALL_LINES = ['RD','BL','OR','SV','GR','YL'] as const

function defaultWatchLines(primary: string) {
  return ALL_LINES.filter((l) => l !== primary).join(',')
}