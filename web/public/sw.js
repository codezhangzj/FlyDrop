// 自毁式 Service Worker（kill-switch）
// 历史版本曾注册缓存优先的 SW，会导致重建后白屏。
// 此文件用于让已注册旧 SW 的浏览器在下次检查更新时自动清缓存并注销。
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    } catch {}
    try {
      await self.registration.unregister()
    } catch {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' })
      clients.forEach((c) => c.navigate(c.url))
    } catch {}
  })())
})

// 不拦截任何请求，全部走网络
self.addEventListener('fetch', () => {})
