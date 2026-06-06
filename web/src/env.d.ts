/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  desktopAPI?: {
    isDesktop: boolean
    getServerInfo: () => Promise<{
      port: number
      ips: string[]
      urls: string[]
      qrDataUrl: string | null
      isDesktop: boolean
    } | null>
    downloadFile: (opts: { url: string; fileName: string; key: string }) => Promise<{
      ok: boolean
      savePath?: string
      error?: string
    }>
    revealFile: (savePath: string) => Promise<boolean>
    onDownloadProgress: (cb: (p: { key: string; received: number; total: number }) => void) => () => void
    getAppSettings: () => Promise<{ downloadDir: string; autoLaunch: boolean }>
    chooseDownloadDir: () => Promise<string | null>
    setAutoLaunch: (enabled: boolean) => Promise<boolean>
    openDownloadDir: () => Promise<boolean>
  }
}
