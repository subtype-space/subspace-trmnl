import { z } from 'zod'
import { getAlerts, getForecast } from './weather.js'
import { getStockDetails } from './stocks.js'
import { getIncidents, getStationInfo } from './metro.js'
import { getNodes, getVMs, getVMStatus, vmAction, cloneVm, getVMConfig, updateVMConfig, getTaskStatus } from './proxmox.js'
import { listContainers, inspectContainer, getContainerStats, getContainerLogs } from './docker.js'
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
      format: z.enum(['text', 'json']).optional().default('text').describe('Output format: "text" for human-readable, "json" for programmatic use'),
    },
    async ({ vmid, format }) => {
      const statusText = await getVMStatus(vmid, format)
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

  mcpServer.tool(
    'proxmox-vm-clone',
    'Clone a VM by giving an existing VMID, a new VM ID, and which node to perform the operation on.',
    {
      vmid: z.number().int().positive().describe('The VMID of the VM to clone'),
      newid: z.number().int().positive().describe('The new ID of the cloned VM'),
      node: z.string().describe('The node to perform the clone on'),
      name: z.string().optional().describe('Optional name for the cloned VM'),
    },
    async ({ vmid, newid, node, name }) => {
      const resultText = await cloneVm(node, vmid, newid, name)
      return {
        content: [
          {
            type: 'text',
            text: resultText
          }
        ]
      }
    }
  )

  mcpServer.tool(
    'get-proxmox-vm-config',
    'Returns the current configuration of a VM or LXC container (cores, memory, etc.) as JSON.',
    {
      vmid: z.number().int().positive().describe('The VMID of the VM or container'),
    },
    async ({ vmid }) => {
      const configText = await getVMConfig(vmid)
      return {
        content: [{ type: 'text', text: configText }],
      }
    }
  )

  mcpServer.tool(
    'proxmox-vm-config',
    'Update the configuration of a VM or LXC container. Can modify CPU cores and memory. VM may need restart for changes to take effect.',
    {
      vmid: z.number().int().positive().describe('The VMID of the VM or container'),
      cores: z.number().int().min(1).max(6).optional().describe('Number of CPU cores (1-6)'),
      memory: z.number().int().min(16).max(32768).optional().describe('Memory size in MB (16-32768, i.e. up to 32GB). Any larger requests must be done through web interface.'),
    },
    async ({ vmid, cores, memory }) => {
      const resultText = await updateVMConfig(vmid, { cores, memory })
      return {
        content: [{ type: 'text', text: resultText }],
      }
    }
  )

  mcpServer.tool(
    'get-proxmox-task-status',
    'Check the status of a Proxmox task by its UPID. Returns whether the task is still running or has completed, along with the exit status. Use this to poll for task completion after initiating actions like reboot, clone, etc.',
    {
      upid: z.string().min(1).describe('The UPID (task ID) returned by a Proxmox action'),
    },
    async ({ upid }) => {
      const statusText = await getTaskStatus(upid)
      return {
        content: [{ type: 'text', text: statusText }],
      }
    }
  )

  // Docker tools
  mcpServer.tool(
    'get-docker-containers',
    'Returns a list of Docker containers with their status, ports, and resource info. By default shows all containers including stopped ones.',
    {
      showAll: z.boolean().optional().default(true).describe('If true, shows all containers including stopped ones. Default is true.'),
    },
    async ({ showAll }) => {
      const text = await listContainers(showAll ?? true)
      return {
        content: [{ type: 'text', text }],
      }
    }
  )

  mcpServer.tool(
    'get-docker-container-details',
    'Returns detailed information about a specific Docker container including state, network settings, mounts, and health checks.',
    {
      containerId: z.string().min(1).describe('Container ID or name'),
    },
    async ({ containerId }) => {
      const text = await inspectContainer(containerId)
      return {
        content: [{ type: 'text', text }],
      }
    }
  )

  mcpServer.tool(
    'get-docker-container-stats',
    'Returns live resource usage statistics for a running Docker container (CPU, memory, network I/O).',
    {
      containerId: z.string().min(1).describe('Container ID or name'),
    },
    async ({ containerId }) => {
      const text = await getContainerStats(containerId)
      return {
        content: [{ type: 'text', text }],
      }
    }
  )

  mcpServer.tool(
    'get-docker-container-logs',
    'Returns recent logs from a Docker container. Useful for debugging or monitoring. IMPORTANT: Always display the full log output to the user without summarizing or truncating. Use a code block with ```. Users need to see the complete logs for debugging.',
    {
      containerId: z.string().min(1).describe('Container ID or name'),
      tail: z.number().int().positive().optional().default(50).describe('Number of lines to return from the end of the logs. Default is 50.'),
    },
    async ({ containerId, tail }) => {
      const text = await getContainerLogs(containerId, tail ?? 50)
      return {
        content: [{ type: 'text', text }],
      }
    }
  )

}
