import { requireRole } from '../../auth/oauth.js'
import { getDockerClient } from '../../integrations/docker/dockerClient.js'
import { logger } from '../../utils/logger.js'
import type { ContainerAction } from '../../types/docker/types.js'

const DOCKER_READ_ROLE = 'docker:read'
const DOCKER_ADMIN_ROLE = 'docker:admin'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatUptime(created: number): string {
  const now = Date.now() / 1000
  const seconds = Math.floor(now - created)

  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function getContainerName(names: string[]): string {
  // Container names from Docker API start with '/'
  const name = names[0] ?? 'unknown'
  return name.startsWith('/') ? name.slice(1) : name
}

export async function listContainers(showAll: boolean): Promise<string> {
  requireRole(DOCKER_READ_ROLE)

  try {
    const client = getDockerClient()
    const containers = await client.listContainers(showAll)

    if (containers.length === 0) {
      return showAll ? 'No containers found.' : 'No running containers found.'
    }

    const lines: string[] = [
      `## Docker Containers${showAll ? ' (all)' : ' (running)'}`,
      '',
    ]

    // Group by state
    const running = containers.filter(c => c.State === 'running')
    const stopped = containers.filter(c => c.State !== 'running')

    if (running.length > 0) {
      lines.push(`### Running (${running.length})`)
      lines.push('')
      for (const container of running) {
        const name = getContainerName(container.Names)
        const ports = container.Ports
          .filter(p => p.PublicPort)
          .map(p => `${p.PublicPort}:${p.PrivatePort}/${p.Type}`)
          .join(', ') || 'none'

        lines.push(`- **${name}** (\`${container.Id.slice(0, 12)}\`)`)
        lines.push(`  - Image: \`${container.Image}\``)
        lines.push(`  - Status: ${container.Status}`)
        lines.push(`  - Ports: ${ports}`)
        lines.push(`  - Created: ${formatUptime(container.Created)} ago`)
        lines.push('')
      }
    }

    if (showAll && stopped.length > 0) {
      lines.push(`### Stopped (${stopped.length})`)
      lines.push('')
      for (const container of stopped) {
        const name = getContainerName(container.Names)
        lines.push(`- **${name}** (\`${container.Id.slice(0, 12)}\`)`)
        lines.push(`  - Image: \`${container.Image}\``)
        lines.push(`  - Status: ${container.Status}`)
        lines.push('')
      }
    }

    return lines.join('\n')
  } catch (e) {
    logger.error('[MCP] Docker listContainers error', e)
    return `Failed to list containers: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function inspectContainer(containerId: string): Promise<string> {
  requireRole(DOCKER_READ_ROLE)

  try {
    const client = getDockerClient()
    const info = await client.inspectContainer(containerId)
    const name = info.Name.startsWith('/') ? info.Name.slice(1) : info.Name

    const lines: string[] = [
      `## Container: ${name}`,
      '',
      `- **ID:** \`${info.Id.slice(0, 12)}\``,
      `- **Image:** \`${info.Config.Image}\``,
      `- **Created:** ${new Date(info.Created).toLocaleString()}`,
      '',
      '### State',
      `- Status: **${info.State.Status}**`,
      `- Running: ${info.State.Running}`,
      `- Paused: ${info.State.Paused}`,
      `- Restart Count: ${info.RestartCount}`,
    ]

    if (info.State.Running) {
      lines.push(`- PID: ${info.State.Pid}`)
      lines.push(`- Started: ${new Date(info.State.StartedAt).toLocaleString()}`)
    } else if (info.State.FinishedAt && info.State.FinishedAt !== '0001-01-01T00:00:00Z') {
      lines.push(`- Exit Code: ${info.State.ExitCode}`)
      lines.push(`- Finished: ${new Date(info.State.FinishedAt).toLocaleString()}`)
    }

    if (info.State.Health) {
      lines.push('')
      lines.push('### Health Check')
      lines.push(`- Status: **${info.State.Health.Status}**`)
      lines.push(`- Failing Streak: ${info.State.Health.FailingStreak}`)
    }

    // Network info
    if (info.NetworkSettings.IPAddress || Object.keys(info.NetworkSettings.Ports || {}).length > 0) {
      lines.push('')
      lines.push('### Network')
      if (info.NetworkSettings.IPAddress) {
        lines.push(`- IP Address: ${info.NetworkSettings.IPAddress}`)
      }
      const ports = Object.entries(info.NetworkSettings.Ports || {})
        .filter(([, bindings]) => bindings && bindings.length > 0)
        .map(([containerPort, bindings]) => {
          const hostBindings = bindings!.map(b => `${b.HostIp || '0.0.0.0'}:${b.HostPort}`).join(', ')
          return `${hostBindings} -> ${containerPort}`
        })
      if (ports.length > 0) {
        lines.push(`- Ports: ${ports.join(', ')}`)
      }
    }

    // Mounts
    if (info.Mounts && info.Mounts.length > 0) {
      lines.push('')
      lines.push('### Mounts')
      for (const mount of info.Mounts) {
        lines.push(`- \`${mount.Source}\` -> \`${mount.Destination}\` (${mount.Type}, ${mount.RW ? 'rw' : 'ro'})`)
      }
    }

    return lines.join('\n')
  } catch (e) {
    logger.error('[MCP] Docker inspectContainer error', e)
    return `Failed to inspect container: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function getContainerStats(containerId: string): Promise<string> {
  requireRole(DOCKER_READ_ROLE)

  try {
    const client = getDockerClient()
    const [info, stats] = await Promise.all([
      client.inspectContainer(containerId),
      client.getContainerStats(containerId),
    ])

    const name = info.Name.startsWith('/') ? info.Name.slice(1) : info.Name

    // Calculate CPU percentage
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0

    // Memory percentage
    const memPercent = stats.memory_stats.limit > 0
      ? (stats.memory_stats.usage / stats.memory_stats.limit) * 100
      : 0

    const lines: string[] = [
      `## Stats: ${name}`,
      '',
      '### CPU',
      `- Usage: **${cpuPercent.toFixed(2)}%**`,
      `- Online CPUs: ${stats.cpu_stats.online_cpus}`,
      '',
      '### Memory',
      `- Usage: **${formatBytes(stats.memory_stats.usage)}** / ${formatBytes(stats.memory_stats.limit)} (${memPercent.toFixed(1)}%)`,
    ]

    if (stats.memory_stats.stats) {
      lines.push(`- Cache: ${formatBytes(stats.memory_stats.stats.cache)}`)
      lines.push(`- RSS: ${formatBytes(stats.memory_stats.stats.rss)}`)
    }

    // Network stats
    if (stats.networks) {
      lines.push('')
      lines.push('### Network')
      for (const [name, net] of Object.entries(stats.networks)) {
        lines.push(`- **${name}:** RX ${formatBytes(net.rx_bytes)} / TX ${formatBytes(net.tx_bytes)}`)
      }
    }

    return lines.join('\n')
  } catch (e) {
    logger.error('[MCP] Docker getContainerStats error', e)
    return `Failed to get container stats: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function getContainerLogs(containerId: string, tail: number): Promise<string> {
  requireRole(DOCKER_READ_ROLE)

  try {
    const client = getDockerClient()
    const [info, logs] = await Promise.all([
      client.inspectContainer(containerId),
      client.getContainerLogs(containerId, { tail }),
    ])

    const name = info.Name.startsWith('/') ? info.Name.slice(1) : info.Name

    if (!logs || logs.trim() === '') {
      return `## Logs: ${name}\n\nNo logs available (last ${tail} lines).`
    }

    return `## Logs: ${name} (last ${tail} lines)\n\n\`\`\`\n${logs}\n\`\`\``
  } catch (e) {
    logger.error('[MCP] Docker getContainerLogs error', e)
    return `Failed to get container logs: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function containerAction(
  containerId: string,
  action: ContainerAction,
  timeout?: number
): Promise<string> {
  requireRole(DOCKER_ADMIN_ROLE)

  try {
    const client = getDockerClient()

    // Get container name before action for better messaging
    const info = await client.inspectContainer(containerId)
    const name = info.Name.startsWith('/') ? info.Name.slice(1) : info.Name

    // Validate action based on current state
    const currentState = info.State.Status
    const actionValidation: Record<ContainerAction, string[]> = {
      start: ['exited', 'created', 'dead'],
      stop: ['running', 'paused'],
      restart: ['running', 'paused', 'exited'],
      pause: ['running'],
      unpause: ['paused'],
      kill: ['running', 'paused'],
    }

    const validStates = actionValidation[action]
    if (!validStates.includes(currentState)) {
      return `Cannot ${action} container **${name}**: current state is \`${currentState}\`. Valid states for ${action}: ${validStates.join(', ')}.`
    }

    await client.containerAction(containerId, action, { timeout })

    const actionVerbs: Record<ContainerAction, string> = {
      start: 'started',
      stop: 'stopped',
      restart: 'restarted',
      pause: 'paused',
      unpause: 'unpaused',
      kill: 'killed',
    }

    logger.info(`[Docker] Container ${name} ${actionVerbs[action]}`)
    return `Container **${name}** has been ${actionVerbs[action]} successfully.`
  } catch (e) {
    logger.error('[MCP] Docker containerAction error', e)
    return `Failed to ${action} container: ${e instanceof Error ? e.message : String(e)}`
  }
}
