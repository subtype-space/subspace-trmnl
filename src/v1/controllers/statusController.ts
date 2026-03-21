import { createRequire } from 'module'
import { Request, Response } from 'express'
import { logger } from '../../utils/logger.js'
import { config } from '../../config.js'

const require = createRequire(import.meta.url)
const { version } = require('../../package.json') as { version: string }

const ACTIVE_VERSION = config.api.activeVersion

const statusController = (request: Request, response: Response) => {
  logger.debug('Accessed /status')
  response.status(200).json({ api_version: `${ACTIVE_VERSION}`, release: version })
}

export default statusController
