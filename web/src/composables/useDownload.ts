import { computed, onMounted, onUnmounted } from 'vue'
import { useTransfersStore } from '../stores/transfers'
import { useDevicesStore } from '../stores/devices'
import { useToast } from './useToast'
import { isDesktop, desktopDownload, revealFile, onDownloadProgress } from '../services/desktop'

export function useDownload() {
  const transfersStore = useTransfersStore()
  const devicesStore = useDevicesStore()
  const toast = useToast()

  const desktop = isDesktop()
  const myDeviceId = computed(() => devicesStore.myDevice?.deviceId ?? '')

  let unsub: (() => void) | null = null

  onMounted(() => {
    if (desktop) {
      unsub = onDownloadProgress(({ key, received, total }) => {
        transfersStore.setDownloadProgress(key, received, total)
      })
    }
  })
  onUnmounted(() => unsub?.())

  function zipKey(transferId: string) { return `zip:${transferId}` }
  function dl(key: string) { return transfersStore.getDownload(key) }

  function buildUrl(transferId: string, fileId?: string) {
    const base = fileId ? `/api/download/${transferId}/${fileId}` : `/api/download/${transferId}`
    return `${base}?deviceId=${encodeURIComponent(myDeviceId.value)}`
  }

  async function runDownload(key: string, url: string, fileName: string) {
    if (desktop) {
      transfersStore.setDownload(key, { status: 'downloading', progress: 0, _lastTs: undefined, _lastBytes: undefined })
      const res = await desktopDownload({ url, fileName, key })
      if (res.ok) {
        transfersStore.setDownload(key, { status: 'done', progress: 1, savePath: res.savePath, speed: 0, etaSec: 0 })
        toast.success(`已下载：${fileName}`)
      } else {
        transfersStore.setDownload(key, { status: 'error', progress: 0, error: res.error })
        toast.error(`下载失败：${fileName}`)
      }
    } else {
      const a = document.createElement('a')
      a.href = url; a.download = fileName
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      transfersStore.setDownload(key, { status: 'done', progress: 1 })
      toast.success('已开始下载')
    }
  }

  function downloadFile(transferId: string, fileId: string, fileName: string) {
    runDownload(fileId, buildUrl(transferId, fileId), fileName)
  }

  function downloadAll(transferId: string) {
    runDownload(zipKey(transferId), buildUrl(transferId), 'files.zip')
  }

  async function reveal(savePath?: string) {
    if (savePath) {
      const ok = await revealFile(savePath)
      if (!ok) toast.error('文件不存在或已移动')
    }
  }

  return {
    dl,
    zipKey,
    downloadFile,
    downloadAll,
    reveal,
    desktop // 暴露桌面状态以供按需渲染文件夹按钮
  }
}
