export type ProxmoxNode = {
  node: string
  status: 'online' | 'offline' | 'unknown'
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
  disk: number
  maxdisk: number
  uptime: number
}

export type ProxmoxNodeResponse = {
  data: ProxmoxNode[]
}

export type ProxmoxVM = {
  vmid: number
  name: string
  status: 'running' | 'stopped' | 'paused' | 'unknown'
  type: 'qemu' | 'lxc'
  node: string
  cpu: number
  cpus: number
  mem: number
  maxmem: number
  disk: number
  maxdisk: number
  uptime: number
  netin: number
  netout: number
}

export type ProxmoxVMListResponse = {
  data: Omit<ProxmoxVM, 'node' | 'type'>[]
}

export type ProxmoxVMStatus = {
  vmid: number
  name: string
  status: string
  qmpstatus?: string
  pid?: number
  cpu: number
  cpus: number
  mem: number
  maxmem: number
  disk: number
  maxdisk: number
  uptime: number
  netin: number
  netout: number
  diskread: number
  diskwrite: number
}

export type ProxmoxVMStatusResponse = {
  data: ProxmoxVMStatus
}

export type ProxmoxVMAction = 'start' | 'stop' | 'reboot' | 'shutdown' | 'suspend' | 'resume'

export type ProxmoxTaskResponse = {
  data: string // UPID (task ID)
}

export type ProxmoxTaskStatus = {
  status: 'running' | 'stopped'
  exitstatus?: string // "OK" or error message when stopped
  type: string
  id: string
  user: string
  node: string
  pid: number
  pstart: number
  starttime: number
  upid: string
}

export type ProxmoxTaskStatusResponse = {
  data: ProxmoxTaskStatus
}

