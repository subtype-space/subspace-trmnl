import express from 'express'
import { requireTrmnlAuth } from '../../auth/trmnlAuth.js'
import trmnlInstallController from '../controllers/trmnlInstallController.js'
import { trmnlMarkupController } from '../controllers/trmnlMarkupController.js'
import { trmnlInstallSuccessController } from '../controllers/trmnlInstallSuccessController.js'
import { trmnlUninstallController } from '../controllers/trmnlUninstallController.js'
import { trmnlManageGetController, trmnlManagePostController } from '../controllers/trmnlManageController.js'
const router = express.Router()

// Should be mounted at /trmnl, so <api endpoint>/v1/trmnl/install and etc.
router.get('/install', trmnlInstallController)
router.post('/install_success', requireTrmnlAuth, trmnlInstallSuccessController)
router.post('/markup', express.urlencoded({ extended: false }), requireTrmnlAuth, trmnlMarkupController)
router.post('/uninstall', requireTrmnlAuth, trmnlUninstallController)
router.get('/manage', trmnlManageGetController)
router.post('/manage', express.urlencoded({ extended: false }), trmnlManagePostController)
// TODO - implement /settings endpoint
// router.

export default router