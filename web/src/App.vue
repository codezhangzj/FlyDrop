<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDevicesStore } from './stores/devices'
import { useTransfersStore } from './stores/transfers'
import { useSettingsStore } from './stores/settings'
import { useGroupsStore } from './stores/groups'
import { wsClient, connStatus } from './services/ws'
import { ensureNotifyPermission, systemNotify, playBeep } from './services/notify'
import { useToast } from './composables/useToast'
import { setPendingFiles } from './services/pendingFiles'
import ToastContainer from './components/ToastContainer.vue'
import IncomingOffer from './components/IncomingOffer.vue'
import Onboarding from './components/Onboarding.vue'
import { MonitorSmartphone, Inbox, Wifi, WifiOff, Loader, Settings } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const devicesStore = useDevicesStore()
const transfersStore = useTransfersStore()
const settings = useSettingsStore()
const groupsStore = useGroupsStore()
const toast = useToast()

function getDeviceName(): string {
  const uaData = (navigator as any).userAgentData
  if (uaData?.platform) {
    const brand = uaData.brands?.find((b: any) => !b.brand.includes('Not'))?.brand || ''
    return `${uaData.platform}${brand ? ' · ' + brand : ''}`
  }
  const ua = navigator.userAgent
  let os = 'Unknown'
  let browser = ''
  if (/iPhone/.test(ua)) os = 'iPhone'
  else if (/iPad/.test(ua)) os = 'iPad'
  else if (/Android/.test(ua)) {
    const m = ua.match(/Android[^;]*;\s*([^)]+?)(?:\s+Build|\))/)
    os = m ? m[1].trim() : 'Android'
  } else if (/Macintosh/.test(ua)) os = 'Mac'
  else if (/Windows/.test(ua)) os = 'Windows PC'
  else if (/Linux/.test(ua)) os = 'Linux'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/Chrome\//.test(ua)) browser = 'Chrome'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari'
  return browser ? `${os} · ${browser}` : os
}

const windowWidth = ref(window.innerWidth)
const mode = computed(() => {
  if (windowWidth.value < 640) return 'mobile'
  if (windowWidth.value < 1024) return 'tablet'
  return 'desktop'
})
function onResize() {
  windowWidth.value = window.innerWidth
}

const tabs = [
  { path: '/devices', icon: MonitorSmartphone, label: '设备' },
  { path: '/inbox', icon: Inbox, label: '收件箱' },
]

const badgeCount = computed(() =>
  transfersStore.awaitingTransfers.length + transfersStore.readyTransfers.length
)

// 全局拖拽发送
const globalDragging = ref(false)
let dragDepth = 0
function onWindowDragEnter(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) {
    dragDepth++
    globalDragging.value = true
  }
}
function onWindowDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) globalDragging.value = false
}
function onWindowDrop(e: DragEvent) {
  dragDepth = 0
  globalDragging.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    setPendingFiles(Array.from(files))
    toast.info(`已选 ${files.length} 个文件，点击设备发送`)
    router.push('/devices')
  }
}

const connInfo = computed(() => {
  switch (connStatus.value) {
    case 'connected': return { icon: Wifi, text: '已连接', cls: 'ok' }
    case 'connecting': return { icon: Loader, text: '连接中', cls: 'wait' }
    case 'reconnecting': return { icon: Loader, text: '重连中', cls: 'wait' }
    default: return { icon: WifiOff, text: '已断开', cls: 'err' }
  }
})

onMounted(() => {
  window.addEventListener('resize', onResize)
  window.addEventListener('drop', forceClearDrag, true)
  ensureNotifyPermission()

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const deviceName = getDeviceName()
  const wsUrl = `${protocol}//${window.location.host}/ws?deviceName=${encodeURIComponent(deviceName)}`
  wsClient.connect(wsUrl)

  wsClient.on((msg) => {
    switch (msg.type) {
      case 'device:hello':
        devicesStore.setMyDevice(msg.payload)
        break
      case 'device:list':
        devicesStore.setDevices(msg.payload.devices)
        break
      case 'group:list':
        groupsStore.setGroups(msg.payload.groups)
        break
      case 'group:created':
        groupsStore.addGroup(msg.payload.group)
        break
      case 'transfer:offer':
        transfersStore.addIncoming(msg.payload)
        if (settings.notify) systemNotify('收到新文件', `来自 ${msg.payload.fromDeviceName ?? '未知设备'} 的 ${msg.payload.files?.length ?? 0} 个文件`)
        if (settings.sound) playBeep()
        break
      case 'transfer:progress':
        transfersStore.updateProgress(msg.payload)
        break
      case 'transfer:ready':
        transfersStore.onReady(msg.payload)
        break
      case 'transfer:done':
        transfersStore.onDone(msg.payload.transferId)
        break
      case 'transfer:cancel':
        transfersStore.onCancel(msg.payload.transferId)
        break
      case 'transfer:error':
        transfersStore.onError(msg.payload)
        break
    }
  })

  // 连接状态变化提示
})

function forceClearDrag() {
  dragDepth = 0
  globalDragging.value = false
}

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('drop', forceClearDrag, true)
  wsClient.close()
})
</script>

<template>
  <div
    class="layout"
    :data-mode="mode"
    @dragenter="onWindowDragEnter"
    @dragover.prevent
    @dragleave="onWindowDragLeave"
    @drop.prevent="onWindowDrop"
  >
    <header class="topbar">
      <h1 class="topbar-title">
        <MonitorSmartphone :size="20" />
        <span>飞传</span>
      </h1>
      <div class="topbar-right">
        <span class="conn-badge" :class="connInfo.cls">
          <component :is="connInfo.icon" :size="14" :class="{ spin: connInfo.cls === 'wait' }" />
          <span class="conn-text">{{ connInfo.text }}</span>
        </span>
        <span class="topbar-name" v-if="devicesStore.myDevice">
          {{ devicesStore.myDevice.displayName }}
        </span>
        <button class="gear-btn" :class="{ active: route.path.startsWith('/settings') }" aria-label="设置" @click="router.push('/settings')" title="设置">
          <Settings :size="18" />
        </button>
      </div>
    </header>

    <nav class="sidenav" v-if="mode !== 'mobile'">
      <router-link
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="sidenav-item"
        :class="{ active: route.path.startsWith(tab.path) }"
      >
        <component :is="tab.icon" :size="20" />
        <span class="nav-label">{{ tab.label }}</span>
        <span v-if="tab.path === '/inbox' && badgeCount > 0" class="badge">{{ badgeCount }}</span>
      </router-link>
    </nav>

    <main class="content">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <nav class="bottomnav" v-if="mode === 'mobile'">
      <router-link
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="bottomnav-item"
        :class="{ active: route.path.startsWith(tab.path) }"
      >
        <component :is="tab.icon" :size="22" />
        <span class="nav-label">{{ tab.label }}</span>
        <span v-if="tab.path === '/inbox' && badgeCount > 0" class="badge">{{ badgeCount }}</span>
      </router-link>
    </nav>

    <ToastContainer />
    <IncomingOffer />
    <Onboarding />

    <!-- 全局拖拽提示 -->
    <transition name="modal">
      <div v-if="globalDragging" class="drop-overlay">
        <div class="drop-overlay-inner">
          <Inbox :size="40" />
          <p>松开以选择接收设备</p>
        </div>
      </div>
    </transition>
  </div>
</template>
