import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { StorageManager } from '../server/storage.js'
import { DeviceManager } from '../server/deviceManager.js'
import { TransferManager } from '../server/transferManager.js'

function fakeSocket() {
  return { readyState: 1, sent: [] as string[], send(d: string) { this.sent.push(d) } }
}

let tmpDir: string
let storage: StorageManager
let dm: DeviceManager
let tm: TransferManager

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lft-test-'))
  storage = new StorageManager(tmpDir)
  dm = new DeviceManager()
  tm = new TransferManager(storage, dm)
})

afterEach(() => {
  tm.destroy()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function meta(fileId: string, totalChunks: number, chunkLen: number) {
  return { fileId, name: `${fileId}.bin`, size: totalChunks * chunkLen, mime: 'application/octet-stream', totalChunks, chunkSize: chunkLen }
}

describe('TransferManager', () => {
  it('目标离线时不创建任务', () => {
    const from = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
    const t = tm.createOffer({ fromDeviceId: from.deviceId, toDeviceId: 'offline', files: [meta('f1', 1, 10)] })
    expect(t).toBeNull()
  })

  it('单分片文件接收后状态变为 ready', async () => {
    const from = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
    const to = dm.register(fakeSocket() as any, 'ua', '1.1.1.2', false)
    const t = tm.createOffer({ fromDeviceId: from.deviceId, toDeviceId: to.deviceId, files: [meta('f1', 1, 16)] })!
    expect(t.status).toBe('pending')
    await tm.ingestChunk({ transferId: t.transferId, fileId: 'f1', chunkIndex: 0, chunkBuffer: Buffer.alloc(16, 1) })
    expect(tm.get(t.transferId)!.status).toBe('ready')
  })

  it('分片写入幂等：重复同一分片不重复计数', async () => {
    const from = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
    const to = dm.register(fakeSocket() as any, 'ua', '1.1.1.2', false)
    const t = tm.createOffer({ fromDeviceId: from.deviceId, toDeviceId: to.deviceId, files: [meta('f1', 2, 10)] })!
    await tm.ingestChunk({ transferId: t.transferId, fileId: 'f1', chunkIndex: 0, chunkBuffer: Buffer.alloc(10, 1) })
    await tm.ingestChunk({ transferId: t.transferId, fileId: 'f1', chunkIndex: 0, chunkBuffer: Buffer.alloc(10, 1) }) // 重复
    expect(tm.get(t.transferId)!.uploadedBytes).toBe(10) // 仅计一次
    expect(tm.get(t.transferId)!.status).toBe('uploading')
    await tm.ingestChunk({ transferId: t.transferId, fileId: 'f1', chunkIndex: 1, chunkBuffer: Buffer.alloc(10, 2) })
    expect(tm.get(t.transferId)!.uploadedBytes).toBe(20)
    expect(tm.get(t.transferId)!.status).toBe('ready')
  })

  it('下载授权封闭性：仅接收方可下载', async () => {
    const from = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
    const to = dm.register(fakeSocket() as any, 'ua', '1.1.1.2', false)
    const other = dm.register(fakeSocket() as any, 'ua', '1.1.1.3', false)
    const t = tm.createOffer({ fromDeviceId: from.deviceId, toDeviceId: to.deviceId, files: [meta('f1', 1, 8)] })!
    await tm.ingestChunk({ transferId: t.transferId, fileId: 'f1', chunkIndex: 0, chunkBuffer: Buffer.alloc(8, 1) })
    expect(tm.authorizeDownload(t.transferId, to.deviceId)).toBe(true)
    expect(tm.authorizeDownload(t.transferId, from.deviceId)).toBe(false)
    expect(tm.authorizeDownload(t.transferId, other.deviceId)).toBe(false)
    expect(tm.authorizeDownload(t.transferId, undefined)).toBe(false)
    expect(tm.authorizeDownload('nope', to.deviceId)).toBe(false)
  })

  it('接受/拒绝信令路由到发送端', () => {
    const fromSock = fakeSocket()
    const from = dm.register(fromSock as any, 'ua', '1.1.1.1', false)
    const to = dm.register(fakeSocket() as any, 'ua', '1.1.1.2', false)
    const t = tm.createOffer({ fromDeviceId: from.deviceId, toDeviceId: to.deviceId, files: [meta('f1', 1, 8)] })!
    tm.acceptTransfer(t.transferId, to.deviceId)
    expect(fromSock.sent.some(s => s.includes('transfer:accept'))).toBe(true)
  })

  it('未就绪前不可下载', () => {
    const from = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
    const to = dm.register(fakeSocket() as any, 'ua', '1.1.1.2', false)
    const t = tm.createOffer({ fromDeviceId: from.deviceId, toDeviceId: to.deviceId, files: [meta('f1', 2, 8)] })!
    expect(tm.authorizeDownload(t.transferId, to.deviceId)).toBe(false) // pending
  })

  it('完整性校验：拼接后大小不符则标记失败', async () => {
    const from = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
    const to = dm.register(fakeSocket() as any, 'ua', '1.1.1.2', false)
    // 声明 size=100 但实际只发 10 字节单分片
    const badMeta = { fileId: 'bad', name: 'bad.bin', size: 100, mime: 'application/octet-stream', totalChunks: 1, chunkSize: 100 }
    const t = tm.createOffer({ fromDeviceId: from.deviceId, toDeviceId: to.deviceId, files: [badMeta] })!
    await tm.ingestChunk({ transferId: t.transferId, fileId: 'bad', chunkIndex: 0, chunkBuffer: Buffer.alloc(10, 1) })
    expect(tm.get(t.transferId)!.status).toBe('failed')
  })

  // 属性：任意乱序+重复的分片到达顺序，最终都能完成且字节数正确
  it('属性：乱序/重复分片最终完成且字节计数正确', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 6 }),
      async (totalChunks) => {
        const from = dm.register(fakeSocket() as any, 'ua', '1.1.1.1', false)
        const to = dm.register(fakeSocket() as any, 'ua', '1.1.1.2', false)
        const chunkLen = 4
        const t = tm.createOffer({ fromDeviceId: from.deviceId, toDeviceId: to.deviceId, files: [meta(`p${totalChunks}-${Math.random()}`, totalChunks, chunkLen)] })!
        const fileId = t.files[0].fileId
        // 构造乱序 + 重复的到达序列
        const order: number[] = []
        for (let i = 0; i < totalChunks; i++) order.push(i)
        order.push(...order) // 每个分片重复一次
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));[order[i], order[j]] = [order[j], order[i]]
        }
        for (const idx of order) {
          await tm.ingestChunk({ transferId: t.transferId, fileId, chunkIndex: idx, chunkBuffer: Buffer.alloc(chunkLen, idx + 1) })
        }
        const tr = tm.get(t.transferId)!
        expect(tr.status).toBe('ready')
        expect(tr.uploadedBytes).toBe(totalChunks * chunkLen)
      }
    ), { numRuns: 15 })
  })
})
