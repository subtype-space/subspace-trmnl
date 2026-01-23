import { z } from 'zod'
import { getAlerts, getForecast } from './weather.js'
import { getStockDetails } from './stocks.js'
import { getIncidents, getStationInfo } from './metro.js'
import { getNodes, getVMs, getVMStatus, vmAction } from './proxmox.js'
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

  // Proxmox tools
  mcpServer.tool(
    'get-proxmox-nodes',
    'Returns a list of all Proxmox nodes in the cluster with their status, CPU, memory, disk usage, and uptime.',
    {},
    async () => {
      const nodesText = await getNodes()
      return {
        content: [
          {
            type: 'text',
            text: nodesText,
          },
        ],
      }
    }
  )

  mcpServer.tool(
    'get-proxmox-vms',
    'Returns a list of all VMs and LXC containers in the Proxmox cluster. Optionally filter by node name. Shows status, resource usage, and network stats.',
    {
      node: z.string().optional().describe('Optional node name to filter VMs. If not provided, returns VMs from all nodes.'),
    },
    async ({ node }) => {
      const vmsText = await getVMs(node)
      return {
        content: [
          {
            type: 'text',
            text: vmsText,
          },
        ],
      }
    }
  )

  mcpServer.tool(
    'get-proxmox-vm-status',
    'Returns detailed status information for a specific VM or LXC container by its VMID. Includes CPU, memory, network I/O, and disk I/O stats.',
    {
      vmid: z.number().int().positive().describe('The VMID of the VM or container to query'),
    },
    async ({ vmid }) => {
      const statusText = await getVMStatus(vmid)
      return {
        content: [
          {
            type: 'text',
            text: statusText,
          },
        ],
      }
    }
  )

  mcpServer.tool(
    'proxmox-vm-action',
    'Perform an action on a VM or LXC container (start, stop, reboot, shutdown, suspend, resume). NOTE: This tool is not yet fully implemented.',
    {
      vmid: z.number().int().positive().describe('The VMID of the VM or container'),
      action: z
        .enum(['start', 'stop', 'reboot', 'shutdown', 'suspend', 'resume'])
        .describe('The action to perform on the VM'),
    },
    async ({ vmid, action }) => {
      const resultText = await vmAction(vmid, action)
      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      }
    }
  )
}
