<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useDevicesStore } from '../stores/devices'
import { useGroupsStore } from '../stores/groups'
import { useRouter } from 'vue-router'
import { isDesktop, getServerInfo, type ServerInfo } from '../services/desktop'
import { wsClient } from '../services/ws'
import { useToast } from '../composables/useToast'
import { setPendingFiles, pendingCount, clearPendingFiles } from '../services/pendingFiles'
import {
  Smartphone, Tablet, Monitor, HardDrive,
  Send, Pencil, Check, Copy, RadioTower, X,
  Users, Plus,
} from 'lucide-vue-next'

const devicesStore = useDevicesStore()
const groupsStore = useGroupsStore()
const router = useRouter()
const toast = useToast()

const desktop = isDesktop()
const serverInfo = ref<ServerInfo | null>(null)
const copied = ref(false)
const dragOverId = ref<string | null>(null)

const editingName = ref(false)
const nameInput = ref('')

onMounted(async () => {
  if (desktop) serverInfo.value = await getServerInfo()
})

function deviceIcon(type: string) {
  switch (type) {
    case 'mobile': return Smartphone
    case 'tablet': return Tablet
    case 'desktop': return Monitor
    default: return HardDrive
  }
}

function sendTo(deviceId: string) {
  router.push(`/send/${deviceId}`)
}

function createGroup() {
  const name = prompt('请输入群聊名称', '局域网群聊')
  if (name !== null) {
    wsClient.send({ type: 'group:create', payload: { name: name || '局域网群聊' } })
    toast.success('已发送创建群聊请求')
  }
}

// 拖文件到设备卡片直接发送
function onCardDragOver(e: DragEvent, deviceId: string) {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
    dragOverId.value = deviceId
  }
}
function onCardDragLeave(deviceId: string) {
  if (dragOverId.value === deviceId) dragOverId.value = null
}
function onCardDrop(e: DragEvent, deviceId: string) {
  e.preventDefault()
  dragOverId.value = null
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    setPendingFiles(Array.from(files))
    router.push(`/send/${deviceId}`)
  }
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    toast.success('地址已复制')
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    toast.error('复制失败')
  }
}

function startEdit() {
  nameInput.value = devicesStore.myFullDevice?.displayName ?? ''
  editingName.value = true
}
function saveName() {
  const name = nameInput.value.trim()
  if (name) {
    wsClient.send({ type: 'device:rename', payload: { displayName: name } })
    toast.success('设备名已更新')
  }
  editingName.value = false
}
</script>

<template>
  <div class="devices-page">
    <!-- 待发送横幅（来自全局拖拽） -->
    <div v-if="pendingCount > 0" class="pending-banner">
      <Send :size="16" />
      <span>{{ pendingCount }} 个文件待发送，点击下方设备即可发送</span>
      <button class="pending-cancel" aria-label="取消" @click="clearPendingFiles()"><X :size="15" /></button>
    </div>

    <!-- 桌面端连接面板 -->
    <div v-if="desktop && serverInfo && serverInfo.urls.length > 0" class="card connect-panel">
      <div class="connect-qr" v-if="serverInfo.qrDataUrl">
        <img :src="serverInfo.qrDataUrl" alt="访问二维码" />
      </div>
      <div class="connect-info">
        <h3>让手机 / 平板连入</h3>
        <p class="connect-hint">确保设备连接同一 Wi-Fi，扫码或在浏览器打开：</p>
        <div
          v-for="url in serverInfo.urls"
          :key="url"
          class="connect-url"
          @click="copyUrl(url)"
          title="点击复制"
        >
          <span class="url-text">{{ url }}</span>
          <span class="copy-tag">
            <Check v-if="copied" :size="13" />
            <Copy v-else :size="13" />
            {{ copied ? '已复制' : '复制' }}
          </span>
        </div>
      </div>
    </div>

    <h2 class="page-title">在线设备</h2>

    <div v-if="devicesStore.otherDevices.length === 0" class="empty-state">
      <RadioTower :size="48" class="empty-icon pulse" />
      <p>等待设备连入…</p>
      <p class="empty-sub">在其他设备的浏览器中输入主机的局域网地址即可连入</p>
    </div>

    <div v-else class="devices-grid">
      <div
        v-for="device in devicesStore.otherDevices"
        :key="device.deviceId"
        class="card device-card"
        :class="{ 'drag-over': dragOverId === device.deviceId }"
        role="button"
        tabindex="0"
        :aria-label="`发送文件到 ${device.displayName}`"
        @click="sendTo(device.deviceId)"
        @keydown.enter="sendTo(device.deviceId)"
        @keydown.space.prevent="sendTo(device.deviceId)"
        @dragover="onCardDragOver($event, device.deviceId)"
        @dragleave="onCardDragLeave(device.deviceId)"
        @drop.stop="onCardDrop($event, device.deviceId)"
      >
        <div class="device-icon">
          <component :is="deviceIcon(device.deviceType)" :size="24" />
        </div>
        <div class="device-info">
          <div class="device-name">{{ device.displayName }}</div>
          <div class="device-meta">{{ device.os }} · {{ device.browser }}</div>
        </div>
        <Send :size="18" class="send-hint" />
        <div v-if="dragOverId === device.deviceId" class="drop-tip">松开即发送</div>
      </div>
    </div>

    <!-- 群聊列表 -->
    <div class="section-header">
      <h2 class="page-title">局域网大厅</h2>
    </div>

    <div v-if="groupsStore.groups.length === 0" class="empty-state" style="padding: 30px 0;">
      <Users :size="40" class="empty-icon" style="opacity: 0.5" />
      <p style="margin-top: 8px;">暂无群聊</p>
    </div>

    <div v-else class="devices-grid">
      <div
        v-for="group in groupsStore.groups"
        :key="group.groupId"
        class="card device-card"
        :class="{ 'drag-over': dragOverId === group.groupId }"
        role="button"
        tabindex="0"
        :aria-label="`发送到群聊 ${group.name}`"
        @click="sendTo(group.groupId)"
        @keydown.enter="sendTo(group.groupId)"
        @keydown.space.prevent="sendTo(group.groupId)"
        @dragover="onCardDragOver($event, group.groupId)"
        @dragleave="onCardDragLeave(group.groupId)"
        @drop.stop="onCardDrop($event, group.groupId)"
      >
        <div class="device-icon">
          <Users :size="24" />
        </div>
        <div class="device-info">
          <div class="device-name">{{ group.name }}</div>
          <div class="device-meta">创建者: {{ group.ownerName || '未知' }}</div>
        </div>
        <Send :size="18" class="send-hint" />
        <div v-if="dragOverId === group.groupId" class="drop-tip">松开即发送</div>
      </div>
    </div>

    <!-- 我的设备 -->
    <div class="connection-info card" v-if="devicesStore.myFullDevice">
      <div class="me-row">
        <component :is="deviceIcon(devicesStore.myFullDevice.deviceType)" :size="18" class="me-icon" />
        <template v-if="!editingName">
          <span class="me-name">{{ devicesStore.myFullDevice.displayName }}</span>
          <span class="me-tag">本机</span>
          <button class="edit-btn" aria-label="重命名设备" @click="startEdit" title="重命名"><Pencil :size="15" /></button>
        </template>
        <template v-else>
          <input
            v-model="nameInput"
            class="name-input"
            maxlength="32"
            aria-label="设备名称"
            @keyup.enter="saveName"
            @blur="saveName"
            autofocus
          />
          <button class="edit-btn" aria-label="保存设备名" @click="saveName"><Check :size="16" /></button>
        </template>
      </div>
      <p class="me-meta">{{ devicesStore.myFullDevice.os }} · {{ devicesStore.myFullDevice.browser }} · {{ devicesStore.myFullDevice.ip }}</p>
    </div>
  </div>
</template>

<style scoped>
.devices-page { max-width: 800px; margin: 0 auto; }

.pending-banner {
  display: flex; align-items: center; gap: 8px;
  background: var(--color-primary); color: #fff;
  padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 16px;
  font-size: 0.88rem;
}
.pending-banner span { flex: 1; }
.pending-cancel {
  background: rgba(255,255,255,0.2); border: none; color: #fff; cursor: pointer;
  width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
}
.pending-cancel:hover { background: rgba(255,255,255,0.35); }

.connect-panel { display: flex; gap: 16px; align-items: center; margin-bottom: 20px; }
.connect-qr img { width: 120px; height: 120px; border-radius: var(--radius-sm); display: block; }
.connect-info { flex: 1; min-width: 0; }
.connect-info h3 { font-size: 1rem; margin-bottom: 6px; }
.connect-hint { font-size: 0.82rem; color: var(--color-text-secondary); margin-bottom: 10px; }
.connect-url {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem; background: var(--color-bg); padding: 8px 12px;
  border-radius: var(--radius-sm); margin-bottom: 6px; cursor: pointer;
}
.connect-url:hover { background: var(--color-border); }
.url-text { word-break: break-all; }
.copy-tag {
  display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
  font-family: -apple-system, sans-serif; font-size: 0.7rem; color: var(--color-primary);
  background: var(--color-surface); padding: 3px 8px; border-radius: 999px;
}
@media (max-width: 480px) { .connect-panel { flex-direction: column; text-align: center; } }

.section-header { display: flex; justify-content: space-between; align-items: center; margin-top: 24px; margin-bottom: 16px; }
.section-header .page-title { margin: 0; }
.btn-sm { padding: 4px 10px; font-size: 0.85rem; height: 32px; gap: 4px; }

.devices-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.device-card {
  display: flex; align-items: center; gap: 12px; cursor: pointer;
  transition: transform 0.12s, box-shadow 0.15s, border-color 0.15s;
  position: relative;
}
.device-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }
.device-card:active { transform: translateY(0); }
.device-card.drag-over {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary);
}
.drop-tip {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(79, 70, 229, 0.12);
  border-radius: var(--radius);
  color: var(--color-primary); font-weight: 600; font-size: 0.9rem;
  pointer-events: none;
}
.device-icon {
  width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;
  background: var(--color-bg); border-radius: 50%; flex-shrink: 0; color: var(--color-primary);
}
.device-info { flex: 1; min-width: 0; }
.device-name { font-weight: 600; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.device-meta { font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 2px; }
.send-hint { color: var(--color-text-secondary); flex-shrink: 0; }
.device-card:hover .send-hint { color: var(--color-primary); }

.empty-icon { color: var(--color-text-secondary); margin-bottom: 12px; }
.empty-sub { font-size: 0.85rem; margin-top: 8px; color: var(--color-text-secondary); max-width: 320px; }
.pulse { animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }

.connection-info { margin-top: 24px; }
.me-row { display: flex; align-items: center; gap: 8px; }
.me-icon { color: var(--color-primary); flex-shrink: 0; }
.me-name { font-weight: 600; }
.me-tag { font-size: 0.7rem; color: var(--color-text-secondary); background: var(--color-bg); padding: 2px 8px; border-radius: 999px; }
.edit-btn {
  background: none; border: none; cursor: pointer; color: var(--color-text-secondary);
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 6px;
}
.edit-btn:hover { background: var(--color-bg); color: var(--color-primary); }
.name-input {
  flex: 1; max-width: 220px; padding: 6px 10px; font-size: 0.9rem;
  border: 1px solid var(--color-primary); border-radius: var(--radius-sm);
  background: var(--color-surface); color: var(--color-text);
}
.me-meta { font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 6px; }
</style>
