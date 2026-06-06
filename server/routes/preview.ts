import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import fs from 'fs'
import { TransferManager } from '../transferManager.js'
import { StorageManager } from '../storage.js'

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

    try {
      const thumbnail = await sharp(fullPath)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer()

      reply.header('Content-Type', 'image/jpeg')
      reply.header('Cache-Control', 'public, max-age=3600')
      return reply.send(thumbnail)
    } catch (e) {
      return reply.code(500).send({ error: '缩略图生成失败' })
    }
  })
}
