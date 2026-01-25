import http from 'node:http'
import type {
  DockerContainer,
  DockerContainerInspect,
  DockerContainerStats,
  ContainerAction,
} from '../../types/docker/types.js'
import { logger } from '../../utils/logger.js'

interface DockerClientOptions {
  socketPath?: string
}

export class DockerClient {
  private socketPath: string

  constructor(options: DockerClientOptions = {}) {
    this.socketPath = options.socketPath ?? '/var/run/docker.sock'
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath: this.socketPath,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      }

      const req = http.request(options, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            let errorMessage = `Docker API error: ${res.statusCode}`
            try {
              const errorBody = JSON.parse(data)
              if (errorBody.message) {
                errorMessage = errorBody.message
              }
            } catch {
              // Ignore parse errors
            }
            reject(new Error(errorMessage))
            return
          }

          try {
            // Handle empty responses (like from POST actions)
            if (!data || data.trim() === '') {
              resolve({} as T)
              return
            }
            resolve(JSON.parse(data) as T)
          } catch (e) {
            reject(new Error(`Failed to parse Docker response: ${e}`))
          }
        })
      })

      req.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`Docker socket not found at ${this.socketPath}. Is Docker running?`))
        } else if ((e as NodeJS.ErrnoException).code === 'EACCES') {
          reject(new Error(`Permission denied accessing Docker socket. Check socket permissions.`))
        } else {
          reject(new Error(`Docker connection error: ${e.message}`))
        }
      })

      if (body) {
        req.write(JSON.stringify(body))
      }

      req.end()
    })
  }

  async listContainers(all = true): Promise<DockerContainer[]> {
    logger.debug(`[Docker] Listing containers (all=${all})`)
    return this.request<DockerContainer[]>('GET', `/containers/json?all=${all}`)
  }

  async inspectContainer(id: string): Promise<DockerContainerInspect> {
    logger.debug(`[Docker] Inspecting container ${id}`)
    return this.request<DockerContainerInspect>('GET', `/containers/${encodeURIComponent(id)}/json`)
  }

  async getContainerStats(id: string): Promise<DockerContainerStats> {
    logger.debug(`[Docker] Getting stats for container ${id}`)
    // stream=false returns a single stats snapshot
    return this.request<DockerContainerStats>('GET', `/containers/${encodeURIComponent(id)}/stats?stream=false`)
  }

  async getContainerLogs(id: string, options: { tail?: number; since?: number } = {}): Promise<string> {
    logger.debug(`[Docker] Getting logs for container ${id}`)
    const tail = options.tail ?? 100
    const params = new URLSearchParams({
      stdout: 'true',
      stderr: 'true',
      tail: String(tail),
      timestamps: 'true',
    })
    if (options.since) {
      params.set('since', String(options.since))
    }

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socketPath,
          path: `/containers/${encodeURIComponent(id)}/logs?${params.toString()}`,
          method: 'GET',
        },
        (res) => {
          const chunks: Buffer[] = []

          res.on('data', (chunk) => {
            chunks.push(chunk)
          })

          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Failed to get logs: ${res.statusCode}`))
              return
            }

            // Docker logs have an 8-byte header per frame (for multiplexed streams)
            // We need to strip these headers to get clean log output
            const buffer = Buffer.concat(chunks)
            const lines: string[] = []
            let offset = 0

            while (offset < buffer.length) {
              if (offset + 8 > buffer.length) break

              // First byte is stream type (0=stdin, 1=stdout, 2=stderr)
              // Bytes 4-7 are the size of the frame (big-endian)
              const size = buffer.readUInt32BE(offset + 4)
              offset += 8

              if (offset + size > buffer.length) break

              const line = buffer.subarray(offset, offset + size).toString('utf8')
              lines.push(line.trimEnd())
              offset += size
            }

            resolve(lines.join('\n'))
          })
        }
      )

      req.on('error', reject)
      req.end()
    })
  }

  async containerAction(id: string, action: ContainerAction, options: { timeout?: number } = {}): Promise<void> {
    logger.info(`[Docker] Performing ${action} on container ${id}`)
    const params = new URLSearchParams()
    if (options.timeout !== undefined) {
      params.set('t', String(options.timeout))
    }
    const query = params.toString() ? `?${params.toString()}` : ''
    await this.request<void>('POST', `/containers/${encodeURIComponent(id)}/${action}${query}`)
  }

  async ping(): Promise<boolean> {
    try {
      await this.request<string>('GET', '/_ping')
      return true
    } catch {
      return false
    }
  }
}

// Singleton instance with default socket path
let defaultClient: DockerClient | null = null

export function getDockerClient(): DockerClient {
  if (!defaultClient) {
    const socketPath = process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock'
    defaultClient = new DockerClient({ socketPath })
    logger.info(`[Docker] Client initialized with socket: ${socketPath}`)
  }
  return defaultClient
}
