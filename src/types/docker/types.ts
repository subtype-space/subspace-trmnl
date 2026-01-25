export interface DockerContainer {
  Id: string
  Names: string[]
  Image: string
  ImageID: string
  Command: string
  Created: number
  State: string
  Status: string
  Ports: DockerPort[]
  Labels: Record<string, string>
  NetworkSettings: {
    Networks: Record<string, DockerNetwork>
  }
  Mounts: DockerMount[]
}

export interface DockerPort {
  IP?: string
  PrivatePort: number
  PublicPort?: number
  Type: string
}

export interface DockerNetwork {
  IPAddress: string
  Gateway: string
  MacAddress: string
  NetworkID: string
}

export interface DockerMount {
  Type: string
  Name?: string
  Source: string
  Destination: string
  Mode: string
  RW: boolean
}

export interface DockerContainerInspect {
  Id: string
  Created: string
  Path: string
  Args: string[]
  State: {
    Status: string
    Running: boolean
    Paused: boolean
    Restarting: boolean
    OOMKilled: boolean
    Dead: boolean
    Pid: number
    ExitCode: number
    Error: string
    StartedAt: string
    FinishedAt: string
    Health?: {
      Status: string
      FailingStreak: number
      Log: Array<{
        Start: string
        End: string
        ExitCode: number
        Output: string
      }>
    }
  }
  Name: string
  RestartCount: number
  Config: {
    Image: string
    Env: string[]
    Labels: Record<string, string>
  }
  NetworkSettings: {
    IPAddress: string
    Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null>
  }
  Mounts: DockerMount[]
}

export interface DockerContainerStats {
  read: string
  cpu_stats: {
    cpu_usage: {
      total_usage: number
      percpu_usage?: number[]
      usage_in_kernelmode: number
      usage_in_usermode: number
    }
    system_cpu_usage: number
    online_cpus: number
  }
  precpu_stats: {
    cpu_usage: {
      total_usage: number
      percpu_usage?: number[]
      usage_in_kernelmode: number
      usage_in_usermode: number
    }
    system_cpu_usage: number
    online_cpus: number
  }
  memory_stats: {
    usage: number
    max_usage: number
    limit: number
    stats?: {
      cache: number
      rss: number
    }
  }
  networks?: Record<string, {
    rx_bytes: number
    rx_packets: number
    tx_bytes: number
    tx_packets: number
  }>
}

export type ContainerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill'
