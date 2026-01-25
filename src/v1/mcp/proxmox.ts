import { ProxmoxClient } from '../../integrations/proxmox/proxmoxClient.js'
import { logger } from '../../utils/logger.js'
import type { ProxmoxVMAction } from '../../types/proxmox/types.js'
import { requireRole } from '../../auth/oauth.js'

// Role required to use Proxmox read tools (nodes, VMs, status)
const PROXMOX_READ_ROLE = 'proxmox:read'
// Role required to use Proxmox write tools (vm actions)
const PROXMOX_ADMIN_ROLE = 'proxmox:admin'
const VALID_VM_ACTIONS: ReadonlyArray<ProxmoxVMAction> = [
  'start',
  'stop',
  'reboot',
  'shutdown',
  'suspend',
  'resume'
]
const VALID_VM_ACTION_SET = new Set(VALID_VM_ACTIONS)

const apiUrl = process.env.PROXMOX_API_URL ?? ''
const apiToken = process.env.PROXMOX_API_TOKEN ?? ''
const skipTlsVerify = process.env.PROXMOX_SKIP_TLS_VERIFY === 'true'

logger.info(`[Proxmox] Config: url=${apiUrl ? 'set' : 'unset'}, token=${apiToken ? 'set' : 'unset'}, skipTls=${skipTlsVerify}`)

let client: ProxmoxClient | null = null

function getClient(): ProxmoxClient {
  if (!client) {
    client = new ProxmoxClient({ apiUrl, apiToken, skipTlsVerify })
  }
  return client
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export async function getNodes(): Promise<string> {
  logger.info('[MCP] proxmox.ts - getting nodes')
  requireRole(PROXMOX_READ_ROLE)

  try {
    const nodes = await getClient().getNodes()

    if (nodes.length === 0) {
      return 'No nodes found in Proxmox cluster.'
    }

    const formatted = nodes.map((node) => {
      const cpuPercent = (node.cpu * 100).toFixed(1)
      const memPercent = ((node.mem / node.maxmem) * 100).toFixed(1)
      const diskPercent = ((node.disk / node.maxdisk) * 100).toFixed(1)

      return [
        `Node: ${node.node}`,
        `  Status: ${node.status}`,
        `  CPU: ${cpuPercent}% (${node.maxcpu} cores)`,
        `  Memory: ${formatBytes(node.mem)} / ${formatBytes(node.maxmem)} (${memPercent}%)`,
        `  Disk: ${formatBytes(node.disk)} / ${formatBytes(node.maxdisk)} (${diskPercent}%)`,
        `  Uptime: ${formatUptime(node.uptime)}`,
      ].join('\n')
    })

    return `Proxmox Nodes:\n\n${formatted.join('\n\n')}`
  } catch (e) {
    logger.error('[MCP] Failed to get Proxmox nodes', e)
    return `Failed to retrieve Proxmox nodes: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function getVMs(nodeFilter?: string): Promise<string> {
  logger.info('[MCP] proxmox.ts - getting VMs', { nodeFilter })
  requireRole(PROXMOX_READ_ROLE)

  try {
    let vms
    if (nodeFilter) {
      vms = await getClient().getVMs(nodeFilter)
    } else {
      vms = await getClient().getAllVMs()
    }

    if (vms.length === 0) {
      return nodeFilter ? `No VMs found on node ${nodeFilter}.` : 'No VMs found in Proxmox cluster.'
    }

    const formatted = vms.map((vm) => {
      const memPercent = vm.maxmem > 0 ? ((vm.mem / vm.maxmem) * 100).toFixed(1) : '0'
      const cpuPercent = (vm.cpu * 100).toFixed(1)

      return [
        `${vm.type.toUpperCase()} ${vm.vmid}: ${vm.name}`,
        `  Status: ${vm.status}`,
        `  Node: ${vm.node}`,
        `  CPU: ${cpuPercent}% (${vm.cpus} cores)`,
        `  Memory: ${formatBytes(vm.mem)} / ${formatBytes(vm.maxmem)} (${memPercent}%)`,
        vm.status === 'running' ? `  Uptime: ${formatUptime(vm.uptime)}` : null,
        vm.status === 'running' ? `  Network: IN ${formatBytes(vm.netin)} / OUT ${formatBytes(vm.netout)}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    })

    const header = nodeFilter ? `VMs on node ${nodeFilter}:` : 'All VMs in Proxmox cluster:'
    return `${header}\n\n${formatted.join('\n\n')}`
  } catch (e) {
    logger.error('[MCP] Failed to get Proxmox VMs', e)
    return `Failed to retrieve Proxmox VMs: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function getVMStatus(vmid: number, format: 'text' | 'json' = 'text'): Promise<string> {
  logger.info('[MCP] proxmox.ts - getting VM status', { vmid, format })
  requireRole(PROXMOX_READ_ROLE)

  try {
    // First find the VM to get its node and type
    const allVMs = await getClient().getAllVMs()
    const vm = allVMs.find((v) => v.vmid === vmid)

    if (!vm) {
      return format === 'json'
        ? JSON.stringify({ error: `VM with ID ${vmid} not found.` })
        : `VM with ID ${vmid} not found.`
    }

    const status = await getClient().getVMStatus(vm.node, vmid, vm.type)

    // Return JSON format for programmatic use (diffing, etc.)
    if (format === 'json') {
      return JSON.stringify({
        vmid: status.vmid,
        name: status.name,
        status: status.status,
        qmpstatus: status.qmpstatus,
        node: vm.node,
        type: vm.type,
        cpus: status.cpus,
        maxmem: status.maxmem,
        maxdisk: status.maxdisk,
      })
    }

    // Return human-readable text format (default)
    const cpuPercent = (status.cpu * 100).toFixed(1)
    const memPercent = status.maxmem > 0 ? ((status.mem / status.maxmem) * 100).toFixed(1) : '0'

    const lines = [
      `${vm.type.toUpperCase()} ${status.vmid}: ${status.name}`,
      `Status: ${status.status}${status.qmpstatus ? ` (${status.qmpstatus})` : ''}`,
      `Node: ${vm.node}`,
      `CPU: ${cpuPercent}% (${status.cpus} cores)`,
      `Memory: ${formatBytes(status.mem)} / ${formatBytes(status.maxmem)} (${memPercent}%)`,
    ]

    if (status.status === 'running') {
      lines.push(
        `Uptime: ${formatUptime(status.uptime)}`,
        `Network: IN ${formatBytes(status.netin)} / OUT ${formatBytes(status.netout)}`,
        `Disk I/O: Read ${formatBytes(status.diskread)} / Write ${formatBytes(status.diskwrite)}`
      )
      if (status.pid) {
        lines.push(`PID: ${status.pid}`)
      }
    }

    return lines.join('\n')
  } catch (e) {
    logger.error('[MCP] Failed to get Proxmox VM status', e)
    const errorMsg = `Failed to retrieve VM status: ${e instanceof Error ? e.message : String(e)}`
    return format === 'json' ? JSON.stringify({ error: errorMsg }) : errorMsg
  }
}

export async function vmAction(vmid: number, action: ProxmoxVMAction): Promise<string> {
  logger.info('[MCP] proxmox.ts - VM action requested', { vmid, action })
  requireRole(PROXMOX_ADMIN_ROLE)

  try {
    if (!VALID_VM_ACTION_SET.has(action)) {
      return `Invalid action '${action}'. Valid actions: ${VALID_VM_ACTIONS.join(', ')}.`
    }

    // First find the VM to get its node and type
    const allVMs = await getClient().getAllVMs()
    const vm = allVMs.find((v) => v.vmid === vmid)

    if (!vm) {
      return `VM with ID ${vmid} not found.`
    }

    const taskId = await getClient().vmAction(vm.node, vmid, vm.type, action)
    return `Action ${action} initiated on ${vm.type}/${vmid}. Task: ${taskId}`
  } catch (e) {
    logger.error('[MCP] Proxmox VM action failed', e)
    return `Failed to perform action '${action}' on VM ${vmid}: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function cloneVm(node: string, vmid: number, newid: number, name?: string): Promise <string> {
  logger.info('[MCP] proxmox.ts - Create VM action requested - templated')
  requireRole(PROXMOX_ADMIN_ROLE)

  try {
    const taskId = await getClient().cloneVm(node, vmid, newid, name)
    return `Cloning in progress on ${node}. Cloning ${vmid} -> ${newid}. Clone name is ${name ?? 'unamed'}. TaskID: ${taskId}`
  } catch (e) {
    logger.error('[MCP] Failed to complete create VM action', e)
    return `Failed to create VM on node ${node}`
  }
}

export async function getVMConfig(vmid: number): Promise<string> {
  logger.info('[MCP] proxmox.ts - getting VM config', { vmid })
  requireRole(PROXMOX_READ_ROLE)

  try {
    // First find the VM to get its node and type
    const allVMs = await getClient().getAllVMs()
    const vm = allVMs.find((v) => v.vmid === vmid)

    if (!vm) {
      return `VM with ID ${vmid} not found.`
    }

    const config = await getClient().getVMConfig(vm.node, vmid, vm.type)

    // Return as JSON for diff service to parse
    // Include status so we can detect if restart is needed
    return JSON.stringify({
      vmid,
      name: config.name ?? vm.name,
      status: vm.status,
      cores: config.cores ?? 1,
      memory: config.memory ?? 512,
      type: vm.type,
      node: vm.node,
    })
  } catch (e) {
    logger.error('[MCP] Failed to get Proxmox VM config', e)
    return `Failed to retrieve VM config: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function updateVMConfig(
  vmid: number,
  config: { cores?: number; memory?: number }
): Promise<string> {
  logger.info('[MCP] proxmox.ts - updating VM config', { vmid, config })
  requireRole(PROXMOX_ADMIN_ROLE)

  try {
    // Validate inputs
    if (config.cores !== undefined && (config.cores < 1 || config.cores > 6)) {
      return `Invalid core count: ${config.cores}. Must be between 1 and 6.`
    }
    if (config.memory !== undefined && (config.memory < 16 || config.memory > 32768)) {
      return `Invalid memory size: ${config.memory}MB. Must be between 16MB and 32GB. For larger allocations, use the Proxmox web interface.`
    }

    // First find the VM to get its node and type
    const allVMs = await getClient().getAllVMs()
    const vm = allVMs.find((v) => v.vmid === vmid)

    if (!vm) {
      return `VM with ID ${vmid} not found.`
    }

    // Check if VM is running - warn user that changes may require restart
    const requiresRestart = vm.status === 'running'

    await getClient().updateVMConfig(vm.node, vmid, vm.type, config)

    const changes: string[] = []
    if (config.cores !== undefined) {
      changes.push(`cores: ${config.cores}`)
    }
    if (config.memory !== undefined) {
      changes.push(`memory: ${config.memory}MB`)
    }

    let message = `VM ${vmid} configuration updated: ${changes.join(', ')}.`
    if (requiresRestart) {
      message += ' Note: VM is running. Some changes may require a restart to take effect.'
    }

    return message
  } catch (e) {
    logger.error('[MCP] Failed to update Proxmox VM config', e)
    return `Failed to update VM config: ${e instanceof Error ? e.message : String(e)}`
  }
}
