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
      const result = await transferMgr.ingestChunk({ transferId, fileId, chunkIndex, chunkBuffer: chunkBuf })
      return { ok: true, ...result }
    } catch (e: any) {
      return reply.code(400).send({ error: e.message })
    }
  })

  // 查询已接收分块（断点续传）
  app.get('/api/upload/status', async (req, reply) => {
    const { transferId, fileId } = req.query as { transferId?: string; fileId?: string }
    if (!transferId || !fileId) {
      return reply.code(400).send({ error: '缺少 transferId 或 fileId' })
    }
    const chunks = transferMgr.getReceivedChunks(transferId, fileId)
    return { transferId, fileId, receivedChunks: chunks }
  })
}
