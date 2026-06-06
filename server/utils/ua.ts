export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown'

/**
 * 根据 User-Agent 推断设备类型。
 */
export function detectDeviceType(ua: string): DeviceType {
  if (!ua) return 'unknown'
  const lower = ua.toLowerCase()

  // 平板检测（iPad、Android Tablet 等）
  if (/ipad/.test(lower)) return 'tablet'
  if (/android/.test(lower) && !/mobile/.test(lower)) return 'tablet'
  if (/tablet/.test(lower)) return 'tablet'

  // 手机检测
  if (/iphone|ipod/.test(lower)) return 'mobile'
  if (/android.*mobile/.test(lower)) return 'mobile'
  if (/mobile|phone/.test(lower)) return 'mobile'

  // 默认桌面
  return 'desktop'
}

/**
 * 推断操作系统。
 */
export function detectOS(ua: string): string {
  if (!ua) return 'Unknown'
  if (/windows/i.test(ua)) return 'Windows'
  if (/macintosh|mac os/i.test(ua)) return 'macOS'
  if (/linux/i.test(ua)) return 'Linux'
  if (/android/i.test(ua)) return 'Android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS'
  return 'Unknown'
}

/**
 * 推断浏览器。
 */
export function detectBrowser(ua: string): string {
  if (!ua) return 'Unknown'
  if (/edg\//i.test(ua)) return 'Edge'
  if (/chrome/i.test(ua) && !/edg/i.test(ua)) return 'Chrome'
  if (/firefox/i.test(ua)) return 'Firefox'
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari'
  return 'Unknown'
}
