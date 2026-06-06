<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTransfersStore, type TransferItem } from '../stores/transfers'
import { useDevicesStore } from '../stores/devices'
import { wsClient } from '../services/ws'
import { useToast } from '../composables/useToast'
import { formatSize, formatSpeed, formatEta, formatTime } from '../services/format'
import { captureVideoThumbnail } from '../services/videoThumb'
import {
  isDesktop, desktopDownload, revealFile, onDownloadProgress,
} from '../services/desktop'
import {
  Inbox, Download, FolderOpen, FileText, Image as ImageIcon,
  Check, X, Loader, Trash2, Package, Clock, Copy, Type, Play, Film,
} from 'lucide-vue-next'

const transfersStore = useTransfersStore()
const devicesStore = useDevicesStore()
const toast = useToast()

const desktop = isDesktop()
const myDeviceId = computed(() => devicesStore.myDevice?.deviceId ?? '')

const incomingTransfers = computed(() =>
  transfersStore.transfers.filter(t => t.direction === 'incoming')
)
const outgoingTransfers = computed(() =>
  transfersStore.transfers.filter(t => t.direction === 'outgoing')
)
const hasFinished = computed(() =>
  transfersStore.transfers.some(t => !['awaiting', 'pending', 'uploading'].includes(t.status))
)

// 文本类传输：单个小文本文件，内联展示
const textCache = ref<Record<string, string>>({})
function isTextTransfer(t: TransferItem) {
  if (t.files.length !== 1) return false
  const f = t.files[0]
  return (f.mime.startsWith('text/') || f.name.toLowerCase().endsWith('.txt')) && f.size <= 64 * 1024
}
async function ensureText(t: TransferItem) {
  if (textCache.value[t.transferId] != null) return
  if (t.status !== 'ready' && t.status !== 'completed') return
  try {
    // 用流式预览端点，避免触发"已完成"
    const res = await fetch(streamUrl(t.transferId, t.files[0].fileId))
    if (res.ok) textCache.value[t.transferId] = await res.text()
  } catch {}
}
async function copyText(t: TransferItem) {
  const text = textCache.value[t.transferId] ?? ''
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      // 非安全上下文降级
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    toast.success('已复制文本')
  } catch {
    toast.error('复制失败')
  }
}

watch(incomingTransfers, (list) => {
  list.forEach(t => {
    if (isTextTransfer(t)) ensureText(t)
    if (t.status === 'ready' || t.status === 'completed') {
      t.files.forEach(f => { if (isVideo(f.mime)) ensureVideoThumb(t.transferId, f.fileId) })
    }
  })
}, { immediate: true, deep: true })

let unsub: (() => void) | null = null
onMounted(() => {
  if (desktop) {
    unsub = onDownloadProgress(({ key, received, total }) => {
      transfersStore.setDownloadProgress(key, received, total)
    })
  }
})
onUnmounted(() => unsub?.())

function zipKey(transferId: string) { return `zip:${transferId}` }
function dl(key: string) { return transfersStore.getDownload(key) }

function buildUrl(transferId: string, fileId?: string) {
  const base = fileId ? `/api/download/${transferId}/${fileId}` : `/api/download/${transferId}`
  return `${base}?deviceId=${encodeURIComponent(myDeviceId.value)}`
}

async function runDownload(key: string, url: string, fileName: string) {
  if (desktop) {
    transfersStore.setDownload(key, { status: 'downloading', progress: 0, _lastTs: undefined, _lastBytes: undefined })
    const res = await desktopDownload({ url, fileName, key })
    if (res.ok) {
      transfersStore.setDownload(key, { status: 'done', progress: 1, savePath: res.savePath, speed: 0, etaSec: 0 })
      toast.success(`已下载：${fileName}`)
    } else {
      transfersStore.setDownload(key, { status: 'error', progress: 0, error: res.error })
      toast.error(`下载失败：${fileName}`)
    }
  } else {
    const a = document.createElement('a')
    a.href = url; a.download = fileName
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    transfersStore.setDownload(key, { status: 'done', progress: 1 })
    toast.success('已开始下载')
  }
}

function downloadFile(transferId: string, fileId: string, fileName: string) {
  runDownload(fileId, buildUrl(transferId, fileId), fileName)
}
function downloadAll(transferId: string) {
  runDownload(zipKey(transferId), buildUrl(transferId), 'files.zip')
}
async function reveal(savePath?: string) {
  if (savePath) {
    const ok = await revealFile(savePath)
    if (!ok) toast.error('文件不存在或已移动')
  }
}

function acceptTransfer(t: TransferItem) {
  wsClient.send({ type: 'transfer:accept', payload: { transferId: t.transferId } })
  transfersStore.onAccepted(t.transferId)
  toast.success('已接受')
}
function rejectTransfer(t: TransferItem) {
  wsClient.send({ type: 'transfer:reject', payload: { transferId: t.transferId } })
  transfersStore.onReject(t.transferId)
}

function clearRecords() {
  transfersStore.clearFinished()
  toast.info('已清空记录')
}

function previewUrl(transferId: string, fileId: string) {
  return `/api/preview/${transferId}/${fileId}?deviceId=${encodeURIComponent(myDeviceId.value)}`
}
// 流式预览（视频播放 / 图片大图 / 文本读取），不触发"已完成"
function streamUrl(transferId: string, fileId: string) {
  return `/api/stream/${transferId}/${fileId}?deviceId=${encodeURIComponent(myDeviceId.value)}`
}

function isImage(mime: string) { return mime.startsWith('image/') }
function isVideo(mime: string) { return mime.startsWith('video/') }
function canPreview(t: TransferItem) {
  return t.status === 'ready' || t.status === 'completed'
}

// 图片大图浏览
const lightbox = ref<{ url: string; name: string } | null>(null)
function openImage(transferId: string, fileId: string, name: string) {
  lightbox.value = { url: streamUrl(transferId, fileId), name }
}
function closeLightbox() { lightbox.value = null }

// 视频内联播放（按 fileId 记录展开状态）
const playingVideos = ref<Set<string>>(new Set())
function toggleVideo(fileId: string) {
  const s = new Set(playingVideos.value)
  if (s.has(fileId)) s.delete(fileId); else s.add(fileId)
  playingVideos.value = s
}

// 视频首帧缩略图缓存（按 fileId）
const videoThumbs = ref<Record<string, string>>({})
const videoThumbTried = new Set<string>()
async function ensureVideoThumb(transferId: string, fileId: string) {
  if (videoThumbs.value[fileId] || videoThumbTried.has(fileId)) return
  videoThumbTried.add(fileId)
  const thumb = await captureVideoThumbnail(streamUrl(transferId, fileId))
  if (thumb) videoThumbs.value = { ...videoThumbs.value, [fileId]: thumb }
}

function statusInfo(t: TransferItem) {
  const recv = t.direction === 'incoming'
  switch (t.status) {
    case 'awaiting': return { text: '待确认', color: 'var(--color-warning)', icon: Clock }
    case 'pending': return { text: '等待中', color: 'var(--color-warning)', icon: Clock }
    case 'uploading': return { text: recv ? '接收中' : '上传中', color: 'var(--color-warning)', icon: Loader, spin: true }
    case 'ready': return { text: '可下载', color: 'var(--color-success)', icon: Download }
    case 'completed': return { text: '已完成', color: 'var(--color-primary)', icon: Check }
    case 'rejected': return { text: '已拒绝', color: 'var(--color-danger)', icon: X }
    case 'canceled': return { text: '已取消', color: 'var(--color-danger)', icon: X }
    default: return { text: '失败', color: 'var(--color-danger)', icon: X }
  }
}

function progressPercent(t: TransferItem) {
  if (t.totalBytes === 0) return 0
  return Math.round((t.uploadedBytes / t.totalBytes) * 100)
}
function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return ImageIcon
  if (mime.startsWith('video/')) return Film
  return FileText
}
</script>

<template>
  <div class="inbox-page">
    <div class="inbox-head">
      <h2 class="page-title" style="margin:0;">收件箱</h2>
      <button v-if="hasFinished" class="text-btn" @click="clearRecords">
        <Trash2 :size="15" /> 清空记录
      </button>
    </div>

    <div v-if="incomingTransfers.length === 0 && outgoingTransfers.length === 0" class="empty-state">
      <Inbox :size="48" class="empty-icon" />
      <p>暂无传输记录</p>
      <p class="empty-sub">当有设备向你发送文件时会显示在这里</p>
    </div>

    <!-- 收到的传输 -->
    <section v-if="incomingTransfers.length > 0">
      <h3 class="section-title">收到的文件</h3>
      <transition-group name="list" tag="div">
        <div v-for="transfer in incomingTransfers" :key="transfer.transferId" class="card transfer-card">
          <div class="transfer-header">
            <span class="transfer-status" :style="{ color: statusInfo(transfer).color }">
              <component :is="statusInfo(transfer).icon" :size="14" :class="{ spin: statusInfo(transfer).spin }" />
              {{ statusInfo(transfer).text }}
            </span>
            <span class="transfer-meta">
              <span v-if="transfer.peerName" class="peer">{{ transfer.peerName }}</span>
              {{ formatSize(transfer.totalBytes) }}
            </span>
          </div>

          <!-- 待确认操作 -->
          <div v-if="transfer.status === 'awaiting'" class="confirm-row">
            <button class="btn btn-secondary btn-sm" @click="rejectTransfer(transfer)"><X :size="15" /> 拒绝</button>
            <button class="btn btn-primary btn-sm" @click="acceptTransfer(transfer)"><Check :size="15" /> 接受</button>
          </div>

          <!-- 接收进度 + 速度 -->
          <div v-if="transfer.status === 'uploading' || transfer.status === 'pending'" class="recv-progress">
            <div class="progress-bar"><div class="progress-fill" :style="{ width: progressPercent(transfer) + '%' }"></div></div>
            <div class="meta-line">
              <span>{{ progressPercent(transfer) }}%</span>
              <span class="muted">{{ formatSpeed(transfer.speed) }}<template v-if="formatEta(transfer.etaSec)"> · 剩余 {{ formatEta(transfer.etaSec) }}</template></span>
            </div>
          </div>

          <!-- 文本类传输：内联展示 + 复制 -->
          <div v-if="isTextTransfer(transfer) && (transfer.status === 'ready' || transfer.status === 'completed')" class="text-block">
            <div class="text-head">
              <span class="text-label"><Type :size="14" /> 文本</span>
              <button class="btn btn-secondary btn-sm" aria-label="复制文本" @click="copyText(transfer)">
                <Copy :size="14" /> 复制
              </button>
            </div>
            <pre class="text-content">{{ textCache[transfer.transferId] ?? '加载中…' }}</pre>
          </div>

          <!-- 文件列表 -->
          <div class="transfer-files" v-else-if="transfer.status !== 'awaiting'">
            <div v-for="file in transfer.files" :key="file.fileId" class="transfer-file">
              <div class="transfer-file-item">
                <img
                  v-if="isImage(file.mime) && canPreview(transfer)"
                  :src="previewUrl(transfer.transferId, file.fileId)" class="file-preview clickable" alt="预览"
                  @click="openImage(transfer.transferId, file.fileId, file.name)"
                />
                <span
                  v-else-if="isVideo(file.mime) && canPreview(transfer) && videoThumbs[file.fileId]"
                  class="file-preview video-thumb" @click="toggleVideo(file.fileId)"
                >
                  <img :src="videoThumbs[file.fileId]" alt="视频缩略图" />
                  <span class="video-thumb-play"><Play :size="16" /></span>
                </span>
                <span v-else class="file-type-icon"><component :is="fileIcon(file.mime)" :size="22" /></span>

                <div class="file-detail">
                  <span class="file-name">{{ file.name }}</span>
                  <span class="file-size">{{ formatSize(file.size) }}</span>

                  <div v-if="dl(file.fileId).status === 'downloading'" class="dl-line">
                    <div class="progress-bar dl-bar"><div class="progress-fill" :style="{ width: Math.round(dl(file.fileId).progress * 100) + '%' }"></div></div>
                    <span class="dl-pct">{{ Math.round(dl(file.fileId).progress * 100) }}%</span>
                  </div>
                  <span v-else-if="dl(file.fileId).status === 'done'" class="dl-tag done"><Check :size="12" /> 已下载</span>
                  <span v-else-if="dl(file.fileId).status === 'error'" class="dl-tag error">下载失败</span>
                </div>

                <div class="file-actions" v-if="canPreview(transfer)">
                  <!-- 视频内联播放 -->
                  <button
                    v-if="isVideo(file.mime)"
                    class="icon-btn" :aria-label="playingVideos.has(file.fileId) ? '收起' : '播放'"
                    :title="playingVideos.has(file.fileId) ? '收起' : '播放'"
                    @click="toggleVideo(file.fileId)"
                  ><component :is="playingVideos.has(file.fileId) ? X : Play" :size="17" /></button>

                  <button
                    v-if="dl(file.fileId).status === 'done' && dl(file.fileId).savePath"
                    class="icon-btn" title="在文件夹中显示" aria-label="在文件夹中显示"
                    @click="reveal(dl(file.fileId).savePath)"
                  ><FolderOpen :size="17" /></button>

                  <button
                    v-if="dl(file.fileId).status === 'idle' || dl(file.fileId).status === 'error'"
                    class="btn btn-primary btn-sm"
                    @click="downloadFile(transfer.transferId, file.fileId, file.name)"
                  ><Download :size="15" /> 下载</button>

                  <button v-else-if="dl(file.fileId).status === 'downloading'" class="btn btn-secondary btn-sm" disabled>下载中</button>

                  <button
                    v-else-if="dl(file.fileId).status === 'done' && !dl(file.fileId).savePath"
                    class="btn btn-secondary btn-sm"
                    @click="downloadFile(transfer.transferId, file.fileId, file.name)"
                  >重下</button>
                </div>
              </div>

              <!-- 内联视频播放器 -->
              <video
                v-if="isVideo(file.mime) && playingVideos.has(file.fileId)"
                class="inline-video"
                controls
                playsinline
                preload="metadata"
                :src="streamUrl(transfer.transferId, file.fileId)"
              ></video>
            </div>
          </div>

          <!-- 批量下载 -->
          <div
            v-if="(transfer.status === 'ready' || transfer.status === 'completed') && transfer.files.length > 1"
            class="zip-row"
          >
            <button
              v-if="dl(zipKey(transfer.transferId)).status !== 'downloading'"
              class="btn btn-secondary" style="flex:1;"
              @click="downloadAll(transfer.transferId)"
            ><Package :size="16" /> 下载全部 (ZIP)</button>
            <template v-else>
              <div class="progress-bar dl-bar" style="flex:1;"><div class="progress-fill" :style="{ width: Math.round(dl(zipKey(transfer.transferId)).progress * 100) + '%' }"></div></div>
              <span class="dl-pct">{{ Math.round(dl(zipKey(transfer.transferId)).progress * 100) }}%</span>
            </template>
            <button
              v-if="dl(zipKey(transfer.transferId)).status === 'done' && dl(zipKey(transfer.transferId)).savePath"
              class="icon-btn" title="在文件夹中显示" aria-label="在文件夹中显示"
              @click="reveal(dl(zipKey(transfer.transferId)).savePath)"
            ><FolderOpen :size="17" /></button>
          </div>
        </div>
      </transition-group>
    </section>

    <!-- 发出的传输 -->
    <section v-if="outgoingTransfers.length > 0" style="margin-top: 24px;">
      <h3 class="section-title">发出的文件</h3>
      <transition-group name="list" tag="div">
        <div v-for="transfer in outgoingTransfers" :key="transfer.transferId" class="card transfer-card">
          <div class="transfer-header">
            <span class="transfer-status" :style="{ color: statusInfo(transfer).color }">
              <component :is="statusInfo(transfer).icon" :size="14" :class="{ spin: statusInfo(transfer).spin }" />
              {{ statusInfo(transfer).text }}
            </span>
            <span class="transfer-meta">
              <span v-if="transfer.peerName" class="peer">→ {{ transfer.peerName }}</span>
              {{ formatSize(transfer.totalBytes) }}
            </span>
          </div>

          <div v-if="transfer.status === 'uploading'" class="recv-progress">
            <div class="progress-bar"><div class="progress-fill" :style="{ width: progressPercent(transfer) + '%' }"></div></div>
            <div class="meta-line">
              <span>{{ progressPercent(transfer) }}%</span>
              <span class="muted">{{ formatSpeed(transfer.speed) }}<template v-if="formatEta(transfer.etaSec)"> · 剩余 {{ formatEta(transfer.etaSec) }}</template></span>
            </div>
          </div>

          <div class="transfer-files-summary">{{ transfer.files.map(f => f.name).join(', ') }}</div>
          <div class="time-line">{{ formatTime(transfer.createdAt) }}</div>
        </div>
      </transition-group>
    </section>

    <!-- 图片大图浏览 -->
    <transition name="modal">
      <div v-if="lightbox" class="lightbox" @click="closeLightbox">
        <img :src="lightbox.url" :alt="lightbox.name" class="lightbox-img" />
        <button class="lightbox-close" aria-label="关闭" @click="closeLightbox"><X :size="22" /></button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.inbox-page { max-width: 700px; margin: 0 auto; }
.inbox-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.text-btn {
  display: inline-flex; align-items: center; gap: 5px; background: none; border: none;
  color: var(--color-text-secondary); cursor: pointer; font-size: 0.82rem; padding: 6px 8px; border-radius: 6px;
}
.text-btn:hover { background: var(--color-bg); color: var(--color-danger); }

.section-title { font-size: 1rem; font-weight: 600; margin-bottom: 12px; color: var(--color-text-secondary); }
.transfer-card { margin-bottom: 12px; }
.transfer-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.transfer-status { display: inline-flex; align-items: center; gap: 5px; font-size: 0.85rem; font-weight: 600; }
.transfer-meta { font-size: 0.8rem; color: var(--color-text-secondary); display: flex; align-items: center; gap: 8px; }
.peer { background: var(--color-bg); padding: 2px 8px; border-radius: 999px; }

.confirm-row { display: flex; gap: 10px; margin: 8px 0; }
.confirm-row .btn { flex: 1; }

.recv-progress { margin: 8px 0; }
.meta-line { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 4px; }
.muted { color: var(--color-text-secondary); }

.transfer-files { display: flex; flex-direction: column; gap: 8px; }
.transfer-file { display: flex; flex-direction: column; gap: 8px; }
.inline-video {
  width: 100%; max-height: 60vh; border-radius: var(--radius-sm);
  background: #000; display: block;
}

.text-block { background: var(--color-bg); border-radius: var(--radius-sm); padding: 10px; }
.text-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.text-label { display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; color: var(--color-text-secondary); }
.text-content {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-size: 0.85rem; max-height: 200px; overflow: auto;
  font-family: ui-monospace, Menlo, monospace; color: var(--color-text);
}.transfer-file-item { display: flex; align-items: center; gap: 10px; padding: 8px; background: var(--color-bg); border-radius: var(--radius-sm); }
.file-preview { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
.file-preview.clickable { cursor: zoom-in; }
.video-thumb {
  position: relative; width: 48px; height: 48px; flex-shrink: 0;
  border-radius: 6px; overflow: hidden; cursor: pointer; display: block;
}
.video-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.video-thumb-play {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.3); color: #fff;
}
.file-type-icon { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--color-text-secondary); }
.file-detail { flex: 1; min-width: 0; }
.file-name { font-size: 0.85rem; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 0.75rem; color: var(--color-text-secondary); }
.dl-line { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.dl-bar { height: 6px; }
.dl-pct { font-size: 0.72rem; color: var(--color-text-secondary); flex-shrink: 0; min-width: 34px; text-align: right; }
.dl-tag { display: inline-flex; align-items: center; gap: 3px; font-size: 0.72rem; margin-top: 4px; }
.dl-tag.done { color: var(--color-success); }
.dl-tag.error { color: var(--color-danger); }

.file-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.icon-btn {
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--color-text);
}
.icon-btn:hover { background: var(--color-border); }
.btn-sm { padding: 6px 12px; font-size: 0.8rem; min-height: 36px; }

.zip-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.transfer-files-summary { font-size: 0.85rem; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.time-line { font-size: 0.72rem; color: var(--color-text-secondary); margin-top: 6px; }

.empty-icon { color: var(--color-text-secondary); margin-bottom: 12px; }
.empty-sub { font-size: 0.85rem; margin-top: 8px; color: var(--color-text-secondary); }

.list-enter-active, .list-leave-active { transition: all 0.25s ease; }
.list-enter-from { opacity: 0; transform: translateY(-8px); }
.list-leave-to { opacity: 0; transform: scale(0.97); }

/* 图片大图浏览 */
.lightbox {
  position: fixed; inset: 0; z-index: 2300;
  background: rgba(0, 0, 0, 0.85);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.lightbox-img {
  max-width: 100%; max-height: 100%;
  object-fit: contain; border-radius: 6px;
}
.lightbox-close {
  position: absolute; top: 16px; right: 16px;
  width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
  background: rgba(255,255,255,0.15); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.lightbox-close:hover { background: rgba(255,255,255,0.3); }
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
