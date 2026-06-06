<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { isDesktop } from '../services/desktop'
import { MonitorSmartphone, QrCode, MousePointerClick, ShieldCheck } from 'lucide-vue-next'

const LS_KEY = 'lft-onboarded-v1'
const show = ref(false)
const desktop = isDesktop()

onMounted(() => {
  try {
    if (!localStorage.getItem(LS_KEY)) show.value = true
  } catch {}
})

function close() {
  show.value = false
  try { localStorage.setItem(LS_KEY, '1') } catch {}
}

// 桌面端（主机）与移动端展示不同引导
const steps = desktop
  ? [
      { icon: QrCode, title: '让设备扫码连入', desc: '手机 / 平板连接同一 Wi-Fi，扫描设备页的二维码或输入地址即可加入。' },
      { icon: MousePointerClick, title: '点击设备发送', desc: '在设备列表点击目标设备，或把文件直接拖到设备卡片上即可发送。' },
      { icon: ShieldCheck, title: '收文件先确认', desc: '别人发来的文件会先弹出确认，接受后才开始接收，下载完可一键定位。' },
    ]
  : [
      { icon: MonitorSmartphone, title: '你已连入局域网', desc: '现在你能看到同一网络下的其他设备，并与它们互传文件。' },
      { icon: MousePointerClick, title: '点击设备发送', desc: '点击任意设备进入发送页，选择文件、图片，或直接粘贴截图、发送文本。' },
      { icon: ShieldCheck, title: '收文件先确认', desc: '收到文件会先弹出确认；接受后在「收件箱」里下载。' },
    ]
</script>

<template>
  <transition name="modal">
    <div v-if="show" class="overlay" @click.self="close">
      <div class="dialog card">
        <div class="brand">
          <img src="/icon-192.png" alt="logo" class="logo" />
          <div>
            <div class="brand-name">飞传 FlyDrop</div>
            <div class="brand-sub">局域网文件互传，无需安装</div>
          </div>
        </div>

        <div class="steps">
          <div v-for="(s, i) in steps" :key="i" class="step">
            <div class="step-icon"><component :is="s.icon" :size="20" /></div>
            <div class="step-text">
              <div class="step-title">{{ s.title }}</div>
              <div class="step-desc">{{ s.desc }}</div>
            </div>
          </div>
        </div>

        <button class="btn btn-primary start-btn" @click="close">开始使用</button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 2500; padding: 20px;
}
.dialog { width: 100%; max-width: 420px; }
.brand { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.logo { width: 48px; height: 48px; border-radius: 12px; }
.brand-name { font-size: 1.2rem; font-weight: 700; }
.brand-sub { font-size: 0.82rem; color: var(--color-text-secondary); margin-top: 2px; }
.steps { display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; }
.step { display: flex; gap: 12px; align-items: flex-start; }
.step-icon {
  width: 40px; height: 40px; flex-shrink: 0; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-bg); color: var(--color-primary);
}
.step-title { font-weight: 600; font-size: 0.92rem; }
.step-desc { font-size: 0.82rem; color: var(--color-text-secondary); margin-top: 2px; line-height: 1.5; }
.start-btn { width: 100%; padding: 12px; }

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-active .dialog, .modal-leave-active .dialog { transition: transform 0.2s ease; }
.modal-enter-from .dialog, .modal-leave-to .dialog { transform: scale(0.94); }
</style>
