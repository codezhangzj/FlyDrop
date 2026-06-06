export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

export function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return ''
  return formatSize(bytesPerSec) + '/s'
}

export function formatEta(sec?: number): string {
  if (!sec || sec <= 0 || !isFinite(sec)) return ''
  if (sec < 60) return Math.ceil(sec) + ' 秒'
  if (sec < 3600) return Math.ceil(sec / 60) + ' 分钟'
  return (sec / 3600).toFixed(1) + ' 小时'
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
