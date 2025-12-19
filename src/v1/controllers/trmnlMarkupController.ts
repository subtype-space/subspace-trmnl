import { Request, Response } from 'express'
import { logger } from '../../utils/logger.js'

const trmnlMarkupController = async (req: Request, res: Response) => {
  logger.info('[TRMNL] markup request received')

  // TRMNL will POST user_uuid + plugin settings here
  const { user_uuid } = req.body ?? {}

  logger.debug('[TRMNL] body', req.body)

  // Temporary stub response so TRMNL is happy
  res.json({
    screen: {
      title: 'Commute Health',
      rows: [
        { type: 'text', text: 'Coming soon 🚇' },
      ],
    },
  })
}

export default trmnlMarkupController