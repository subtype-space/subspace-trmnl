import express from 'express'
import { requireTrmnlAuth } from '../../utils/trmnlAuth.js'
import trmnlInstallController from '../controllers/trmnlInstallController.js'
import trmnlMarkupController from '../controllers/trmnlMarkupController.js'

const router = express.Router()

router.get('/install', trmnlInstallController)

// 🔒 Protected screen generation endpoint
router.post('/markup', requireTrmnlAuth, trmnlMarkupController)

export default router