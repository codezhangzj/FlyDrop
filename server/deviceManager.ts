import type { WebSocket } from 'ws'
import type { Device, WsMessage } from './types.js'
import { uuid, randomNickname } from './utils/id.js'
import { detectDeviceType, detectOS, detectBrowser } from './utils/ua.js'
import { config } from './config.js'
import { log } from './utils/logger.js'
import os from 'os'

interface DeviceEntry extends Device {
  socket: WebSocket
}

export class DeviceManager {
  private devices = new Map<string, DeviceEntry>()
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 注册新设备。
   */
  register(socket: WebSocket, ua: string, ip: string, isHost: boolean, clientName?: string): Device {
    // 生成设备名优先级：客户端提供 > 主机hostname > 随机昵称
    let displayName: string
    if (clientName && clientName.trim()) {
      displayName = clientName.trim().slice(0, 32)
    } else if (isHost) {
      displayName = os.hostname() || randomNickname()
    } else {
      displayName = randomNickname()
    }

    const device: Device = {
      deviceId: uuid(),
      displayName,
      deviceType: detectDeviceType(ua),
      os: detectOS(ua),
      browser: detectBrowser(ua),
      ip,
      isHost,
      connectedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
    }
    this.devices.set(device.deviceId, { ...device, socket })
    log('info', '设备上线', { deviceId: device.deviceId, name: device.displayName, type: device.deviceType })
    this.scheduleBroadcast()
    return device
  }

  /**
   * 注销设备。
   */
  unregister(deviceId: string): void {
    const d = this.devices.get(deviceId)
    if (d) {
      log('info', '设备离线', { deviceId, name: d.displayName })
      this.devices.delete(deviceId)
      this.scheduleBroadcast()
    }
  }

  /**
   * 更新心跳。
   */
  heartbeat(deviceId: string): void {
    const d = this.devices.get(deviceId)
    if (d) {
      d.lastHeartbeatAt = Date.now()
    }
  }

  /**
   * 改名。
   */
  rename(deviceId: string, displayName: string): void {
    const d = this.devices.get(deviceId)
    if (!d) return
    const safe = displayName.trim().slice(0, 32)
    if (safe.length === 0) return
    d.displayName = safe
    this.scheduleBroadcast()
  }

  /**
   * 返回设备列表（不含 socket）。
   */
  list(): Device[] {
    return [...this.devices.values()].map(({ socket, ...rest }) => rest)
  }

  /**
   * 获取单个设备。
   */
  get(deviceId: string): DeviceEntry | undefined {
    return this.devices.get(deviceId)
  }

  /**
   * 向指定设备发消息。
   */
  send(deviceId: string, msg: WsMessage): boolean {
    const d = this.devices.get(deviceId)
    if (!d || d.socket.readyState !== 1) return false
    d.socket.send(JSON.stringify(msg))
    return true
  }

  /**
   * 广播给所有设备。
   */
  broadcast(msg: WsMessage, excludeId?: string): void {
    const data = JSON.stringify(msg)
    for (const [id, d] of this.devices) {
      if (id === excludeId) continue
      if (d.socket.readyState === 1) {
        d.socket.send(data)
      }
    }
  }

  /**
   * 带节流的设备列表广播。
   */
  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      this.broadcastDeviceList()
    }, config.broadcastDebounceMs)
  }

  private broadcastDeviceList(): void {
    const msg: WsMessage = { type: 'device:list', payload: { devices: this.list() } }
    this.broadcast(msg)
  }

  /**
   * 清理心跳超时的设备。
   */
  pruneStale(): string[] {
    const now = Date.now()
    const removed: string[] = []
    for (const [id, d] of this.devices) {
      if (now - d.lastHeartbeatAt > config.heartbeatTimeoutMs) {
        removed.push(id)
      }
    }
    for (const id of removed) {
      this.unregister(id)
    }
    return removed
  }

  /**
   * 在线设备数。
   */
  get size(): number {
    return this.devices.size
  }
}
