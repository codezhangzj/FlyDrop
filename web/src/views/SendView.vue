<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDevicesStore } from '../stores/devices'
import { useGroupsStore } from '../stores/groups'
import { useTransfersStore, type FileMeta, type TransferItem } from '../stores/transfers'
import { wsClient } from '../services/ws'
import { uploadFile, calcChunks } from '../services/upload'
import { uuidv4 } from '../services/uuid'
import { useToast } from '../composables/useToast'
import { formatSize, formatSpeed, formatEta } from '../services/format'
import { takePendingFiles } from '../services/pendingFiles'
import { useDownload } from '../composables/useDownload'
import {
  ArrowLeft, FolderOpen, FileText, Image as ImageIcon, X,
  Files, Type, Send, Loader, Film, Download, Check, Copy
} from 'lucide-vue-next'

const props = defineProps<{ targetId: string }>()
const router = useRouter()
const devicesStore = useDevicesStore()
const groupsStore = useGroupsStore()
const transfersStore = useTransfersStore()
const toast = useToast()

const targetDevice = computed(() =>
  devicesStore.devices.find(d => d.deviceId === props.targetId)
)
const targetGroup = computed(() =>
  groupsStore.groups.find(g => g.groupId === props.targetId)
)
const displayName = computed(() => targetDevice.value?.displayName || targetGroup.value?.name || '未知')

const { dl, downloadFile, reveal, desktop } = useDownload()

// 针对群组的聊天记录
const groupTransfers = computed(() => {
  if (!targetGroup.value) return []
  return transfersStore.transfers
    .filter(t => t.groupId === props.targetId)
    .sort((a, b) => a.createdAt - b.createdAt)
})
const chatScroll = ref<HTMLElement | null>(null)

// 自动滚动到底部
function scrollToBottom() {
  if (chatScroll.value) {
    chatScroll.value.scrollTop = chatScroll.value.scrollHeight
  }
}

// 监听群聊消息变化 → 自动滚动到底部（替代旧的空轮询）
watch(
  () => groupTransfers.value.length,
  () => { if (targetGroup.value) nextTick(scrollToBottom) }
)
// 监听进行中消息的进度变化，保持视图贴底
watch(
  () => groupTransfers.value.map(t => t.status).join(','),
  () => { if (targetGroup.value) nextTick(scrollToBottom) }
)

// 我的设备 ID（用于预览/流式鉴权）
const myDeviceId = computed(() => devicesStore.myDevice?.deviceId ?? '')
function previewUrl(transferId: string, fileId: string) {
  return `/api/preview/${transferId}/${fileId}?deviceId=${encodeURIComponent(myDeviceId.value)}`
}
function streamUrl(transferId: string, fileId: string) {
  return `/api/stream/${transferId}/${fileId}?deviceId=${encodeURIComponent(myDeviceId.value)}`
}
function isImage(mime: string) { return mime.startsWith('image/') }
function canPreview(t: TransferItem) {
  return t.status === 'ready' || t.status === 'completed'
}

// 文本消息内联展示
function isTextTransfer(t: TransferItem) {
  if (t.files.length !== 1) return false
  const f = t.files[0]
  return (f.mime.startsWith('text/') || f.name.toLowerCase().endsWith('.txt')) && f.size <= 64 * 1024
}
const textCache = ref<Record<string, string>>({})
async function ensureText(t: TransferItem) {
  if (textCache.value[t.transferId] != null) return
  if (!canPreview(t)) return
  try {
    const res = await fetch(streamUrl(t.transferId, t.files[0].fileId))
    if (res.ok) textCache.value = { ...textCache.value, [t.transferId]: await res.text() }
  } catch {}
}
async function copyText(t: TransferItem) {
  const text = textCache.value[t.transferId] ?? ''
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }
    toast.success('已复制文本')
  } catch { toast.error('复制失败') }
}

// 图片大图浏览
const lightbox = ref<{ url: string; name: string } | null>(null)
function openImage(transferId: string, fileId: string, name: string) {
  lightbox.value = { url: streamUrl(transferId, fileId), name }
}
function closeLightbox() { lightbox.value = null }

// 群聊消息变化时，预取文本内容
watch(groupTransfers, (list) => {
  list.forEach(t => { if (isTextTransfer(t)) ensureText(t) })
}, { immediate: true, deep: true })

// 进入/离开群聊：标记已读 / 清理当前群
watch(() => targetGroup.value?.groupId, (gid) => {
  groupsStore.setActiveGroup(gid ?? null)
}, { immediate: true })

const tab = ref<'file' | 'text'>('file')
const textContent = ref('')

const selectedFiles = ref<File[]>([])
const previews = ref<string[]>([]) // 与 selectedFiles 对齐：图片为缩略图 objectURL，否则为 ''
const isDragging = ref(false)
const isSending = ref(false)
const phase = ref<'idle' | 'waiting' | 'uploading'>('idle')
const uploadProgress = ref(0)
const speed = ref(0)
const etaSec = ref(0)
const totalSize = computed(() => selectedFiles.value.reduce((s, f) => s + f.size, 0))

// 取消控制
let abortController: AbortController | null = null
const currentTransferId = ref<string | null>(null)
let canceled = false

// 选择文件「正在读取」提示（覆盖系统选择器关闭后、文件导出/读取的空窗）
const preparingFiles = ref(false)
let expectingPick = false
let pickChanged = false
let prepareSafetyTimer: ReturnType<typeof setTimeout> | null = null

function onWindowFocus() {
  if (!expectingPick) return
  // 选择器已关闭。给 change 事件一点时间；若文件仍未就绪，则显示读取提示
  setTimeout(() => {
    if (expectingPick && !pickChanged) {
      preparingFiles.value = true
      if (prepareSafetyTimer) clearTimeout(prepareSafetyTimer)
      // 兜底：超长时间无结果自动收起，避免卡住提示
      prepareSafetyTimer = setTimeout(() => {
        preparingFiles.value = false
        expectingPick = false
      }, 120_000)
    }
  }, 300)
}

function clearPreparing() {
  preparingFiles.value = false
  expectingPick = false
  pickChanged = false
  if (prepareSafetyTimer) { clearTimeout(prepareSafetyTimer); prepareSafetyTimer = null }
}

// 拖拽带入的文件（从设备卡片拖放跳转而来）
onMounted(() => {
  window.addEventListener('focus', onWindowFocus)
  const pf = takePendingFiles()
  if (pf.length > 0) {
    addFiles(pf)
    toast.info(`已带入 ${pf.length} 个文件`)
  }
  if (targetGroup.value) nextTick(scrollToBottom)
})

onUnmounted(() => {
  window.removeEventListener('focus', onWindowFocus)
  if (prepareSafetyTimer) clearTimeout(prepareSafetyTimer)
  previews.value.forEach(u => { if (u) URL.revokeObjectURL(u) })
  // 离开群聊页：清除「正在查看」标记
  groupsStore.setActiveGroup(null)
})

// 点击「选择文件」：进入等待选择状态
function onPickStart() {
  expectingPick = true
  pickChanged = false
}

// 系统选择器取消（现代浏览器支持 cancel 事件）
function onPickCancel() {
  clearPreparing()
}

function onFileSelect(e: Event) {
  pickChanged = true
  const input = e.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    addFiles(Array.from(input.files))
  }
  clearPreparing()
  // 重置以便再次选择同一文件也能触发 change
  input.value = ''
}
function addFiles(files: File[]) {
  for (const f of files) {
    selectedFiles.value.push(f)
    previews.value.push(f.type.startsWith('image/') ? URL.createObjectURL(f) : '')
  }
}
function removeFile(index: number) {
  const url = previews.value[index]
  if (url) URL.revokeObjectURL(url)
  selectedFiles.value.splice(index, 1)
  previews.value.splice(index, 1)
}
function clearSelected() {
  previews.value.forEach(u => { if (u) URL.revokeObjectURL(u) })
  selectedFiles.value = []
  previews.value = []
}

function onDragOver(e: DragEvent) { e.preventDefault(); isDragging.value = true }
function onDragLeave() { isDragging.value = false }
function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  if (e.dataTransfer?.files) addFiles(Array.from(e.dataTransfer.files))
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile()
      if (blob) {
        const file = new File([blob], `screenshot-${Date.now()}.png`, { type: blob.type })
        addFiles([file])
        toast.info('已粘贴截图')
      }
    }
  }
}

// 等待指定类型的 WS 消息
function waitMessage(predicate: (m: any) => boolean, timeoutMs = 30_000): Promise<any | null> {
  return new Promise((resolve) => {
    const unsub = wsClient.on((m) => {
      if (predicate(m)) { unsub(); resolve(m) }
    })
    setTimeout(() => { unsub(); resolve(null) }, timeoutMs)
  })
}

async function send() {
  if (isSending.value) return

  // 准备待发送文件
  let files: File[] = []
  if (tab.value === 'text') {
    const text = textContent.value.trim()
    if (!text) { toast.warning('请输入要发送的文本'); return }
    files = [new File([text], `文本-${Date.now()}.txt`, { type: 'text/plain' })]
  } else {
    if (selectedFiles.value.length === 0) { toast.warning('请先选择文件'); return }
    files = selectedFiles.value
  }

  isSending.value = true
  phase.value = 'waiting'
  uploadProgress.value = 0
  speed.value = 0
  etaSec.value = 0
  canceled = false
  currentTransferId.value = null
  abortController = new AbortController()

  try {
    const metaList = files.map(f => {
      const { totalChunks, chunkSize } = calcChunks(f)
      return {
        meta: {
          fileId: uuidv4(),
          name: f.name,
          size: f.size,
          mime: f.type || 'application/octet-stream',
          totalChunks,
          chunkSize,
        } as FileMeta,
        localFile: f,
      }
    })
    const fileMetas = metaList.map(m => m.meta)
    const total = files.reduce((s, f) => s + f.size, 0)

    // 发送 offer
    if (targetGroup.value) {
      wsClient.send({
        type: 'transfer:offer',
        payload: { groupId: props.targetId, files: fileMetas },
      })
    } else {
      wsClient.send({
        type: 'transfer:offer',
        payload: { toDeviceId: props.targetId, files: fileMetas },
      })
    }

    // 等待服务端创建任务，拿到 transferId
    const created = await waitMessage(m => m.type === 'transfer:created' && m.payload?.transferId, 10_000)
    if (!created) {
      toast.error('创建传输失败，目标设备可能已离线')
      return
    }
    const transferId: string = created.payload.transferId
    currentTransferId.value = transferId
    if (canceled) return

    transfersStore.addOutgoing({
      transferId, files: fileMetas, totalBytes: total,
      peerName: displayName.value, status: 'pending',
      groupId: targetGroup.value ? props.targetId : undefined,
      groupName: targetGroup.value ? targetGroup.value.name : undefined,
    })

    if (targetGroup.value) nextTick(scrollToBottom)

    // 等待对方接受或拒绝
    const decision = await waitMessage(
      m => (m.type === 'transfer:accept' || m.type === 'transfer:reject') && m.payload?.transferId === transferId,
      60_000
    )
    if (canceled) return
    if (!decision) {
      toast.warning('对方未响应')
      transfersStore.onError({ transferId, error: 'timeout' })
      return
    }
    if (decision.type === 'transfer:reject') {
      toast.info('对方拒绝了传输')
      transfersStore.onReject(transferId)
      return
    }

    // 已接受 → 上传
    phase.value = 'uploading'
    transfersStore.setStatus(transferId, 'uploading')

    let totalUploaded = 0
    let lastTs = Date.now()
    let lastBytes = 0
    for (const { meta, localFile } of metaList) {
      await uploadFile({
        file: localFile,
        transferId,
        fileId: meta.fileId,
        deviceId: myDeviceId.value,
        signal: abortController.signal,
        onProgress: (uploaded) => {
          const overall = totalUploaded + uploaded
          uploadProgress.value = total > 0 ? overall / total : 0
          transfersStore.setLocalProgress(transferId, overall)
          const now = Date.now()
          const dt = (now - lastTs) / 1000
          if (dt >= 0.4) {
            const inst = (overall - lastBytes) / dt
            speed.value = Math.max(0, inst)
            etaSec.value = inst > 0 ? (total - overall) / inst : 0
            lastTs = now
            lastBytes = overall
          }
        },
      })
      totalUploaded += localFile.size
    }

    uploadProgress.value = 1
    toast.success('发送完成')
    clearSelected()
    textContent.value = ''
    if (!targetGroup.value) {
      router.push('/inbox')
    } else {
      nextTick(scrollToBottom)
    }
  } catch (e) {
    if (canceled || (e instanceof Error && e.message === 'aborted')) {
      toast.info('已取消发送')
    } else {
      console.error('发送失败:', e)
      toast.error('发送失败：' + (e instanceof Error ? e.message : String(e)))
    }
  } finally {
    isSending.value = false
    phase.value = 'idle'
    abortController = null
  }
}

// 取消当前发送
function cancel() {
  canceled = true
  abortController?.abort()
  if (currentTransferId.value) {
    wsClient.send({ type: 'transfer:cancel', payload: { transferId: currentTransferId.value } })
    transfersStore.onCancel(currentTransferId.value)
  }
  isSending.value = false
  phase.value = 'idle'
}

function fileIcon(type: string) {
  if (type.startsWith('image/')) return ImageIcon
  if (type.startsWith('video/')) return Film
  return FileText
}
</script>

<template>
  <div class="send-page" @paste="onPaste" tabindex="0">
    <div class="send-head" :class="{ 'chat-head': targetGroup }">
      <button class="icon-btn" aria-label="返回设备列表" @click="router.push('/devices')" title="返回">
        <ArrowLeft :size="18" />
      </button>
      <h2 class="page-title" style="margin:0;">
        发送到
        <span class="target">{{ displayName }}</span>
      </h2>
    </div>

    <!-- 聊天区 (仅群组) -->
    <div v-if="targetGroup" class="chat-history" ref="chatScroll">
      <div v-if="groupTransfers.length === 0" class="chat-empty">
        <p>暂无群聊记录，开始发送文件吧！</p>
      </div>
      <div v-for="t in groupTransfers" :key="t.transferId" class="chat-msg" :class="{ me: t.direction === 'outgoing' }">
        <div class="chat-avatar">{{ t.direction === 'outgoing' ? '我' : (t.peerName || '未知') }}</div>
        <div class="chat-bubble">
          <!-- 文本消息：内联气泡展示 -->
          <div v-if="isTextTransfer(t) && canPreview(t)" class="chat-text">
            <pre class="chat-text-content">{{ textCache[t.transferId] ?? '加载中…' }}</pre>
            <button class="chat-text-copy" aria-label="复制文本" @click="copyText(t)" title="复制">
              <Copy :size="13" />
            </button>
          </div>

          <!-- 文件 / 图片消息 -->
          <div v-else class="chat-files">
            <div v-for="f in t.files" :key="f.fileId" class="chat-file">
              <img
                v-if="isImage(f.mime) && canPreview(t)"
                :src="previewUrl(t.transferId, f.fileId)"
                class="chat-thumb"
                alt="预览"
                @click="openImage(t.transferId, f.fileId, f.name)"
              />
              <component v-else :is="fileIcon(f.mime)" :size="18" class="chat-file-icon" />
              <div class="chat-file-info">
                <div class="chat-file-name">{{ f.name }}</div>
                <div class="chat-file-size">{{ formatSize(f.size) }}</div>
              </div>
              <div class="chat-file-actions" v-if="t.direction === 'incoming' && canPreview(t)">
                <template v-if="dl(f.fileId)">
                  <button v-if="dl(f.fileId)?.status === 'downloading'" class="icon-btn-small" disabled title="下载中">
                    <Loader :size="14" class="spin" />
                  </button>
                  <button v-else-if="dl(f.fileId)?.status === 'done' && desktop" class="icon-btn-small" title="打开所在文件夹" @click="reveal(dl(f.fileId)?.savePath)">
                    <FolderOpen :size="14" />
                  </button>
                  <span v-else-if="dl(f.fileId)?.status === 'done'" class="done-mark" title="已下载">
                    <Check :size="14" />
                  </span>
                  <button v-else class="icon-btn-small" title="重试下载" @click="downloadFile(t.transferId, f.fileId, f.name)">
                    <Download :size="14" />
                  </button>
                </template>
                <button v-else class="icon-btn-small" title="下载" @click="downloadFile(t.transferId, f.fileId, f.name)">
                  <Download :size="14" />
                </button>
              </div>
            </div>
          </div>
          <div v-if="t.status === 'uploading' || t.status === 'pending'" class="chat-status uploading">传输中...</div>
          <div v-else-if="t.status === 'completed' || t.status === 'ready'" class="chat-status ready">已完成</div>
        </div>
      </div>
    </div>

    <!-- 模式切换 -->
    <div class="seg">
      <button class="seg-btn" :class="{ active: tab === 'file' }" @click="tab = 'file'">
        <Files :size="16" /> 文件
      </button>
      <button class="seg-btn" :class="{ active: tab === 'text' }" @click="tab = 'text'">
        <Type :size="16" /> 文本
      </button>
    </div>

    <!-- 文件模式 -->
    <template v-if="tab === 'file'">
      <div
        class="drop-zone"
        :class="{ dragging: isDragging }"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop.stop="onDrop"
      >
        <FolderOpen :size="40" class="drop-icon" />
        <p>拖拽文件到这里，或点击选择</p>
        <p class="hint">支持 Ctrl+V 粘贴截图</p>
        <label class="btn btn-secondary" style="margin-top: 12px;">
          选择文件
          <input type="file" multiple @click="onPickStart" @change="onFileSelect" @cancel="onPickCancel" style="display: none;" />
        </label>
      </div>

      <div v-if="selectedFiles.length > 0" class="file-list">
        <div class="file-list-header">
          已选择 {{ selectedFiles.length }} 个文件（{{ formatSize(totalSize) }}）
        </div>
        <div class="file-list-scroll">
          <div v-for="(file, idx) in selectedFiles" :key="idx" class="file-item">
            <img v-if="previews[idx]" :src="previews[idx]" class="file-thumb" alt="预览" />
            <span v-else class="file-thumb file-thumb-icon">
              <component :is="fileIcon(file.type)" :size="22" />
            </span>
            <div class="file-info">
              <div class="file-name">{{ file.name }}</div>
              <div class="file-size">{{ formatSize(file.size) }}</div>
            </div>
            <button class="x-btn" aria-label="移除文件" @click="removeFile(idx)" :disabled="isSending"><X :size="16" /></button>
          </div>
        </div>
      </div>
    </template>

    <!-- 文本模式 -->
    <template v-else>
      <textarea
        v-model="textContent"
        class="text-area"
        placeholder="输入要发送的文本或链接…"
        :disabled="isSending"
      ></textarea>
    </template>

    <!-- 进度 -->
    <div v-if="isSending" class="progress-section">
      <p v-if="phase === 'waiting'" class="phase-text">
        <Loader :size="14" class="spin" /> 等待对方接受…
      </p>
      <template v-else>
        <div class="progress-meta">
          <span>上传中 {{ Math.round(uploadProgress * 100) }}%</span>
          <span class="muted">
            {{ formatSpeed(speed) }}<template v-if="formatEta(etaSec)"> · 剩余 {{ formatEta(etaSec) }}</template>
          </span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: (uploadProgress * 100) + '%' }"></div>
        </div>
      </template>
      <button class="btn btn-secondary cancel-btn" @click="cancel">
        <X :size="16" /> 取消发送
      </button>
    </div>

    <button
      v-if="!isSending"
      class="btn btn-primary btn-send-main"
      @click="send"
    >
      <Send :size="18" />
      发送
    </button>

    <!-- 读取所选文件提示（覆盖系统选择器关闭后的导出空窗） -->
    <transition name="modal">
      <div v-if="preparingFiles" class="prepare-overlay" @click="clearPreparing">
        <div class="prepare-box">
          <Loader :size="32" class="spin" />
          <p>正在读取所选文件…</p>
          <p class="prepare-hint">视频等大文件可能需要等待系统导出，请稍候</p>
        </div>
      </div>
    </transition>

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
.send-page { max-width: 700px; margin: 0 auto; display: flex; flex-direction: column; height: 100%; outline: none; }
.send-head { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-shrink: 0; }
.send-head.chat-head { margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--color-border); }
.target { color: var(--color-primary); }

.icon-btn {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--color-text);
}
.icon-btn:hover { background: var(--color-bg); }

.chat-history {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border: 1px solid var(--color-border);
}
.chat-empty { text-align: center; color: var(--color-text-secondary); font-size: 0.9rem; padding: 40px 0; }
.chat-msg { display: flex; flex-direction: column; align-items: flex-start; max-width: 85%; }
.chat-msg.me { align-self: flex-end; align-items: flex-end; }
.chat-avatar { font-size: 0.75rem; color: var(--color-text-secondary); margin-bottom: 4px; padding: 0 4px; }
.chat-bubble {
  background: var(--color-bg); padding: 10px 14px; border-radius: 12px;
  border: 1px solid var(--color-border);
}
.chat-msg.me .chat-bubble { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.chat-files { display: flex; flex-direction: column; gap: 8px; }
.chat-file { display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.1); padding: 6px 10px; border-radius: 8px; }
.chat-msg.me .chat-file { background: rgba(255,255,255,0.15); }
.chat-file-icon { flex-shrink: 0; opacity: 0.8; }
.chat-file-info { min-width: 0; }
.chat-file-name { font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
.chat-file-size { font-size: 0.7rem; opacity: 0.7; }
.chat-file-actions { margin-left: auto; display: flex; align-items: center; }
.icon-btn-small { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; padding: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--color-text); margin-left: 6px; }
.icon-btn-small:hover { background: var(--color-bg); }
.icon-btn-small:disabled { opacity: 0.6; cursor: not-allowed; }
.done-mark { color: var(--color-success); margin-left: 6px; display: flex; align-items: center; }
.chat-status { font-size: 0.75rem; margin-top: 6px; text-align: right; opacity: 0.8; }

/* 群聊图片缩略图 */
.chat-thumb {
  width: 44px; height: 44px; object-fit: cover; border-radius: 6px;
  flex-shrink: 0; cursor: zoom-in;
}
/* 群聊文本气泡 */
.chat-text { display: flex; align-items: flex-start; gap: 8px; }
.chat-text-content {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-size: 0.88rem; line-height: 1.45; font-family: inherit;
  max-height: 240px; overflow: auto; flex: 1;
}
.chat-text-copy {
  background: rgba(0,0,0,0.1); border: none; border-radius: 5px; cursor: pointer;
  width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
  color: inherit; flex-shrink: 0; opacity: 0.7;
}
.chat-text-copy:hover { opacity: 1; }
.chat-msg.me .chat-text-copy { background: rgba(255,255,255,0.2); }

/* 图片大图浏览 */
.lightbox {
  position: fixed; inset: 0; z-index: 2300; background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.lightbox-img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; }
.lightbox-close {
  position: absolute; top: 16px; right: 16px;
  width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
  background: rgba(255,255,255,0.15); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.lightbox-close:hover { background: rgba(255,255,255,0.3); }

.seg { display: flex; background: var(--color-bg); padding: 4px; border-radius: 8px; width: max-content; margin-bottom: 16px; flex-shrink: 0; }
.seg-btn {
  background: none; border: none; padding: 6px 16px; border-radius: 6px;
  font-size: 0.85rem; font-weight: 500; color: var(--color-text-secondary);
  cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s ease;
}
.seg-btn.active { background: var(--color-surface); color: var(--color-text); box-shadow: 0 1px 3px rgba(0,0,0,0.05); }

.drop-zone {
  flex: 1; border: 2px dashed var(--color-border); border-radius: var(--radius-md);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: var(--color-surface); transition: all 0.2s ease; margin-bottom: 16px; min-height: 200px;
}
.drop-zone.dragging { border-color: var(--color-primary); background: var(--color-bg); transform: scale(1.02); }
.drop-icon { color: var(--color-text-secondary); margin-bottom: 12px; opacity: 0.5; }
.drop-zone p { margin: 0; color: var(--color-text-secondary); font-size: 0.95rem; }
.drop-zone .hint { font-size: 0.8rem; opacity: 0.7; margin-top: 4px; }

.file-list { margin-bottom: 16px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; flex-shrink: 0; }
.file-list-header { background: var(--color-bg); padding: 8px 12px; font-size: 0.8rem; color: var(--color-text-secondary); font-weight: 600; border-bottom: 1px solid var(--color-border); }
.file-list-scroll { max-height: 200px; overflow-y: auto; }
.file-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--color-border); }
.file-item:last-child { border-bottom: none; }
.file-thumb { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
.file-thumb-icon { display: flex; align-items: center; justify-content: center; background: var(--color-bg); color: var(--color-text-secondary); }
.file-info { flex: 1; min-width: 0; }
.file-name { font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text); }
.file-size { font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 2px; }
.x-btn { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
.x-btn:hover:not(:disabled) { background: var(--color-danger); color: #fff; }
.x-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.text-area {
  flex: 1; width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-md);
  padding: 12px; font-size: 0.95rem; background: var(--color-surface); color: var(--color-text);
  resize: none; outline: none; transition: border-color 0.2s ease; margin-bottom: 16px;
  font-family: inherit; line-height: 1.5; min-height: 200px;
}
.text-area:focus { border-color: var(--color-primary); }
.text-area:disabled { opacity: 0.7; cursor: not-allowed; }

.btn-send-main { width: 100%; padding: 12px; font-size: 1rem; border-radius: var(--radius-md); font-weight: 600; flex-shrink: 0; }

.progress-section { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 16px; text-align: center; margin-bottom: 16px; flex-shrink: 0; }
.phase-text { margin: 0; font-size: 0.9rem; color: var(--color-text-secondary); display: flex; align-items: center; justify-content: center; gap: 8px; }
.progress-meta { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 8px; color: var(--color-text); font-weight: 500; }
.progress-meta .muted { color: var(--color-text-secondary); font-weight: normal; }
.cancel-btn { margin-top: 16px; width: 100%; }

.prepare-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.prepare-box { background: var(--color-surface); padding: 24px; border-radius: var(--radius-md); text-align: center; width: 280px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
.prepare-box p { margin: 12px 0 0 0; font-weight: 600; font-size: 0.95rem; }
.prepare-hint { font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 8px !important; font-weight: 400 !important; }

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
