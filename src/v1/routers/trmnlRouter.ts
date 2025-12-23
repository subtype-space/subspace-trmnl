import express from 'express'
import { requireTrmnlAuth, requireTrmnlUuidMatch } from '../../auth/trmnlAuth.js'
import trmnlInstallController from '../controllers/trmnlInstallController.js'
import { trmnlMarkupController } from '../controllers/trmnlMarkupController.js'
import { trmnlInstallSuccessController } from '../controllers/trmnlInstallSuccessController.js'
import { trmnlUninstallController } from '../controllers/trmnlUninstallController.js'
import { trmnlManageGetController, trmnlManagePostController } from '../controllers/trmnlManageController.js'
const router = express.Router()

// Should be mounted at /trmnl, so <api endpoint>/v1/trmnl/install and etc.
router.get('/install', trmnlInstallController)
router.post('/install_success', requireTrmnlAuth, trmnlInstallSuccessController)
router.post('/markup', express.urlencoded({ extended: false }), requireTrmnlAuth, requireTrmnlUuidMatch, trmnlMarkupController)
router.post('/uninstall', requireTrmnlAuth, requireTrmnlUuidMatch, trmnlUninstallController)
router.get('/manage', trmnlManageGetController)
router.post('/manage', express.urlencoded({ extended: false }), trmnlManagePostController)


export default router