import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import archiver from 'archiver'
import { TransferManager } from '../transferManager.js'
import { StorageManager } from '../storage.js'

export function registerDownloadRoutes(
  app: FastifyInstance,
  transferMgr: TransferManager,
  storage: StorageManager
) {
  // 单文件下载（支持 Range）
  app.get('/api/download/:transferId/:fileId', async (req, reply) => {
    const { transferId, fileId } = req.params as { transferId: string; fileId: string }
    const { deviceId } = req.query as { deviceId?: string }

    // 授权校验：仅接收方可下载
    if (!transferMgr.authorizeDownload(transferId, deviceId)) {
      return reply.code(403).send({ error: '无下载权限' })
    }

    const t = transferMgr.get(transferId)!
    const file = t.files.find(f => f.fileId === fileId)
    if (!file) {
      return reply.code(404).send({ error: '文件不存在' })
    }

    const fullPath = await storage.findFile(transferId, fileId)
    if (!fullPath) {
      return reply.code(404).send({ error: '文件数据不存在' })
    }

    const stat = await fs.promises.stat(fullPath)
    const range = req.headers.range

    reply.header('Content-Type', file.mime || 'application/octet-stream')
    reply.header('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    reply.header('Accept-Ranges', 'bytes')

    if (range) {
      const m = /bytes=(\d+)-(\d+)?/.exec(range)
      if (!m) return reply.code(416).send()
      const start = Number(m[1])
      const end = m[2] ? Number(m[2]) : stat.size - 1
      if (start >= stat.size) return reply.code(416).send()

      reply.code(206)
      reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      reply.header('Content-Length', String(end - start + 1))
      // Range 请求只在最后一段完成时标记完成
      if (end >= stat.size - 1) {
        transferMgr.markCompleted(transferId)
      }
      return reply.send(fs.createReadStream(fullPath, { start, end }))
    }

    reply.header('Content-Length', String(stat.size))

    // 完整下载，传输结束后标记完成
    const stream = fs.createReadStream(fullPath)
    stream.on('end', () => transferMgr.markCompleted(transferId))
    return reply.send(stream)
  })

  // 多文件 zip 打包下载
  app.get('/api/download/:transferId', async (req, reply) => {
    const { transferId } = req.params as { transferId: string }
    const { deviceId } = req.query as { deviceId?: string }

    // 授权校验：仅接收方可下载
    if (!transferMgr.authorizeDownload(transferId, deviceId)) {
      return reply.code(403).send({ error: '无下载权限' })
    }

    const t = transferMgr.get(transferId)!

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent('files.zip')}`)

    const archive = archiver('zip', { zlib: { level: 5 } })
    reply.raw.on('close', () => archive.abort())

    for (const file of t.files) {
      const fullPath = await storage.findFile(transferId, file.fileId)
      if (fullPath) {
        archive.file(fullPath, { name: file.name })
      }
    }

    archive.on('end', () => transferMgr.markCompleted(transferId))
    archive.pipe(reply.raw)
    archive.finalize()

    return reply
  })
}
