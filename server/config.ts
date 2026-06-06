import path from 'path'
import os from 'os'

function env(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue
}

function envInt(key: string, defaultValue: number): number {
  const v = process.env[key]
  return v ? parseInt(v, 10) : defaultValue
}

function envBool(key: string, defaultValue: boolean): boolean {
  const v = process.env[key]
  if (!v) return defaultValue
  return v === '1' || v.toLowerCase() === 'true'
}

export const config = {
  port: envInt('PORT', 5180),
  bindHost: env('BIND', '0.0.0.0'),
  chunkSize: 4 * 1024 * 1024, // 4MB
  maxFileSize: 10 * 1024 * 1024 * 1024, // 10GB
  ttlMs: 24 * 60 * 60 * 1000, // 24h
  completedGraceMs: 10 * 60 * 1000, // 下载完成后保留 10 分钟（便于重下），之后清理
  storageDir: path.join(os.tmpdir(), 'FlyDrop'),
  heartbeatTimeoutMs: 30_000,
  heartbeatCheckIntervalMs: 10_000,
  cleanupIntervalMs: 60_000, // 每分钟检查过期
  broadcastDebounceMs: 100,
  maxPortRetries: 10,
  autoOpenBrowser: envBool('AUTO_OPEN', false),
}
