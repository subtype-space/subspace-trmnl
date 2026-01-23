import type {
  ProxmoxNode,
  ProxmoxNodeResponse,
  ProxmoxVM,
  ProxmoxVMListResponse,
  ProxmoxVMStatus,
  ProxmoxVMStatusResponse,
  ProxmoxVMAction,
  ProxmoxTaskResponse,
} from '../../types/proxmox/types.js'
import { logger } from '../../utils/logger.js'
// Using undici instead of native fetch because native fetch doesn't support
// skipping TLS verification per-request. undici's Agent allows us to set
// rejectUnauthorized: false for self-signed certs without affecting the whole process.
import { Agent, fetch as undiciFetch } from 'undici'

export class ProxmoxClient {
  private readonly apiUrl: string
  private readonly apiToken: string
  private readonly dispatcher: Agent | undefined

  constructor(opts: { apiUrl: string; apiToken: string; skipTlsVerify?: boolean }) {
    if (!opts.apiUrl) {
      logger.error('Missing PROXMOX_API_URL')
      throw new Error('Proxmox apiUrl is required')
    }
    if (!opts.apiToken) {
      logger.error('Missing PROXMOX_API_TOKEN')
      throw new Error('Proxmox apiToken is required')
    }

    // Strip trailing slash if present
    this.apiUrl = opts.apiUrl.replace(/\/+$/, '')
    this.apiToken = opts.apiToken

    if (opts.skipTlsVerify) {
      logger.warn('[Proxmox] TLS verification disabled - use only for self-signed certs')
      this.dispatcher = new Agent({
        connect: {
          rejectUnauthorized: false,
          // Skip hostname verification as well for self-signed certs
          checkServerIdentity: () => undefined,
        },
      })
    }
  }

  private async request<T>(method: 'GET' | 'POST', path: string): Promise<T> {
    const url = `${this.apiUrl}${path}`
    logger.debug(`[Proxmox] ${method} ${url}`)

    const res = await undiciFetch(url, {
      method,
      headers: {
        Authorization: `PVEAPIToken=${this.apiToken}`,
      },
      dispatcher: this.dispatcher,
    })

    if (!res.ok) {
      const body = await res.text()
      logger.warn(`[Proxmox] API error: ${res.status} ${res.statusText}`, body)
      throw new Error(`Proxmox API Error: ${res.status} ${res.statusText}`)
    }

    return (await res.json()) as T
  }

  async getNodes(): Promise<ProxmoxNode[]> {
    const response = await this.request<ProxmoxNodeResponse>('GET', '/api2/json/nodes')
    return response.data
  }

  async getVMs(node: string): Promise<ProxmoxVM[]> {
    // Fetch both QEMU VMs and LXC containers
    const [qemuRes, lxcRes] = await Promise.all([
      this.request<ProxmoxVMListResponse>('GET', `/api2/json/nodes/${encodeURIComponent(node)}/qemu`),
      this.request<ProxmoxVMListResponse>('GET', `/api2/json/nodes/${encodeURIComponent(node)}/lxc`),
    ])

    const qemuVMs: ProxmoxVM[] = qemuRes.data.map((vm) => ({ ...vm, node, type: 'qemu' as const }))
    const lxcVMs: ProxmoxVM[] = lxcRes.data.map((vm) => ({ ...vm, node, type: 'lxc' as const }))

    return [...qemuVMs, ...lxcVMs].sort((a, b) => a.vmid - b.vmid)
  }

  async getAllVMs(): Promise<ProxmoxVM[]> {
    const nodes = await this.getNodes()
    const allVMs: ProxmoxVM[] = []

    for (const node of nodes) {
      if (node.status !== 'online') continue
      try {
        const vms = await this.getVMs(node.node)
        allVMs.push(...vms)
      } catch (e) {
        logger.warn(`[Proxmox] Failed to get VMs for node ${node.node}`, e)
      }
    }

    return allVMs.sort((a, b) => a.vmid - b.vmid)
  }

  async getVMStatus(node: string, vmid: number, type: 'qemu' | 'lxc'): Promise<ProxmoxVMStatus> {
    const response = await this.request<ProxmoxVMStatusResponse>(
      'GET',
      `/api2/json/nodes/${encodeURIComponent(node)}/${type}/${vmid}/status/current`
    )
    return response.data
  }

  // Skeleton for VM actions - not fully wired up
  async vmAction(node: string, vmid: number, type: 'qemu' | 'lxc', action: ProxmoxVMAction): Promise<string> {
    logger.warn(`[Proxmox] vmAction called but not implemented: ${action} on ${type}/${vmid}`)
    // TODO: Implement when ready
    // const response = await this.request<ProxmoxTaskResponse>(
    //   'POST',
    //   `/api2/json/nodes/${encodeURIComponent(node)}/${type}/${vmid}/status/${action}`
    // )
    // return response.data
    throw new Error('VM actions are not yet implemented')
  }
}
