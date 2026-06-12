import type { Group, WsMessage } from './types.js'
import { DeviceManager } from './deviceManager.js'
import { uuid } from './utils/id.js'
import { log } from './utils/logger.js'

export class GroupManager {
  private groups = new Map<string, Group>()

  constructor(private deviceMgr: DeviceManager) {
    const defaultGroup: Group = {
      groupId: 'default',
      name: '局域网大厅',
      ownerDeviceId: 'system',
      ownerName: 'System',
      createdAt: Date.now(),
    }
    this.groups.set(defaultGroup.groupId, defaultGroup)
  }

  create(input: { ownerDeviceId: string; ownerName?: string; name?: string }): Group {
    const name = this.cleanName(input.name)
    const group: Group = {
      groupId: uuid(),
      name,
      ownerDeviceId: input.ownerDeviceId,
      ownerName: input.ownerName,
      createdAt: Date.now(),
    }

    this.groups.set(group.groupId, group)
    this.broadcastList()
    log('info', '创建群聊', { groupId: group.groupId, name: group.name, owner: group.ownerDeviceId })
    return group
  }

  get(groupId: string): Group | undefined {
    return this.groups.get(groupId)
  }

  list(): Group[] {
    return [...this.groups.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  sendList(deviceId: string): void {
    this.deviceMgr.send(deviceId, this.listMessage())
  }

  private broadcastList(): void {
    this.deviceMgr.broadcast(this.listMessage())
  }

  private listMessage(): WsMessage {
    return { type: 'group:list', payload: { groups: this.list() } }
  }

  private cleanName(name?: string): string {
    const safe = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, 32)
    return safe || '局域网群聊'
  }
}
