<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsStore, type Theme } from '../stores/settings'
import { useToast } from '../composables/useToast'
import {
  isDesktop, getAppSettings, chooseDownloadDir, setAutoLaunch, openDownloadDir,
} from '../services/desktop'
import { ensureNotifyPermission, playBeep } from '../services/notify'
import {
  Sun, Moon, Monitor, Bell, Volume2, FolderOpen, Power, Info,
} from 'lucide-vue-next'

const settings = useSettingsStore()
const toast = useToast()
const desktop = isDesktop()

const downloadDir = ref('')
const autoLaunch = ref(false)

const themeOptions: { value: Theme; label: string; icon: any }[] = [
  { value: 'auto', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
]

onMounted(async () => {
  if (desktop) {
    const s = await getAppSettings()
    if (s) {
      downloadDir.value = s.downloadDir
      autoLaunch.value = s.autoLaunch
    }
  }
})

function setTheme(t: Theme) {
  settings.theme = t
}

async function toggleNotify() {
  settings.notify = !settings.notify
  if (settings.notify) {
    const ok = await ensureNotifyPermission()
    if (!ok) {
      toast.warning('系统未授予通知权限')
    }
  }
}

function toggleSound() {
  settings.sound = !settings.sound
  if (settings.sound) playBeep()
}

async function pickDir() {
  const dir = await chooseDownloadDir()
  if (dir) {
    downloadDir.value = dir
    toast.success('下载目录已更新')
  }
}

async function toggleAutoLaunch() {
  const next = !autoLaunch.value
  const res = await setAutoLaunch(next)
  autoLaunch.value = res
  toast.success(res ? '已开启开机自启' : '已关闭开机自启')
}
</script>

<template>
  <div class="settings-page">
    <h2 class="page-title">设置</h2>

    <!-- 外观 -->
    <section class="card group">
      <h3 class="group-title">外观</h3>
      <div class="row">
        <span class="row-label">主题</span>
        <div class="seg">
          <button
            v-for="opt in themeOptions"
            :key="opt.value"
            class="seg-btn"
            :class="{ active: settings.theme === opt.value }"
            @click="setTheme(opt.value)"
          >
            <component :is="opt.icon" :size="15" /> {{ opt.label }}
          </button>
        </div>
      </div>
    </section>

    <!-- 通知 -->
    <section class="card group">
      <h3 class="group-title">通知</h3>
      <div class="row">
        <span class="row-label"><Bell :size="16" /> 系统通知</span>
        <button class="switch" :class="{ on: settings.notify }" role="switch" :aria-checked="settings.notify" aria-label="系统通知" @click="toggleNotify">
          <span class="knob"></span>
        </button>
      </div>
      <div class="row">
        <span class="row-label"><Volume2 :size="16" /> 提示音</span>
        <button class="switch" :class="{ on: settings.sound }" role="switch" :aria-checked="settings.sound" aria-label="提示音" @click="toggleSound">
          <span class="knob"></span>
        </button>
      </div>
    </section>

    <!-- 桌面端设置 -->
    <section v-if="desktop" class="card group">
      <h3 class="group-title">下载</h3>
      <div class="row col">
        <span class="row-label"><FolderOpen :size="16" /> 下载目录</span>
        <div class="dir-box">
          <span class="dir-path" :title="downloadDir">{{ downloadDir }}</span>
          <div class="dir-actions">
            <button class="btn btn-secondary btn-sm" @click="openDownloadDir">打开</button>
            <button class="btn btn-primary btn-sm" @click="pickDir">更改</button>
          </div>
        </div>
      </div>
      <div class="row">
        <span class="row-label"><Power :size="16" /> 开机自启</span>
        <button class="switch" :class="{ on: autoLaunch }" role="switch" :aria-checked="autoLaunch" aria-label="开机自启" @click="toggleAutoLaunch">
          <span class="knob"></span>
        </button>
      </div>
    </section>

    <!-- 关于 -->
    <section class="card group">
      <h3 class="group-title">关于</h3>
      <div class="about">
        <Info :size="16" />
        <div>
          <div class="about-name">FlyDrop</div>
          <div class="about-ver">版本 0.1.2 · 局域网文件传输</div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-page { max-width: 600px; margin: 0 auto; }
.group { margin-bottom: 16px; }
.group-title { font-size: 0.85rem; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.03em; }

.row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 0; gap: 12px;
}
.row + .row { border-top: 1px solid var(--color-border); }
.row.col { flex-direction: column; align-items: stretch; }
.row-label { display: inline-flex; align-items: center; gap: 8px; font-size: 0.92rem; }

.seg {
  display: flex; background: var(--color-bg); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); padding: 3px; gap: 3px;
}
.seg-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px; border: none; background: transparent;
  border-radius: 6px; cursor: pointer; font-size: 0.82rem; color: var(--color-text-secondary);
}
.seg-btn.active { background: var(--color-surface); color: var(--color-primary); box-shadow: var(--shadow); }

/* 开关 */
.switch {
  width: 44px; height: 26px; border-radius: 999px; border: none;
  background: var(--color-border); position: relative; cursor: pointer; transition: background 0.2s; flex-shrink: 0;
}
.switch.on { background: var(--color-primary); }
.knob {
  position: absolute; top: 3px; left: 3px; width: 20px; height: 20px;
  background: #fff; border-radius: 50%; transition: transform 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.switch.on .knob { transform: translateX(18px); }

.dir-box { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.dir-path {
  flex: 1; min-width: 0; font-size: 0.82rem; color: var(--color-text-secondary);
  font-family: ui-monospace, Menlo, monospace; background: var(--color-bg);
  padding: 8px 10px; border-radius: var(--radius-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dir-actions { display: flex; gap: 6px; flex-shrink: 0; }
.btn-sm { padding: 6px 12px; font-size: 0.8rem; min-height: 36px; }

.about { display: flex; align-items: center; gap: 12px; color: var(--color-text-secondary); }
.about-name { font-weight: 600; color: var(--color-text); }
.about-ver { font-size: 0.8rem; margin-top: 2px; }
</style>
