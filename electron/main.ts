import { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, dialog, session, type DownloadItem } from 'electron'
import path from 'path'
import fs from 'fs'
import QRCode from 'qrcode'
import { startServer, type ServerHandle } from '../server/createServer.js'

// __dirname 由 esbuild 打包为 CJS 后由 Node 原生提供，指向 main.cjs 所在目录

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let server: ServerHandle | null = null

// ---- 应用设置（持久化到 userData/settings.json）----
interface AppSettings {
  downloadDir?: string
}
function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}
function readSettings(): AppSettings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}
function writeSettings(s: AppSettings) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
  } catch {}
}

// 待处理的下载任务：url -> 任务上下文
interface PendingDownload {
  key: string
  fileName: string
  resolve: (r: { ok: boolean; savePath?: string; error?: string }) => void
}
const pendingDownloads = new Map<string, PendingDownload>()
let downloadHandlerInstalled = false

// 单实例锁：避免重复启动占用端口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

/** 下载保存目录（优先使用用户设置） */
function downloadDir(): string {
  const custom = readSettings().downloadDir
  const dir = custom && custom.trim()
    ? custom
    : path.join(app.getPath('downloads'), 'FlyDrop')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 处理文件名重名：foo.txt -> foo (1).txt */
function uniqueSavePath(dir: string, fileName: string): string {
  let candidate = path.join(dir, fileName)
  if (!fs.existsSync(candidate)) return candidate
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)
  let i = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`)
    i++
  }
  return candidate
}

/** 安装一次性的全局下载监听（session.will-download） */
function installDownloadHandler() {
  if (downloadHandlerInstalled) return
  downloadHandlerInstalled = true

  session.defaultSession.on('will-download', (_event, item: DownloadItem) => {
    const url = item.getURL()
    const pd = pendingDownloads.get(url)
    if (!pd) return // 非受控下载，走默认行为

    const savePath = uniqueSavePath(downloadDir(), pd.fileName)
    item.setSavePath(savePath)

    item.on('updated', (_e, state) => {
      if (state === 'progressing') {
        const received = item.getReceivedBytes()
        const total = item.getTotalBytes()
        mainWindow?.webContents.send('download-progress', { key: pd.key, received, total })
      }
    })

    item.once('done', (_e, state) => {
      pendingDownloads.delete(url)
      if (state === 'completed') {
        pd.resolve({ ok: true, savePath })
      } else {
        pd.resolve({ ok: false, error: state })
      }
    })
  })
}

/**
 * 解析前端静态资源目录。
 * 打包后位于 resources/web，开发时位于 dist/web。
 */
function resolveStaticDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web')
  }
  // 开发态：__dirname = <root>/dist/electron，目标 <root>/dist/web
  const candidates = [
    path.join(__dirname, '../web'),
    path.join(__dirname, '../../dist/web'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[0]
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    title: '飞传 FlyDrop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  // 加载本地服务页面（localhost 即主机自身设备）
  if (server) {
    await mainWindow.loadURL(`http://localhost:${server.port}`)
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 关闭窗口时隐藏到托盘而非退出
  mainWindow.on('close', (e) => {
    if (!(app as any).isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * 创建托盘图标与菜单。
 */
function createTray() {
  const trayIconName = process.platform === 'darwin'
    ? 'tray-iconTemplate.png'
    : 'tray-icon.png'
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, trayIconName)
    : path.join(__dirname, '../../build', trayIconName)

  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    // 兜底：生成一个 1x1 占位，避免托盘创建失败
    image = nativeImage.createEmpty()
  }
  // macOS 托盘图标建议用模板图
  if (process.platform === 'darwin' && !image.isEmpty()) {
    image.setTemplateImage(true)
  }

  tray = new Tray(image)
  tray.setToolTip('飞传 FlyDrop')
  rebuildTrayMenu()

  tray.on('click', () => showWindow())
}

function rebuildTrayMenu() {
  if (!tray) return
  const urls = server?.urls ?? []
  const urlItems = urls.length > 0
    ? urls.map(url => ({ label: url, click: () => shell.openExternal(url) }))
    : [{ label: '未检测到局域网地址', enabled: false }]

  const menu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => showWindow() },
    { type: 'separator' },
    { label: '访问地址（点击在浏览器打开）', enabled: false },
    ...urlItems,
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ])
  tray.setContextMenu(menu)
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

function quitApp() {
  ;(app as any).isQuitting = true
  app.quit()
}

// IPC：前端向主进程索取服务信息（地址 + 二维码 DataURL）
ipcMain.handle('get-server-info', async () => {
  if (!server) return null
  let qrDataUrl: string | null = null
  if (server.urls[0]) {
    try {
      qrDataUrl = await QRCode.toDataURL(server.urls[0], { width: 240, margin: 2 })
    } catch {}
  }
  return {
    port: server.port,
    ips: server.ips,
    urls: server.urls,
    qrDataUrl,
    isDesktop: true,
  }
})

// IPC：下载文件（带进度），返回保存路径
ipcMain.handle('download-file', async (_e, opts: { url: string; fileName: string; key: string }) => {
  if (!server || !mainWindow) return { ok: false, error: 'no server' }
  // 相对路径补全为本机服务地址
  const fullUrl = opts.url.startsWith('http')
    ? opts.url
    : `http://localhost:${server.port}${opts.url}`

  return new Promise<{ ok: boolean; savePath?: string; error?: string }>((resolve) => {
    pendingDownloads.set(fullUrl, { key: opts.key, fileName: opts.fileName, resolve })
    mainWindow!.webContents.downloadURL(fullUrl)
    // 安全超时：60s 无结果则失败
    setTimeout(() => {
      if (pendingDownloads.has(fullUrl)) {
        pendingDownloads.delete(fullUrl)
        resolve({ ok: false, error: 'timeout' })
      }
    }, 60_000)
  })
})

// IPC：在系统文件管理器中定位文件
ipcMain.handle('reveal-file', async (_e, savePath: string) => {
  if (savePath && fs.existsSync(savePath)) {
    shell.showItemInFolder(savePath)
    return true
  }
  return false
})

// IPC：获取应用设置
ipcMain.handle('get-app-settings', async () => {
  return {
    downloadDir: downloadDir(),
    autoLaunch: app.getLoginItemSettings().openAtLogin,
  }
})

// IPC：选择下载目录
ipcMain.handle('choose-download-dir', async () => {
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择下载目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (res.canceled || res.filePaths.length === 0) return null
  const dir = res.filePaths[0]
  const s = readSettings()
  s.downloadDir = dir
  writeSettings(s)
  return dir
})

// IPC：设置开机自启
ipcMain.handle('set-auto-launch', async (_e, enabled: boolean) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled })
  return app.getLoginItemSettings().openAtLogin
})

// IPC：打开下载目录
ipcMain.handle('open-download-dir', async () => {
  shell.openPath(downloadDir())
  return true
})

app.on('second-instance', () => showWindow())

app.whenReady().then(async () => {
  // 清理历史遗留的 Service Worker 与缓存存储，避免旧缓存导致白屏
  try {
    await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
  } catch {}
  try {
    const staticDir = resolveStaticDir()
    server = await startServer({ staticDir })
  } catch (e) {
    console.error('服务启动失败:', e)
  }
  installDownloadHandler()
  try {
    createTray()
  } catch (e) {
    console.error('托盘创建失败:', e)
  }
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
})

// 全部窗口关闭时不退出（常驻托盘）
app.on('window-all-closed', () => {
  // 保持后台运行，由托盘控制退出
})

app.on('before-quit', async () => {
  ;(app as any).isQuitting = true
  if (server) {
    await server.close().catch(() => {})
    server = null
  }
})
