import express from 'express'
import statusController from '../controllers/statusController.js'

const statusRouter = express.Router()

statusRouter.get('/', statusController)

export default statusRouter
