import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import { TransferManager } from '../transferManager.js'
import { StorageManager } from '../storage.js'
import { log } from '../utils/logger.js'

// 惰性加载 sharp：原生模块在某些平台/打包环境可能缺失，
// 不能在模块顶层 import，否则会导致主进程启动即崩溃。
type SharpModule = typeof import('sharp')
let sharpModule: SharpModule | null | undefined // undefined=未尝试, null=不可用
async function loadSharp(): Promise<SharpModule | null> {
  if (sharpModule !== undefined) return sharpModule
  try {
    const mod = await import('sharp')
    sharpModule = (mod.default ?? mod) as SharpModule
  } catch (e) {
    sharpModule = null
    log('warn', 'sharp 不可用，缩略图将回退为原图', { error: e instanceof Error ? e.message : String(e) })
  }
  return sharpModule
}

export function registerPreviewRoutes(
  app: FastifyInstance,
  transferMgr: TransferManager,
  storage: StorageManager
) {
  // 图片缩略图预览
  app.get('/api/preview/:transferId/:fileId', async (req, reply) => {
    const { transferId, fileId } = req.params as { transferId: string; fileId: string }
    const { deviceId } = req.query as { deviceId?: string }

    // 授权校验：仅接收方可预览
    if (!transferMgr.authorizeDownload(transferId, deviceId)) {
      return reply.code(403).send({ error: '无预览权限' })
    }

    const t = transferMgr.get(transferId)!
    const file = t.files.find(f => f.fileId === fileId)
    if (!file) {
      return reply.code(404).send({ error: '文件不存在' })
    }

    // 只处理图片
    if (!file.mime.startsWith('image/')) {
      return reply.code(400).send({ error: '非图片类型' })
    }

    const fullPath = await storage.findFile(transferId, fileId)
    if (!fullPath) {
      return reply.code(404).send({ error: '文件数据不存在' })
    }

    const sharp = await loadSharp()

    // sharp 不可用：回退为直接返回原图（仍可预览，只是不缩小）
    if (!sharp) {
      reply.header('Content-Type', file.mime)
      reply.header('Cache-Control', 'public, max-age=3600')
      return reply.send(fs.createReadStream(fullPath))
    }

    try {
      const thumbnail = await sharp(fullPath)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer()

      reply.header('Content-Type', 'image/jpeg')
      reply.header('Cache-Control', 'public, max-age=3600')
      return reply.send(thumbnail)
    } catch (e) {
      // 生成失败也回退为原图，而不是 500
      log('warn', '缩略图生成失败，回退原图', { transferId, fileId, error: e instanceof Error ? e.message : String(e) })
      reply.header('Content-Type', file.mime)
      reply.header('Cache-Control', 'public, max-age=3600')
      return reply.send(fs.createReadStream(fullPath))
    }
  })
}
