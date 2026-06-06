// 桌面端（Electron）能力探测与访问

export interface ServerInfo {
  port: number
  ips: string[]
  urls: string[]
  qrDataUrl: string | null
  isDesktop: boolean
}

export interface DownloadProgress {
  key: string
  received: number
  total: number
}

export interface DownloadResult {
  ok: boolean
  savePath?: string
  error?: string
}

interface DesktopAPI {
  isDesktop: boolean
  getServerInfo: () => Promise<ServerInfo | null>
  downloadFile: (opts: { url: string; fileName: string; key: string }) => Promise<DownloadResult>
  revealFile: (savePath: string) => Promise<boolean>
  onDownloadProgress: (cb: (p: DownloadProgress) => void) => () => void
  getAppSettings: () => Promise<AppSettings>
  chooseDownloadDir: () => Promise<string | null>
  setAutoLaunch: (enabled: boolean) => Promise<boolean>
  openDownloadDir: () => Promise<boolean>
}

export interface AppSettings {
  downloadDir: string
  autoLaunch: boolean
}

function getApi(): DesktopAPI | null {
  return (window as any).desktopAPI ?? null
}

/** 是否运行在桌面端 */
export function isDesktop(): boolean {
  return !!getApi()?.isDesktop
}

/** 获取服务信息（仅桌面端可用） */
export async function getServerInfo(): Promise<ServerInfo | null> {
  const api = getApi()
  if (!api) return null
  try {
    return await api.getServerInfo()
  } catch {
    return null
  }
}

/** 桌面端下载文件，返回保存路径 */
export async function desktopDownload(opts: { url: string; fileName: string; key: string }): Promise<DownloadResult> {
  const api = getApi()
  if (!api) return { ok: false, error: 'not desktop' }
  return api.downloadFile(opts)
}

/** 在系统文件管理器中定位文件 */
export async function revealFile(savePath: string): Promise<boolean> {
  const api = getApi()
  if (!api) return false
  return api.revealFile(savePath)
}

/** 订阅下载进度，返回取消订阅函数 */
export function onDownloadProgress(cb: (p: DownloadProgress) => void): () => void {
  const api = getApi()
  if (!api) return () => {}
  return api.onDownloadProgress(cb)
}

/** 获取桌面端设置（下载目录 / 开机自启） */
export async function getAppSettings(): Promise<AppSettings | null> {
  const api = getApi()
  if (!api) return null
  try { return await api.getAppSettings() } catch { return null }
}

/** 选择下载目录，返回新路径（取消则 null） */
export async function chooseDownloadDir(): Promise<string | null> {
  const api = getApi()
  if (!api) return null
  return api.chooseDownloadDir()
}

/** 设置开机自启 */
export async function setAutoLaunch(enabled: boolean): Promise<boolean> {
  const api = getApi()
  if (!api) return false
  return api.setAutoLaunch(enabled)
}

/** 打开下载目录 */
export async function openDownloadDir(): Promise<boolean> {
  const api = getApi()
  if (!api) return false
  return api.openDownloadDir()
}
