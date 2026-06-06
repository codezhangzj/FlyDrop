const { contextBridge, ipcRenderer } = require('electron')

// 暴露给前端的安全 API
contextBridge.exposeInMainWorld('desktopAPI', {
  // 标记当前运行在桌面端
  isDesktop: true,
  // 获取服务信息（局域网地址 + 二维码）
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  // 下载文件到本地（带进度），返回保存路径
  downloadFile: (opts) => ipcRenderer.invoke('download-file', opts),
  // 在系统文件管理器中定位文件
  revealFile: (savePath) => ipcRenderer.invoke('reveal-file', savePath),
  // 订阅下载进度事件，返回取消订阅函数
  onDownloadProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('download-progress', listener)
    return () => ipcRenderer.removeListener('download-progress', listener)
  },
  // 设置相关
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  chooseDownloadDir: () => ipcRenderer.invoke('choose-download-dir'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  openDownloadDir: () => ipcRenderer.invoke('open-download-dir'),
})
