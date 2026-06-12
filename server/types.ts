import type { DeviceType } from './utils/ua.js'

// 设备
export interface Device {
  deviceId: string
  displayName: string
  deviceType: DeviceType
  os?: string
  browser?: string
  ip: string
  isHost: boolean
  connectedAt: number
  lastHeartbeatAt: number
}

// 局域网群聊
export interface Group {
  groupId: string
  name: string
  ownerDeviceId: string
  ownerName?: string
  createdAt: number
}

// 文件元数据
export interface FileMeta {
  fileId: string
  name: string
  size: number
  mime: string
  totalChunks: number
  chunkSize: number
}

// 传输任务
export type TransferStatus = 'pending' | 'uploading' | 'ready' | 'completed' | 'failed' | 'expired'

export interface Transfer {
  transferId: string
  fromDeviceId: string
  toDeviceId?: string
  groupId?: string
  groupName?: string
  fromDeviceName?: string
  files: FileMeta[]
  status: TransferStatus
  createdAt: number
  expiresAt: number
  completedAt?: number
  message?: string
  uploadedBytes: number
  totalBytes: number
}

// WebSocket 消息
export type WsMessage =
  | { type: 'device:hello'; payload: { deviceId: string; displayName: string } }
  | { type: 'device:list'; payload: { devices: Device[] } }
  | { type: 'device:rename'; payload: { displayName: string } }
  | { type: 'group:list'; payload: { groups: Group[] } }
  | { type: 'group:create'; payload: { name?: string } }
  | { type: 'group:created'; payload: { group: Group } }
  | { type: 'transfer:offer'; payload: { transferId?: string; toDeviceId?: string; groupId?: string; groupName?: string; files: FileMeta[]; message?: string; fromDeviceName?: string; requiresAccept?: boolean } }
  | { type: 'transfer:created'; payload: { transferId: string; groupId?: string } }
  | { type: 'transfer:accept'; payload: { transferId: string } }
  | { type: 'transfer:reject'; payload: { transferId: string } }
  | { type: 'transfer:progress'; payload: { transferId: string; uploadedBytes: number; totalBytes: number } }
  | { type: 'transfer:ready'; payload: { transferId: string; files: FileMeta[]; groupId?: string; groupName?: string } }
  | { type: 'transfer:done'; payload: { transferId: string } }
  | { type: 'transfer:cancel'; payload: { transferId: string } }
  | { type: 'transfer:error'; payload: { transferId: string; error: string } }
  | { type: 'ping'; payload?: {} }
  | { type: 'pong'; payload?: {} }
