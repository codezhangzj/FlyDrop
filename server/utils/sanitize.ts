/**
 * 过滤文件名中的路径穿越字符，只保留安全文件名。
 */
export function sanitizeFileName(name: string): string {
  // 移除路径分隔符与常见危险字符
  let safe = name
    .replace(/[/\\]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/[<>:"|?*\x00-\x1F]/g, '_')
    .trim()

  // 如果过滤后为空则给默认名
  if (!safe || safe === '.' || safe === '..') {
    safe = 'unnamed_file'
  }

  // 限制长度
  if (safe.length > 255) {
    safe = safe.slice(0, 255)
  }

  return safe
}
