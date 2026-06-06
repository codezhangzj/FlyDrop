<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDevicesStore } from '../stores/devices'
import { useTransfersStore, type FileMeta } from '../stores/transfers'
import { wsClient } from '../services/ws'
import { uploadFile, calcChunks } from '../services/upload'
import { uuidv4 } from '../services/uuid'
import { useToast } from '../composables/useToast'
import { formatSize, formatSpeed, formatEta } from '../services/format'
import { takePendingFiles } from '../services/pendingFiles'
import {
  ArrowLeft, FolderOpen, FileText, Image as ImageIcon, X,
  Files, Type, Send, Loader, Film,
} from 'lucide-vue-next'

const props = defineProps<{ deviceId: string }>()
const router = useRouter()
const devicesStore = useDevicesStore()
const transfersStore = useTransfersStore()
const toast = useToast()

const targetDevice = computed(() =>
  devicesStore.devices.find(d => d.deviceId === props.deviceId)
)

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
})

onUnmounted(() => {
  window.removeEventListener('focus', onWindowFocus)
  if (prepareSafetyTimer) clearTimeout(prepareSafetyTimer)
  previews.value.forEach(u => { if (u) URL.revokeObjectURL(u) })
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
    wsClient.send({
      type: 'transfer:offer',
      payload: { toDeviceId: props.deviceId, files: fileMetas },
    })

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
      peerName: targetDevice.value?.displayName, status: 'pending',
    })

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
    router.push('/inbox')
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
    <div class="send-head">
      <button class="icon-btn" aria-label="返回设备列表" @click="router.push('/devices')" title="返回">
        <ArrowLeft :size="18" />
      </button>
      <h2 class="page-title" style="margin:0;">
        发送到
        <span v-if="targetDevice" class="target">{{ targetDevice.displayName }}</span>
      </h2>
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
  </div>
</template>

<style scoped>
.send-page { max-width: 600px; margin: 0 auto; outline: none; }

.send-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.target { color: var(--color-primary); font-weight: 600; }

.icon-btn {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--color-text);
}
.icon-btn:hover { background: var(--color-bg); }

.seg {
  display: flex;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 4px;
  gap: 4px;
  margin-bottom: 16px;
}
.seg-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px; border: none; background: transparent;
  border-radius: 6px; cursor: pointer; font-size: 0.9rem;
  color: var(--color-text-secondary); min-height: 40px;
}
.seg-btn.active { background: var(--color-surface); color: var(--color-primary); box-shadow: var(--shadow); }

.drop-zone {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 36px 20px;
  text-align: center;
  transition: all 0.2s;
  display: flex; flex-direction: column; align-items: center;
}
.drop-zone.dragging { border-color: var(--color-primary); background: rgba(79,70,229,0.05); }
.drop-icon { color: var(--color-text-secondary); margin-bottom: 8px; }
.hint { font-size: 0.8rem; color: var(--color-text-secondary); }

.text-area {
  width: 100%;
  min-height: 160px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 0.95rem;
  resize: vertical;
  font-family: inherit;
}

.file-list { margin-top: 16px; }
.file-list-header { font-size: 0.85rem; color: var(--color-text-secondary); margin-bottom: 8px; }
.file-list-scroll { max-height: 320px; overflow-y: auto; }
.file-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; background: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--radius-sm); margin-bottom: 6px;
}
.file-thumb {
  width: 44px; height: 44px; border-radius: 8px; flex-shrink: 0;
  object-fit: cover; background: var(--color-bg);
}
.file-thumb-icon {
  display: flex; align-items: center; justify-content: center; color: var(--color-text-secondary);
}
.file-info { flex: 1; min-width: 0; }
.file-name { font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-size { font-size: 0.75rem; color: var(--color-text-secondary); }
.x-btn {
  background: none; border: none; cursor: pointer; color: var(--color-text-secondary);
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
}
.x-btn:hover { background: var(--color-danger); color: white; }

.progress-section { margin-top: 16px; }
.phase-text { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; color: var(--color-text-secondary); }
.progress-meta { display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 6px; color: var(--color-text-secondary); }
.muted { color: var(--color-text-secondary); }

.btn-send-main { width: 100%; margin-top: 16px; padding: 14px; font-size: 1rem; }
.cancel-btn { width: 100%; margin-top: 12px; }

.prepare-overlay {
  position: fixed; inset: 0; z-index: 2200;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.prepare-box {
  background: var(--color-surface);
  border-radius: var(--radius);
  padding: 28px 32px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  box-shadow: var(--shadow-lg);
  color: var(--color-text);
  text-align: center;
}
.prepare-box .spin { color: var(--color-primary); }
.prepare-hint { font-size: 0.8rem; color: var(--color-text-secondary); max-width: 240px; }
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
