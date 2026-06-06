import QRCode from 'qrcode'
import { startServer } from './createServer.js'
import { config } from './config.js'
import { log } from './utils/logger.js'

async function main() {
  const server = await startServer()
  const { port, urls } = server

  // 打印启动信息
  console.log('')
  console.log('┌─────────────────────────────────────────────────┐')
  console.log('│         🚀 飞传 FlyDrop v0.1.0                  │')
  console.log('├─────────────────────────────────────────────────┤')
  if (urls.length > 0) {
    console.log('│  打开手机浏览器访问：                           │')
    for (const url of urls) {
      console.log(`│    ${url.padEnd(43)}│`)
    }
  } else {
    console.log(`│    http://localhost:${port}`.padEnd(50) + '│')
  }
  console.log('├─────────────────────────────────────────────────┤')
  console.log('│  按 Ctrl+C 停止服务                             │')
  console.log('└─────────────────────────────────────────────────┘')
  console.log('')

  // 终端二维码
  if (urls.length > 0) {
    try {
      const qrText = await QRCode.toString(urls[0], { type: 'terminal', small: true })
      console.log(qrText)
    } catch {}
  }

  // 优雅退出
  process.on('SIGINT', async () => {
    log('info', '正在关闭服务...')
    await server.close()
    process.exit(0)
  })
}

main().catch(e => {
  console.error('启动失败:', e)
  process.exit(1)
})
