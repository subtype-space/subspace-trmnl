import { z } from 'zod'
import { getAlerts, getForecast } from './weather.js'
import { getStockDetails } from './stocks.js'
import { getIncidents, getStationInfo, getBusInfo } from './metro.js'
import { logger } from '../../utils/logger.js'


type SimpleToolRegistrar = {
  tool: (
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    // you can keep this loose – we only care that it’s callable
    handler: (args: any, request?: any) => Promise<any> | any
  ) => unknown
}


export function registerTools(mcpServer: SimpleToolRegistrar) {
  mcpServer.tool(
    'get-alerts',
    'Retrieves active weather alerts for a specific US state (e.g. tornado watches, heat advisories).',
    {
      state: z.string().length(2).describe('Two-letter state code (e.g. CA, NY)'),
    },
    async ({ state }) => {
      const alertsText = await getAlerts({ state })
      return {
        content: [
          {
            type: 'text',
            text: alertsText,
          },
        ],
      }
    }
  )

  mcpServer.tool(
    'get-forecast',
    'Provides a detailed 7-day weather forecast based on latitude and longitude.',
    {
      latitude: z.number().min(-90).max(90).describe('Latitude of the location'),
      longitude: z.number().min(-180).max(180).describe('Longitude of the location'),
    },
    async ({ latitude, longitude }) => {
      const forecastText = await getForecast({ latitude, longitude })
      return {
        content: [
          {
            type: 'text',
            text: forecastText,
          },
        ],
      }
    }
  )

  mcpServer.tool(
    'get-stock',
    'Provides stock information, including news titles for sentiment analysis (price, name, percent change, news) for one or more stocks. Ticker names must be provided in all caps, with no special characters.',
    {
      stocks: z
        .array(
          z
            .string()
            .min(1)
            .max(5)
            .regex(/^[A-Z]+$/, 'Stock tickers must be uppercase letters and no special characters')
            .describe('A valid stock ticker symbol')
        )
        .min(1)
        .max(50)
        .describe('A list of one or more stock ticker symbols (e.g. AAPL, AMD'),
    },
    async ({ stocks }) => {
      const stockText = await getStockDetails({ stocks })
      return {
        content: [
          {
            type: 'text',
            text: stockText,
          },
        ],
      }
    }
  )

  mcpServer.tool(
    'get-wmata-incidents',
    'Returns any active alerts posted by WMATA (metro). Can sometimes be empty.',
    {},
    async () => {
      const alertsText = await getIncidents()
      return {
        content: [
          {
            type: 'text',
            text: alertsText,
          },
        ],
      }
    }
  )

  mcpServer.tool(
    'get-wmata-station-info',
    "Returns next train arrival for one or more stations. Will return an empty set of results when no predictions are available if a station is closed.\
        Some stations have two platforms, like Metro Center, which requires passing in both station codes. For trains with no passengers, the DestinationName will be 'No Passenger'\
        Before close, DestinationName will be 'LastTrain' if they are the last train in that line. You should format your response in a table with markdown",
    {
      stationCodes: z.array(z.string().min(2).max(3)).min(1).max(10).describe('An array of station codes'), // pass in at least 1 station code
    },
    async ({ stationCodes }) => {
      const predictionText = await getStationInfo({ stationCodes })
      logger.debug('STATION INFO RESPONSE:', predictionText)
      return {
        content: [
          {
            type: 'text',
            text: predictionText,
          },
        ],
      }
    }
  )

  mcpServer.tool(
    'get-bus-info',
    'Returns the next bus arrival times at a given stop. The stopID must be a 7-digit regional stop ID.',
    {
      stopID: z.string().min(1).max(7).describe('7-digit regional stop ID, e.g. 1001195'),
    },
    async ({ stopID }) => {
      const predictionText = await getBusInfo({ stopID })
      logger.debug('BUS PREDICTION RESPONSE:', predictionText)
      return {
        content: [
          {
            type: 'text',
            text: predictionText,
          },
        ],
      }
    }
  )
}
