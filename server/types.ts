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
  toDeviceId: string
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
  | { type: 'transfer:offer'; payload: { transferId?: string; toDeviceId: string; files: FileMeta[]; message?: string; fromDeviceName?: string } }
  | { type: 'transfer:created'; payload: { transferId: string } }
  | { type: 'transfer:accept'; payload: { transferId: string } }
  | { type: 'transfer:reject'; payload: { transferId: string } }
  | { type: 'transfer:progress'; payload: { transferId: string; uploadedBytes: number; totalBytes: number } }
  | { type: 'transfer:ready'; payload: { transferId: string; files: FileMeta[] } }
  | { type: 'transfer:done'; payload: { transferId: string } }
  | { type: 'transfer:cancel'; payload: { transferId: string } }
  | { type: 'transfer:error'; payload: { transferId: string; error: string } }
  | { type: 'ping'; payload?: {} }
  | { type: 'pong'; payload?: {} }
