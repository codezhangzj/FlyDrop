import type { FastifyInstance } from 'fastify'
import QRCode from 'qrcode'
import { listLanIPv4 } from '../network.js'
import { config } from '../config.js'

export function registerMetaRoutes(app: FastifyInstance, getPort: () => number) {
  // 二维码 PNG
  app.get('/api/qrcode', async (req, reply) => {
    const ip = listLanIPv4()[0] || '127.0.0.1'
    const url = `http://${ip}:${getPort()}`

    const png = await QRCode.toBuffer(url, {
      type: 'png',
      width: 256,
      margin: 2,
    })

    reply.header('Content-Type', 'image/png')
    reply.header('Cache-Control', 'no-cache')
    return reply.send(png)
  })

  // 健康检查
  app.get('/api/health', async () => {
    return { status: 'ok', uptime: process.uptime() }
  })

  // 服务器信息（前端用来知道连接 URL）
  app.get('/api/info', async () => {
    const ips = listLanIPv4()
    const port = getPort()
    return {
      ips,
      port,
      urls: ips.map(ip => `http://${ip}:${port}`)
    }
  })
}
