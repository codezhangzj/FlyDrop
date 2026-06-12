import type { FastifyInstance } from 'fastify'
import { TransferManager } from '../transferManager.js'
import { config } from '../config.js'

export function registerUploadRoutes(app: FastifyInstance, transferMgr: TransferManager) {
  // 分片上传
  app.post('/api/upload', async (req, reply) => {
    const parts = req.parts()
    let transferId = ''
    let fileId = ''
    let chunkIndex = -1
    let deviceId = ''
    let chunkBuf: Buffer | null = null

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'chunk') {
        const chunks: Buffer[] = []
        for await (const chunk of part.file) {
          chunks.push(chunk)
        }
        chunkBuf = Buffer.concat(chunks)
      } else if (part.type === 'field') {
        if (part.fieldname === 'transferId') transferId = String(part.value)
        if (part.fieldname === 'fileId') fileId = String(part.value)
        if (part.fieldname === 'chunkIndex') chunkIndex = Number(part.value)
        if (part.fieldname === 'deviceId') deviceId = String(part.value)
      }
    }

    if (!chunkBuf || !transferId || !fileId || chunkIndex < 0) {
      return reply.code(400).send({ error: '缺少必需字段' })
    }

    // 校验大小上限
    if (chunkBuf.length > config.chunkSize * 2) {
      return reply.code(413).send({ error: '分片过大' })
    }

    try {
      const result = await transferMgr.ingestChunk({ transferId, fileId, chunkIndex, chunkBuffer: chunkBuf, byDeviceId: deviceId })
      return { ok: true, ...result }
    } catch (e: any) {
      // 鉴权失败返回 403，其余按 400 处理
      const code = e?.message === 'unauthorized uploader' ? 403 : 400
      return reply.code(code).send({ error: e.message })
    }
  })

  // 查询已接收分块（断点续传）
  app.get('/api/upload/status', async (req, reply) => {
    const { transferId, fileId, deviceId } = req.query as { transferId?: string; fileId?: string; deviceId?: string }
    if (!transferId || !fileId) {
      return reply.code(400).send({ error: '缺少 transferId 或 fileId' })
    }
    // 鉴权：仅该传输的发送方可查询续传状态
    const t = transferMgr.get(transferId)
    if (!t || t.fromDeviceId !== deviceId) {
      return reply.code(403).send({ error: '无权限' })
    }
    const chunks = transferMgr.getReceivedChunks(transferId, fileId)
    return { transferId, fileId, receivedChunks: chunks }
  })
}
