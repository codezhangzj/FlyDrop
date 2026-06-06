import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './styles/main.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/devices' },
    { path: '/devices', component: () => import('./views/DevicesView.vue') },
    { path: '/send/:deviceId', component: () => import('./views/SendView.vue'), props: true },
    { path: '/inbox', component: () => import('./views/InboxView.vue') },
    { path: '/settings', component: () => import('./views/SettingsView.vue') },
  ]
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// 自愈：注销历史遗留的 Service Worker 并清理其缓存
// （此前版本的 SW 采用缓存优先，重建后会导致引用旧资源而白屏）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((regs) => {
    regs.forEach((r) => r.unregister())
  }).catch(() => {})
  if (typeof caches !== 'undefined') {
    caches.keys?.().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {})
  }
}
