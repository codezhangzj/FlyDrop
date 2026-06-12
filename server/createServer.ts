import Fastify, { type FastifyInstance } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import fastifyCors from '@fastify/cors'
import path from 'path'
import fs from 'fs'

import { config } from './config.js'
import { listLanIPv4 } from './network.js'
import { DeviceManager } from './deviceManager.js'
import { GroupManager } from './groupManager.js'
import { StorageManager } from './storage.js'
import { TransferManager } from './transferManager.js'
import { registerUploadRoutes } from './routes/upload.js'
import { registerDownloadRoutes } from './routes/download.js'
import { registerPreviewRoutes } from './routes/preview.js'
import { registerStreamRoutes } from './routes/stream.js'
import { registerMetaRoutes } from './routes/meta.js'
import { log } from './utils/logger.js'
import type { Transfer, WsMessage } from './types.js'

export interface StartServerOptions {
  /** 前端静态资源目录，不传则自动探测 dist/web 或 web/dist */
  staticDir?: string
  /** 监听端口，默认取 config.port */
  port?: number
}

export interface ServerHandle {
  app: FastifyInstance
  port: number
  ips: string[]
  urls: string[]
  close: () => Promise<void>
}

/**
 * 启动 HTTP + WebSocket 服务。供 CLI 与 Electron 主进程共用。
 */
export async function startServer(options: StartServerOptions = {}): Promise<ServerHandle> {
  const app = Fastify({
    logger: false,
    bodyLimit: config.chunkSize * 2,
  })

  await app.register(fastifyCors, { origin: true })
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.chunkSize * 2,
      files: 1,
    }
  })
  await app.register(fastifyWebsocket)

  const deviceMgr = new DeviceManager()
  const groupMgr = new GroupManager(deviceMgr)
  const storage = new StorageManager()
  const transferMgr = new TransferManager(storage, deviceMgr)

  function sendTransferSnapshot(deviceId: string, transfer: Transfer): void {
    deviceMgr.send(deviceId, {
      type: 'transfer:offer',
      payload: {
        transferId: transfer.transferId,
        groupId: transfer.groupId,
        groupName: transfer.groupName,
        files: transfer.files,
        message: transfer.message,
        fromDeviceName: transfer.fromDeviceName,
        requiresAccept: false,
      }
    })

    if (transfer.status === 'uploading') {
      deviceMgr.send(deviceId, {
        type: 'transfer:progress',
        payload: {
          transferId: transfer.transferId,
          uploadedBytes: transfer.uploadedBytes,
          totalBytes: transfer.totalBytes,
        }
      })
    }

    if (transfer.status === 'ready' || transfer.status === 'completed') {
      deviceMgr.send(deviceId, {
        type: 'transfer:ready',
        payload: {
          transferId: transfer.transferId,
          files: transfer.files,
          groupId: transfer.groupId,
          groupName: transfer.groupName,
        }
      })
    }
  }

  const heartbeatInterval = setInterval(() => {
    deviceMgr.pruneStale()
  }, config.heartbeatCheckIntervalMs)

  // WebSocket 路由
  app.register(async function wsPlugin(app) {
    app.get('/ws', { websocket: true }, (socket, req) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown'
      const ua = req.headers['user-agent'] ?? ''
      const isHost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'

      const url = new URL(req.url || '/ws', `http://${req.headers.host}`)
      const clientName = url.searchParams.get('deviceName') || undefined

      const device = deviceMgr.register(socket, ua, ip, isHost, clientName)

      socket.send(JSON.stringify({
        type: 'device:hello',
        payload: { deviceId: device.deviceId, displayName: device.displayName }
      }))
      socket.send(JSON.stringify({
        type: 'device:list',
        payload: { devices: deviceMgr.list() }
      }))
      groupMgr.sendList(device.deviceId)
      for (const transfer of transferMgr.listForDevice(device.deviceId).filter(t => t.groupId)) {
        sendTransferSnapshot(device.deviceId, transfer)
      }

      socket.on('message', (raw: Buffer) => {
        let msg: WsMessage
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }

        switch (msg.type) {
          case 'ping':
            deviceMgr.heartbeat(device.deviceId)
            socket.send(JSON.stringify({ type: 'pong' }))
            break

          case 'device:rename':
            if (msg.payload && 'displayName' in msg.payload) {
              deviceMgr.rename(device.deviceId, msg.payload.displayName)
            }
            break

          case 'group:create':
            if (msg.payload) {
              const group = groupMgr.create({
                ownerDeviceId: device.deviceId,
                ownerName: device.displayName,
                name: msg.payload.name,
              })
              deviceMgr.send(device.deviceId, {
                type: 'group:created',
                payload: { group }
              })
            }
            break

          case 'transfer:offer':
            if (msg.payload && 'files' in msg.payload && msg.payload.toDeviceId) {
              transferMgr.createOffer({
                fromDeviceId: device.deviceId,
                toDeviceId: msg.payload.toDeviceId,
                files: msg.payload.files,
                message: msg.payload.message,
              })
            } else if (msg.payload && 'files' in msg.payload && msg.payload.groupId) {
              const group = groupMgr.get(msg.payload.groupId)
              if (!group) {
                deviceMgr.send(device.deviceId, {
                  type: 'transfer:error',
                  payload: { transferId: '', error: '群聊不存在' }
                })
                break
              }
              transferMgr.createGroupOffer({
                fromDeviceId: device.deviceId,
                groupId: group.groupId,
                groupName: group.name,
                files: msg.payload.files,
                message: msg.payload.message,
              })
            }
            break

          case 'transfer:accept':
            // 接收端接受传输 → 通知发送端开始上传
            if (msg.payload && 'transferId' in msg.payload) {
              transferMgr.acceptTransfer(msg.payload.transferId, device.deviceId)
            }
            break

          case 'transfer:reject':
            // 接收端拒绝传输
            if (msg.payload && 'transferId' in msg.payload) {
              transferMgr.rejectTransfer(msg.payload.transferId, device.deviceId)
            }
            break

          case 'transfer:cancel':
            if (msg.payload && 'transferId' in msg.payload) {
              transferMgr.cancel(msg.payload.transferId, '用户取消')
            }
            break
        }
      })

      socket.on('close', () => {
        transferMgr.handleSenderDisconnect(device.deviceId)
        deviceMgr.unregister(device.deviceId)
      })
    })
  })

  // 端口顺延
  const basePort = options.port ?? config.port
  let actualPort = basePort
  async function tryListen(port: number): Promise<number> {
    try {
      await app.listen({ port, host: config.bindHost })
      return port
    } catch (e: any) {
      if (e.code === 'EADDRINUSE' && port - basePort < config.maxPortRetries) {
        return tryListen(port + 1)
      }
      throw e
    }
  }

  // API 路由
  registerUploadRoutes(app, transferMgr)
  registerDownloadRoutes(app, transferMgr, storage)
  registerPreviewRoutes(app, transferMgr, storage)
  registerStreamRoutes(app, transferMgr, storage)
  registerMetaRoutes(app, () => actualPort)

  // 静态资源
  const candidates = options.staticDir
    ? [options.staticDir]
    : [
        path.resolve(process.cwd(), 'dist/web'),
        path.resolve(process.cwd(), 'web/dist'),
      ]
  const staticPath = candidates.find(p => fs.existsSync(p)) || null

  if (staticPath) {
    await app.register(fastifyStatic, {
      root: staticPath,
      prefix: '/',
      wildcard: false,
    })

    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'not found' })
      }
      return reply.sendFile('index.html')
    })
  }

  actualPort = await tryListen(basePort)

  const ips = listLanIPv4()
  const urls = ips.map(ip => `http://${ip}:${actualPort}`)

  const close = async () => {
    clearInterval(heartbeatInterval)
    transferMgr.destroy()
    await app.close()
    log('info', '服务已关闭')
  }

  return { app, port: actualPort, ips, urls, close }
}
