import { config } from '../../../config.js'
import { createTrmnlInstallController } from '../trmnlCommon/trmnlInstallExchange.js'

const flightInstallController = createTrmnlInstallController(
  config.trmnl.flightsClientId,
  config.trmnl.flightsClientSecret,
  '[AERO]'
)

export default flightInstallController
