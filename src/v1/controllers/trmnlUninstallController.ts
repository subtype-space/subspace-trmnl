import { RequestHandler } from 'express'
import { logger } from '../../utils/logger.js'
import { revokeByUserUuid } from '../../utils/dbConnector.js'

// Reminder - endpoint protected by trmnlAuth
export const trmnlUninstallController: RequestHandler = async (req, res) => {
  const userUuid = req.body?.user_uuid

  if (typeof userUuid !== 'string' || !userUuid) {
    res.status(400).json({ error: 'missing user_uuid' })
    return
  }
  logger.info('[TRMNL] Received uninstall request for ', { userUuid })

  revokeByUserUuid(userUuid)
  logger.info('[TRMNL] uninstalled', { userUuid })
  res.status(200).json({ ok: true })
}