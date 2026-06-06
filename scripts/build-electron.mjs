// 用 esbuild 把 Electron 主进程 + server 代码打包成单个 CommonJS 文件，
// 彻底规避 Electron 打包后 ESM 主入口不执行的问题。
import { build } from 'esbuild'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const outDir = path.join(root, 'dist/electron')
fs.mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [path.join(root, 'electron/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: path.join(outDir, 'main.cjs'),
  // electron 由运行时提供；sharp 是原生模块需保持 external（运行时从 node_modules 加载）。
  // 其余纯 JS 依赖（fastify/archiver/qrcode/uuid/ws 等）全部打包进来，
  // 避免 electron-builder 依赖裁剪遗漏传递依赖。
  external: ['electron', 'sharp'],
  logLevel: 'info',
})

// 复制 preload 脚本到输出目录（main.cjs 同级）
fs.copyFileSync(
  path.join(root, 'electron/preload.cjs'),
  path.join(outDir, 'preload.cjs')
)

console.log('✓ Electron 主进程已打包 -> dist/electron/main.cjs')
