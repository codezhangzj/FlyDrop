import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import { TransferManager } from '../transferManager.js'
import { StorageManager } from '../storage.js'

/**
 * 流式预览端点：用于接收端内联播放视频 / 查看大图。
 * 与 /api/download 的区别：
 * - 支持 Range（视频拖动播放必需）
 * - Content-Disposition: inline（浏览器内联展示而非下载）
 * - 不标记传输完成、不触发清理（预览不等于已保存）
 */
export function registerStreamRoutes(
  app: FastifyInstance,
  transferMgr: TransferManager,
  storage: StorageManager
) {
  app.get('/api/stream/:transferId/:fileId', async (req, reply) => {
    const { transferId, fileId } = req.params as { transferId: string; fileId: string }
    const { deviceId } = req.query as { deviceId?: string }

    // 授权：仅接收方可预览
    if (!transferMgr.authorizeDownload(transferId, deviceId)) {
      return reply.code(403).send({ error: '无预览权限' })
    }

    const t = transferMgr.get(transferId)!
    const file = t.files.find(f => f.fileId === fileId)
    if (!file) return reply.code(404).send({ error: '文件不存在' })

    const fullPath = await storage.findFile(transferId, fileId)
    if (!fullPath) return reply.code(404).send({ error: '文件数据不存在' })

    const stat = await fs.promises.stat(fullPath)
    const range = req.headers.range

    reply.header('Content-Type', file.mime || 'application/octet-stream')
    reply.header('Content-Disposition', 'inline')
    reply.header('Accept-Ranges', 'bytes')
    reply.header('Cache-Control', 'no-store')

    if (range) {
      const m = /bytes=(\d+)-(\d+)?/.exec(range)
      if (!m) return reply.code(416).send()
      const start = Number(m[1])
      const end = m[2] ? Number(m[2]) : stat.size - 1
      if (start >= stat.size) return reply.code(416).send()
      reply.code(206)
      reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      reply.header('Content-Length', String(end - start + 1))
      return reply.send(fs.createReadStream(fullPath, { start, end }))
    }

    reply.header('Content-Length', String(stat.size))
    // 注意：不调用 markCompleted —— 预览不影响传输状态
    return reply.send(fs.createReadStream(fullPath))
  })
}
