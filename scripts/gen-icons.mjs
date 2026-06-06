// 生成品牌图标：应用图标 / 托盘图标 / PWA 图标 / favicon
// 设计：靛蓝渐变圆角方块 + 白色纸飞机（发送/传输意象）
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const buildDir = path.join(root, 'build')
const publicDir = path.join(root, 'web/public')
fs.mkdirSync(buildDir, { recursive: true })
fs.mkdirSync(publicDir, { recursive: true })

// 纸飞机 logo SVG
function logoSvg(size, withBg = true) {
  const r = Math.round(size * 0.22)
  const bg = withBg
    ? `<defs>
         <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0%" stop-color="#6366f1"/>
           <stop offset="100%" stop-color="#4f46e5"/>
         </linearGradient>
       </defs>
       <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>`
    : ''
  // 纸飞机路径（在 0..100 视图里设计后按比例缩放）
  const s = size / 100
  const plane = `
    <g transform="translate(${size * 0.5}, ${size * 0.5}) scale(${s})" fill="#ffffff">
      <path transform="translate(-30,-30)"
        d="M58 4 L4 28 L24 36 L26 56 L36 42 L50 52 L58 4 Z M58 4 L24 36 L26 56 L34 40 Z"
        fill="#ffffff" opacity="0.96"/>
    </g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg}
    ${plane}
  </svg>`
}

async function gen() {
  // 应用图标（electron-builder 用，>=512）
  await sharp(Buffer.from(logoSvg(1024))).png().toFile(path.join(buildDir, 'icon.png'))
  console.log('✓ build/icon.png (1024)')

  // 托盘图标
  await sharp(Buffer.from(logoSvg(32))).png().toFile(path.join(buildDir, 'tray-icon.png'))
  console.log('✓ build/tray-icon.png (32)')

  // PWA 图标
  await sharp(Buffer.from(logoSvg(192))).png().toFile(path.join(publicDir, 'icon-192.png'))
  await sharp(Buffer.from(logoSvg(512))).png().toFile(path.join(publicDir, 'icon-512.png'))
  console.log('✓ web/public/icon-192.png, icon-512.png')

  // favicon（写出 SVG + 32px PNG）
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), logoSvg(64))
  await sharp(Buffer.from(logoSvg(48))).png().toFile(path.join(publicDir, 'favicon.png'))
  console.log('✓ web/public/favicon.svg, favicon.png')
}

gen().catch(e => { console.error(e); process.exit(1) })
