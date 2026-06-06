import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type Theme = 'auto' | 'light' | 'dark'

const LS_KEY = 'lft-settings-v1'

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<Theme>('auto')
  const sound = ref(true)   // 提示音
  const notify = ref(true)  // 系统通知

  // 读取持久化
  try {
    const r = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    if (r.theme === 'auto' || r.theme === 'light' || r.theme === 'dark') theme.value = r.theme
    if (typeof r.sound === 'boolean') sound.value = r.sound
    if (typeof r.notify === 'boolean') notify.value = r.notify
  } catch {}

  function resolvedTheme(): 'light' | 'dark' {
    if (theme.value === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return theme.value
  }

  function applyTheme() {
    document.documentElement.dataset.theme = resolvedTheme()
  }

  // 初始应用 + 监听系统主题变化（仅 auto 模式跟随）
  applyTheme()
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener?.('change', () => {
      if (theme.value === 'auto') applyTheme()
    })
  } catch {}

  watch(theme, applyTheme)
  watch([theme, sound, notify], () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        theme: theme.value, sound: sound.value, notify: notify.value,
      }))
    } catch {}
  })

  return { theme, sound, notify, applyTheme, resolvedTheme }
})
