import { config } from '../../../config.js'
import { createTrmnlInstallController } from '../trmnlCommon/trmnlInstallExchange.js'

// retrieve the access token from TRMNL (step 1ish and 2ish in auth flow)
const trmnlInstallController = createTrmnlInstallController(config.trmnl.clientId, config.trmnl.clientSecret, '[TRML]')

export default trmnlInstallController
