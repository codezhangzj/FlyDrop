import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { DeviceManager } from '../server/deviceManager.js'

// 假 WebSocket
function fakeSocket() {
  return { readyState: 1, sent: [] as string[], send(d: string) { this.sent.push(d) } }
}

describe('DeviceManager', () => {
  it('注册后出现在列表，deviceId 唯一', () => {
    const dm = new DeviceManager()
    const a = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
    const b = dm.register(fakeSocket() as any, 'ua', '1.1.1.2', false)
    expect(a.deviceId).not.toBe(b.deviceId)
    const ids = dm.list().map(d => d.deviceId)
    expect(ids).toContain(a.deviceId)
    expect(ids).toContain(b.deviceId)
    expect(dm.size).toBe(2)
  })

  it('注销后从列表移除', () => {
    const dm = new DeviceManager()
    const a = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
    dm.unregister(a.deviceId)
    expect(dm.list().map(d => d.deviceId)).not.toContain(a.deviceId)
  })

  it('主机使用 hostname 之外的客户端名优先', () => {
    const dm = new DeviceManager()
    const a = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false, '我的设备')
    expect(a.displayName).toBe('我的设备')
  })

  it('rename 更新名称并限制长度', () => {
    const dm = new DeviceManager()
    const a = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
    dm.rename(a.deviceId, 'x'.repeat(100))
    const d = dm.list().find(d => d.deviceId === a.deviceId)!
    expect(d.displayName.length).toBeLessThanOrEqual(32)
  })

  it('send 到不存在设备返回 false', () => {
    const dm = new DeviceManager()
    expect(dm.send('nope', { type: 'ping' } as any)).toBe(false)
  })

  it('send 到在线设备成功投递', () => {
    const dm = new DeviceManager()
    const sock = fakeSocket()
    const a = dm.register(sock as any, 'ua', '1.1.1.1', false)
    const okSent = dm.send(a.deviceId, { type: 'pong' } as any)
    expect(okSent).toBe(true)
    expect(sock.sent.some(s => s.includes('pong'))).toBe(true)
  })

  it('pruneStale 清理超时设备', () => {
    vi.useFakeTimers()
    try {
      const dm = new DeviceManager()
      const a = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
      // 推进 60 秒（超过 30s 心跳超时）
      vi.advanceTimersByTime(60_000)
      const removed = dm.pruneStale()
      expect(removed).toContain(a.deviceId)
      expect(dm.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // 属性：注册 N 个设备 -> N 个唯一 id 且全部可见
  it('属性：N 个设备 id 全唯一且全部在列表', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 30 }), (n) => {
      const dm = new DeviceManager()
      const ids = new Set<string>()
      for (let i = 0; i < n; i++) {
        ids.add(dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false).deviceId)
      }
      expect(ids.size).toBe(n)
      expect(dm.list().length).toBe(n)
    }))
  })
})
