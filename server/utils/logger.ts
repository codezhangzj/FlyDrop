/**
 * 简易结构化日志。
 */
export function log(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  const metaStr = meta ? ' ' + JSON.stringify(meta) : ''
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '✓'
  console.log(`[${ts}] ${prefix} ${message}${metaStr}`)
}
