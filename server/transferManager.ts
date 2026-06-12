import type { Transfer, FileMeta, WsMessage } from './types.js'
import { promises as fsPromises } from 'fs'
import { uuid } from './utils/id.js'
import { config } from './config.js'
import { StorageManager } from './storage.js'
import { DeviceManager } from './deviceManager.js'
import { log } from './utils/logger.js'
import { sanitizeFileName } from './utils/sanitize.js'

interface TransferEntry extends Transfer {
  receivedChunks: Map<string, Set<number>>
  assembledFiles: Set<string>
}

export class TransferManager {
  private transfers = new Map<string, TransferEntry>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private storage: StorageManager,
    private deviceMgr: DeviceManager
  ) {
    // 定时清理过期任务
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), config.cleanupIntervalMs)
  }

  /**
   * 创建传输任务。
   */
  createOffer(input: {
    fromDeviceId: string
    toDeviceId: string
    files: FileMeta[]
    message?: string
  }): Transfer | null {
    // 校验目标设备在线
    const target = this.deviceMgr.get(input.toDeviceId)
    if (!target) {
      this.deviceMgr.send(input.fromDeviceId, {
        type: 'transfer:error',
        payload: { transferId: '', error: '目标设备不在线' }
      })
      return null
    }

    const transferId = uuid()
    const safeFiles = this.safeFiles(input.files)

    const totalBytes = safeFiles.reduce((s, f) => s + f.size, 0)
    const fromDevice = this.deviceMgr.get(input.fromDeviceId)
    const fromDeviceName = fromDevice?.displayName ?? '未知设备'
    const t: TransferEntry = {
      transferId,
      fromDeviceId: input.fromDeviceId,
      toDeviceId: input.toDeviceId,
      fromDeviceName,
      files: safeFiles,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + config.ttlMs,
      message: input.message,
      uploadedBytes: 0,
      totalBytes,
      receivedChunks: new Map(),
      assembledFiles: new Set(),
    }

    this.transfers.set(transferId, t)
    this.storage.prepare(transferId)

    // 通知接收端：有新的传入传输，等待其接受/拒绝
    this.deviceMgr.send(input.toDeviceId, {
      type: 'transfer:offer',
      payload: {
        transferId,
        toDeviceId: input.toDeviceId,
        files: safeFiles,
        message: input.message,
        fromDeviceName,
        requiresAccept: true,
      }
    })

    // 通知发送端：任务已创建，等待对方接受（携带 transferId）
    this.deviceMgr.send(input.fromDeviceId, {
      type: 'transfer:created',
      payload: { transferId }
    })

    log('info', '创建传输任务（待接受）', { transferId, from: input.fromDeviceId, to: input.toDeviceId, files: input.files.length })
    return t
  }

  /**
   * 创建群发任务：发送端只上传一次，所有连接到服务的局域网设备都可下载。
   */
  createGroupOffer(input: {
    fromDeviceId: string
    groupId: string
    groupName: string
    files: FileMeta[]
    message?: string
  }): Transfer | null {
    const recipients = this.groupRecipientIds(input.fromDeviceId)
    if (recipients.length === 0) {
      this.deviceMgr.send(input.fromDeviceId, {
        type: 'transfer:error',
        payload: { transferId: '', error: '暂无在线设备可接收群发' }
      })
      return null
    }

    const transferId = uuid()
    const safeFiles = this.safeFiles(input.files)
    const totalBytes = safeFiles.reduce((s, f) => s + f.size, 0)
    const fromDevice = this.deviceMgr.get(input.fromDeviceId)
    const fromDeviceName = fromDevice?.displayName ?? '未知设备'

    const t: TransferEntry = {
      transferId,
      fromDeviceId: input.fromDeviceId,
      groupId: input.groupId,
      groupName: input.groupName,
      fromDeviceName,
      files: safeFiles,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + config.ttlMs,
      message: input.message,
      uploadedBytes: 0,
      totalBytes,
      receivedChunks: new Map(),
      assembledFiles: new Set(),
    }

    this.transfers.set(transferId, t)
    this.storage.prepare(transferId)

    this.sendToRecipients(t, {
      type: 'transfer:offer',
      payload: {
        transferId,
        groupId: input.groupId,
        groupName: input.groupName,
        files: safeFiles,
        message: input.message,
        fromDeviceName,
        requiresAccept: false,
      }
    })

    this.deviceMgr.send(input.fromDeviceId, {
      type: 'transfer:created',
      payload: { transferId, groupId: input.groupId }
    })
    this.deviceMgr.send(input.fromDeviceId, {
      type: 'transfer:accept',
      payload: { transferId }
    })

    log('info', '创建群发任务', {
      transferId,
      from: input.fromDeviceId,
      groupId: input.groupId,
      recipients: recipients.length,
      files: input.files.length,
    })
    return t
  }

  /**
   * 接收端接受传输：通知发送端开始上传。
   */
  acceptTransfer(transferId: string, byDeviceId: string): void {
    const t = this.transfers.get(transferId)
    if (t?.groupId) return
    if (!t || t.toDeviceId !== byDeviceId) return
    if (t.status !== 'pending') return
    this.deviceMgr.send(t.fromDeviceId, {
      type: 'transfer:accept',
      payload: { transferId }
    })
    log('info', '接收端已接受', { transferId })
  }

  /**
   * 接收端拒绝传输：通知发送端并清理。
   */
  rejectTransfer(transferId: string, byDeviceId: string): void {
    const t = this.transfers.get(transferId)
    if (t?.groupId) return
    if (!t || t.toDeviceId !== byDeviceId) return
    t.status = 'failed'
    this.storage.purge(transferId)
    this.transfers.delete(transferId)
    this.deviceMgr.send(t.fromDeviceId, {
      type: 'transfer:reject',
      payload: { transferId }
    })
    log('info', '接收端已拒绝', { transferId })
  }

  /**
   * 接收分块。
   */
  async ingestChunk(args: {
    transferId: string
    fileId: string
    chunkIndex: number
    chunkBuffer: Buffer
  }): Promise<{ done: boolean; uploadedBytes: number }> {
    const t = this.transfers.get(args.transferId)
    if (!t) throw new Error('transfer not found')
    if (t.status === 'expired' || t.status === 'failed') throw new Error('transfer closed')

    if (t.status === 'pending') t.status = 'uploading'

    await this.storage.writeChunk(t.transferId, args.fileId, args.chunkIndex, args.chunkBuffer)

    // 幂等：检查是否已记录
    let set = t.receivedChunks.get(args.fileId)
    if (!set) {
      set = new Set()
      t.receivedChunks.set(args.fileId, set)
    }

    if (!set.has(args.chunkIndex)) {
      set.add(args.chunkIndex)
      t.uploadedBytes += args.chunkBuffer.length
    }

    // 广播进度
    const progressMsg: WsMessage = {
      type: 'transfer:progress',
      payload: { transferId: t.transferId, uploadedBytes: t.uploadedBytes, totalBytes: t.totalBytes }
    }
    this.deviceMgr.send(t.fromDeviceId, progressMsg)
    this.sendToRecipients(t, progressMsg)

    // 检查文件是否完成
    const fileMeta = t.files.find(f => f.fileId === args.fileId)
    if (fileMeta && set.size === fileMeta.totalChunks && !t.assembledFiles.has(args.fileId)) {
      // 拼接文件
      const outPath = await this.storage.assemble(t.transferId, args.fileId, fileMeta.totalChunks, fileMeta.name)
      // 完整性校验：拼接后实际大小需与声明大小一致
      try {
        const actualSize = (await fsPromises.stat(outPath)).size
        if (fileMeta.size > 0 && actualSize !== fileMeta.size) {
          t.status = 'failed'
          this.storage.purge(t.transferId)
          const errMsg: WsMessage = {
            type: 'transfer:error',
            payload: { transferId: t.transferId, error: `文件大小校验失败（期望 ${fileMeta.size}，实际 ${actualSize}）` }
          }
          this.deviceMgr.send(t.fromDeviceId, errMsg)
          this.sendToRecipients(t, errMsg)
          log('warn', '完整性校验失败', { transferId: t.transferId, fileId: args.fileId, expected: fileMeta.size, actual: actualSize })
          return { done: false, uploadedBytes: t.uploadedBytes }
        }
      } catch {}
      t.assembledFiles.add(args.fileId)
    }

    // 检查是否所有文件都完成
    const allDone = t.files.every(f => t.assembledFiles.has(f.fileId))

    if (allDone) {
      t.status = 'ready'
      this.sendToRecipients(t, {
        type: 'transfer:ready',
        payload: { transferId: t.transferId, files: t.files, groupId: t.groupId, groupName: t.groupName }
      })
      log('info', '传输就绪', { transferId: t.transferId })
    }

    return { done: allDone, uploadedBytes: t.uploadedBytes }
  }

  /**
   * 获取传输任务。
   */
  get(transferId: string): Transfer | undefined {
    return this.transfers.get(transferId)
  }

  /**
   * 下载授权校验：
   * - 点对点传输：仅接收方可下载
   * - 群发传输：所有已连接到服务的非发送方设备可下载
   */
  authorizeDownload(transferId: string, requestingDeviceId: string | undefined): boolean {
    const t = this.transfers.get(transferId)
    if (!t) return false
    if (t.status !== 'ready' && t.status !== 'completed') return false
    if (!requestingDeviceId) return false
    if (t.groupId) {
      return requestingDeviceId !== t.fromDeviceId && Boolean(this.deviceMgr.get(requestingDeviceId))
    }
    return t.toDeviceId === requestingDeviceId
  }

  /**
   * 获取已接收的分块列表。
   */
  getReceivedChunks(transferId: string, fileId: string): number[] {
    const t = this.transfers.get(transferId)
    if (!t) return []
    const set = t.receivedChunks.get(fileId)
    return set ? [...set].sort((a, b) => a - b) : []
  }

  /**
   * 标记为已下载完成。
   */
  markCompleted(transferId: string): void {
    const t = this.transfers.get(transferId)
    if (t && (t.status === 'ready' || t.status === 'completed')) {
      if (t.status === 'ready') {
        this.deviceMgr.send(t.fromDeviceId, {
          type: 'transfer:done',
          payload: { transferId }
        })
        log('info', '传输完成', { transferId })
      }
      t.status = 'completed'
      t.completedAt = Date.now()
    }
  }

  /**
   * 取消传输。
   */
  cancel(transferId: string, reason?: string): void {
    const t = this.transfers.get(transferId)
    if (!t || t.status === 'completed' || t.status === 'expired') return
    t.status = 'failed'
    this.storage.purge(transferId)
    this.deviceMgr.send(t.fromDeviceId, {
      type: 'transfer:cancel',
      payload: { transferId }
    })
    this.sendToRecipients(t, {
      type: 'transfer:cancel',
      payload: { transferId }
    })
    log('info', '传输取消', { transferId, reason })
  }

  /**
   * 发送端断开时，把其 PENDING/UPLOADING 的任务标记失败。
   */
  handleSenderDisconnect(deviceId: string): void {
    for (const [id, t] of this.transfers) {
      if (t.fromDeviceId === deviceId && (t.status === 'pending' || t.status === 'uploading')) {
        this.cancel(id, '发送方离线')
      }
    }
  }

  /**
   * 获取某设备相关的所有传输列表（作为接收方）。
   */
  listForDevice(deviceId: string): Transfer[] {
    const result: Transfer[] = []
    for (const t of this.transfers.values()) {
      if (t.groupId) {
        if (t.fromDeviceId !== deviceId && t.status !== 'failed' && t.status !== 'expired') {
          result.push(t)
        }
        continue
      }
      if (t.toDeviceId === deviceId || t.fromDeviceId === deviceId) {
        result.push(t)
      }
    }
    return result
  }

  private safeFiles(files: FileMeta[]): FileMeta[] {
    return files.map(f => ({
      ...f,
      name: sanitizeFileName(f.name),
    }))
  }

  private groupRecipientIds(fromDeviceId: string): string[] {
    return this.deviceMgr
      .list()
      .filter(d => d.deviceId !== fromDeviceId)
      .map(d => d.deviceId)
  }

  private recipientIds(t: TransferEntry): string[] {
    if (t.groupId) return this.groupRecipientIds(t.fromDeviceId)
    return t.toDeviceId ? [t.toDeviceId] : []
  }

  private sendToRecipients(t: TransferEntry, msg: WsMessage): void {
    for (const deviceId of this.recipientIds(t)) {
      this.deviceMgr.send(deviceId, msg)
    }
  }

  /**
   * 清理过期任务。
   * - 未完成任务：超过 expiresAt（TTL）即清理
   * - 已完成任务：超过 completedAt + 宽限期即清理（避免磁盘泄漏）
   */
  private cleanupExpired(): void {
    const now = Date.now()
    for (const [id, t] of this.transfers) {
      let shouldPurge = false

      if (t.status === 'completed') {
        // 已完成：下载后保留一段宽限期便于重下，之后清理
        if (t.completedAt && now - t.completedAt > config.completedGraceMs) {
          shouldPurge = true
        }
      } else if (t.expiresAt < now) {
        // 未完成：TTL 到期
        t.status = 'expired'
        shouldPurge = true
      }

      if (shouldPurge) {
        this.storage.purge(id)
        this.transfers.delete(id)
        log('info', '传输清理', { transferId: id, finalStatus: t.status })
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
  }
}
