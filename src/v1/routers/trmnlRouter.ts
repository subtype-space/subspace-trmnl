import express from 'express'
import { requireTrmnlAuth, requireTrmnlUuidMatch, requireTrmnlJwt, trmnlAuthByIP } from '../../auth/trmnlAuth.js'
import trmnlInstallController from '../controllers/metro/trmnlInstallController.js'
import { trmnlUninstallController } from '../controllers/trmnlCommon/trmnlUninstallController.js'

import { trmnlMarkupController } from '../controllers/metro/trmnlMarkupController.js'
import { trmnlInstallSuccessController } from '../controllers/metro/trmnlInstallSuccessController.js'
import { trmnlManageGetController, trmnlManagePostController } from '../controllers/metro/trmnlManageController.js'
import { trmnlStationPrediction } from '../controllers/metro/trmnlStationPrediction.js'
import flightInstallController from '../controllers/flights/flightInstallController.js'
import { flightInstallSuccessController } from '../controllers/flights/flightInstallSuccessController.js'
import { flightMarkupController } from '../controllers/flights/flightMarkupController.js'
import { flightManageGetController, flightManagePostController } from '../controllers/flights/flightManageController.js'
import { logIncomingAuth } from '../../utils/authLogger.js'
const router = express.Router()

// Should be mounted at /trmnl, so <api endpoint>/v1/trmnl/install and etc.

router.use(logIncomingAuth)

// metro handles free rail prediction and "Is my wmata commute screwed?" plugin
router.get('/metro/install', trmnlInstallController)
router.post('/metro/install_success', requireTrmnlAuth, trmnlInstallSuccessController)
router.post('/metro/markup', express.urlencoded({ extended: true }), requireTrmnlAuth, requireTrmnlUuidMatch, trmnlMarkupController)
router.post('/metro/uninstall', requireTrmnlAuth, requireTrmnlUuidMatch, trmnlUninstallController)
router.get('/metro/manage', requireTrmnlJwt, trmnlManageGetController)
router.post('/metro/manage', express.urlencoded({ extended: true }), requireTrmnlJwt, trmnlManagePostController)
router.get('/metro/rail-prediction', trmnlAuthByIP, trmnlStationPrediction)

// flights - live flight tracking plugin
router.get('/flights/install', flightInstallController)
router.post('/flights/install_success', requireTrmnlAuth, flightInstallSuccessController)
router.post('/flights/markup', express.urlencoded({ extended: true }), requireTrmnlAuth, requireTrmnlUuidMatch, flightMarkupController)
router.post('/flights/uninstall', requireTrmnlAuth, requireTrmnlUuidMatch, trmnlUninstallController)
router.get('/flights/manage', requireTrmnlJwt, flightManageGetController)
router.post('/flights/manage', express.urlencoded({ extended: true }), requireTrmnlJwt, flightManagePostController)

export default router