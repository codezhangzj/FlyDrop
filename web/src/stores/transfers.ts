import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

export interface FileMeta {
  fileId: string
  name: string
  size: number
  mime: string
  totalChunks: number
  chunkSize: number
}

export type TransferStatus =
  | 'awaiting'   // 接收方待确认（接受/拒绝）
  | 'pending'    // 已接受，等待开始
  | 'uploading'  // 传输中
  | 'ready'      // 接收完成，可下载
  | 'completed'  // 已下载完成
  | 'failed'
  | 'rejected'
  | 'canceled'

export interface TransferItem {
  transferId: string
  direction: 'incoming' | 'outgoing'
  files: FileMeta[]
  status: TransferStatus
  uploadedBytes: number
  totalBytes: number
  message?: string
  peerName?: string      // 对端设备名
  createdAt: number
  // 运行时速度统计（不持久化也无妨）
  speed?: number         // bytes/s
  etaSec?: number
  _lastTs?: number
  _lastBytes?: number
}

export interface DownloadInfo {
  status: 'idle' | 'downloading' | 'done' | 'error'
  progress: number
  savePath?: string
  error?: string
  speed?: number
  etaSec?: number
  _lastTs?: number
  _lastBytes?: number
  totalBytes?: number
}

const LS_KEY = 'lft-transfers-v1'

// 计算平滑速度，返回 {speed, etaSec}
function calcSpeed(prevTs: number | undefined, prevBytes: number | undefined, nowBytes: number, totalBytes: number) {
  const now = Date.now()
  if (prevTs == null || prevBytes == null) {
    return { speed: 0, etaSec: 0, ts: now, bytes: nowBytes }
  }
  const dt = (now - prevTs) / 1000
  if (dt <= 0) return { speed: 0, etaSec: 0, ts: prevTs, bytes: prevBytes }
  const inst = (nowBytes - prevBytes) / dt
  const remaining = Math.max(0, totalBytes - nowBytes)
  const etaSec = inst > 0 ? remaining / inst : 0
  return { speed: Math.max(0, inst), etaSec, ts: now, bytes: nowBytes }
}

export const useTransfersStore = defineStore('transfers', () => {
  const transfers = ref<TransferItem[]>([])
  const downloads = ref<Record<string, DownloadInfo>>({})

  // ---- 持久化 ----
  function loadPersisted() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      if (Array.isArray(data.transfers)) {
        // 恢复为历史记录；进行中的状态视为失败
        transfers.value = data.transfers.map((t: TransferItem) => ({
          ...t,
          status: ['uploading', 'pending', 'awaiting'].includes(t.status) ? 'failed' : t.status,
          speed: undefined, etaSec: undefined, _lastTs: undefined, _lastBytes: undefined,
        }))
      }
      if (data.downloads && typeof data.downloads === 'object') {
        downloads.value = data.downloads
      }
    } catch {}
  }

  function persist() {
    try {
      const slim = transfers.value.slice(0, 100).map(t => ({
        transferId: t.transferId, direction: t.direction, files: t.files,
        status: t.status, uploadedBytes: t.uploadedBytes, totalBytes: t.totalBytes,
        message: t.message, peerName: t.peerName, createdAt: t.createdAt,
      }))
      localStorage.setItem(LS_KEY, JSON.stringify({ transfers: slim, downloads: downloads.value }))
    } catch {}
  }

  loadPersisted()
  watch([transfers, downloads], persist, { deep: true })

  function find(id: string) {
    return transfers.value.find(t => t.transferId === id)
  }

  // ---- 下载状态 ----
  function getDownload(key: string): DownloadInfo {
    return downloads.value[key] ?? { status: 'idle', progress: 0 }
  }
  function setDownload(key: string, info: Partial<DownloadInfo>) {
    const prev = downloads.value[key] ?? { status: 'idle', progress: 0 }
    downloads.value[key] = { ...prev, ...info }
  }
  // 下载进度（带速度/ETA）
  function setDownloadProgress(key: string, received: number, total: number) {
    const prev = downloads.value[key] ?? { status: 'downloading', progress: 0 }
    const { speed, etaSec, ts, bytes } = calcSpeed(prev._lastTs, prev._lastBytes, received, total)
    downloads.value[key] = {
      ...prev,
      status: 'downloading',
      progress: total > 0 ? received / total : 0,
      totalBytes: total,
      speed, etaSec, _lastTs: ts, _lastBytes: bytes,
    }
  }

  // ---- 传输 ----
  function addOutgoing(item: { transferId: string; files: FileMeta[]; totalBytes: number; message?: string; peerName?: string; status?: TransferStatus }) {
    if (find(item.transferId)) return
    transfers.value.unshift({
      transferId: item.transferId,
      direction: 'outgoing',
      files: item.files,
      status: item.status ?? 'pending',
      uploadedBytes: 0,
      totalBytes: item.totalBytes,
      message: item.message,
      peerName: item.peerName,
      createdAt: Date.now(),
    })
  }

  function addIncoming(payload: { transferId: string; files: FileMeta[]; message?: string; fromDeviceName?: string }) {
    if (find(payload.transferId)) return
    transfers.value.unshift({
      transferId: payload.transferId,
      direction: 'incoming',
      files: payload.files,
      status: 'awaiting',
      uploadedBytes: 0,
      totalBytes: payload.files.reduce((s, f) => s + f.size, 0),
      message: payload.message,
      peerName: payload.fromDeviceName,
      createdAt: Date.now(),
    })
  }

  function setStatus(transferId: string, status: TransferStatus) {
    const t = find(transferId)
    if (t) t.status = status
  }

  function onAccepted(transferId: string) {
    const t = find(transferId)
    if (t && (t.status === 'pending' || t.status === 'awaiting')) t.status = 'uploading'
  }

  function updateProgress(payload: { transferId: string; uploadedBytes: number; totalBytes: number }) {
    const t = find(payload.transferId)
    if (!t) return
    const { speed, etaSec, ts, bytes } = calcSpeed(t._lastTs, t._lastBytes, payload.uploadedBytes, payload.totalBytes)
    t.uploadedBytes = payload.uploadedBytes
    t.totalBytes = payload.totalBytes
    t.speed = speed
    t.etaSec = etaSec
    t._lastTs = ts
    t._lastBytes = bytes
    if (t.status === 'pending' || t.status === 'awaiting') t.status = 'uploading'
  }

  function onReady(payload: { transferId: string; files: FileMeta[] }) {
    const t = find(payload.transferId)
    if (t) {
      t.status = 'ready'
      t.files = payload.files
      t.speed = undefined
      t.etaSec = undefined
    }
  }

  function onDone(transferId: string) {
    setStatus(transferId, 'completed')
  }
  function onCancel(transferId: string) {
    setStatus(transferId, 'canceled')
  }
  function onReject(transferId: string) {
    setStatus(transferId, 'rejected')
  }
  function onError(payload: { transferId: string; error: string }) {
    setStatus(payload.transferId, 'failed')
  }

  function setLocalProgress(transferId: string, uploaded: number) {
    const t = find(transferId)
    if (!t) return
    const { speed, etaSec, ts, bytes } = calcSpeed(t._lastTs, t._lastBytes, uploaded, t.totalBytes)
    t.uploadedBytes = uploaded
    t.speed = speed
    t.etaSec = etaSec
    t._lastTs = ts
    t._lastBytes = bytes
  }

  function remove(transferId: string) {
    const idx = transfers.value.findIndex(t => t.transferId === transferId)
    if (idx >= 0) transfers.value.splice(idx, 1)
  }

  function clearFinished() {
    transfers.value = transfers.value.filter(t =>
      ['awaiting', 'pending', 'uploading'].includes(t.status)
    )
  }

  // 待确认的传入传输
  const awaitingTransfers = computed(() =>
    transfers.value.filter(t => t.direction === 'incoming' && t.status === 'awaiting')
  )
  // 可下载的传入传输（用于角标计数：ready 且未下载完成）
  const readyTransfers = computed(() =>
    transfers.value.filter(t => t.direction === 'incoming' && t.status === 'ready')
  )
  const activeTransfers = computed(() =>
    transfers.value.filter(t => ['uploading', 'pending', 'awaiting'].includes(t.status))
  )

  return {
    transfers, downloads,
    getDownload, setDownload, setDownloadProgress,
    awaitingTransfers, readyTransfers, activeTransfers,
    addOutgoing, addIncoming, setStatus, onAccepted, updateProgress,
    onReady, onDone, onCancel, onReject, onError, setLocalProgress,
    remove, clearFinished,
  }
})
