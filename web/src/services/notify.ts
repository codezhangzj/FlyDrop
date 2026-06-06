// 通知服务：系统通知 + 提示音

let permissionRequested = false

/** 请求通知权限（安全上下文下可用，如桌面端 localhost） */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  if (permissionRequested) return Notification.permission === 'granted'
  permissionRequested = true
  try {
    const res = await Notification.requestPermission()
    return res === 'granted'
  } catch {
    return false
  }
}

/** 弹出系统通知 */
export function systemNotify(title: string, body: string) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  } catch {}
}

/** 播放一段短提示音（WebAudio 合成，无需音频文件） */
export function playBeep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3)
    osc.start()
    osc.stop(ctx.currentTime + 0.32)
    osc.onended = () => ctx.close()
  } catch {}
}

/** 收到文件的综合提醒 */
export function notifyIncoming(deviceName: string, fileCount: number) {
  systemNotify('收到新文件', `来自 ${deviceName} 的 ${fileCount} 个文件`)
  playBeep()
}
