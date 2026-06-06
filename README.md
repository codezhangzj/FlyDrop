# 飞传 FlyDrop ✈️

零配置局域网文件传输工具。在主机电脑上启动服务，局域网内的手机、平板通过浏览器访问即可互传文件，无需安装任何 App。

## 特性

**传输**
- **零安装**：客户端只需浏览器；桌面端可打包为独立应用
- **任意互传**：任何设备之间都能互相发送文件（手机↔电脑、手机↔手机）
- **大文件支持**：4MB 分片上传、3 并发、断点续传
- **完整性校验**：拼接后校验文件大小，发现传输截断/丢块即标记失败
- **传输可取消**：发送过程中可随时取消

**交互与确认**
- **接收确认**：收到文件先弹窗确认（接受/拒绝），防止陌生设备静默推送
- **发送文件 / 文本 / 截图**：选择文件、拖拽、Ctrl+V 粘贴截图，或直接发送文本/链接
- **拖拽发送**：把文件拖到设备卡片、或拖到窗口任意处再选设备即可发送
- **发送预览**：选中后列表显示图片缩略图 / 视频图标，发送前可确认
- **进度反馈**：发送/接收/下载均显示进度 + 速度 + 剩余时间（ETA）

**接收端预览（无需下载即可查看）**
- **图片**：缩略图，点击放大查看原图
- **视频**：本地抓取首帧作为缩略图，点击内联播放（流式，边播边传）
- **文本**：内联展示，一键复制
- 预览走独立流式端点，不影响"是否已保存"的状态

**下载与提醒**
- **下载管理**：进度、速度/ETA、状态标记（未下载/下载中/已下载/失败）
- **定位文件**：桌面端下载后可一键在 Finder / 资源管理器中定位
- **通知提醒**：系统通知 + 提示音 + 收件箱角标
- **传输记录**：本地持久化，可清空

**体验**
- **响应式 UI**：自适应手机、平板、桌面三种布局
- **设备发现与改名**：实时发现在线设备，可重命名本机
- **连接状态指示**：顶栏显示已连接/重连中/已断开
- **首次引导**：首次打开展示使用引导
- **设置中心**：主题（跟随系统/浅色/深色）、通知与提示音开关；桌面端可设下载目录、开机自启
- **无障碍**：键盘可达、`aria` 标签、焦点可见、尊重「减少动态效果」偏好
- **暗色模式**：自动跟随系统或手动指定

**安全**
- 下载/预览需校验请求设备身份，仅接收方可访问
- 文件名安全过滤，防目录穿越
- 临时文件 TTL 自动清理

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（前后端同时启动）
npm run dev

# 生产构建
npm run build

# 启动（生产模式）
npm start

# 快捷预览（构建前端 + 启动服务）
npm run preview

# 运行测试
npm test
```

## 桌面端（Mac / Windows）

本项目可打包成带窗口和托盘的桌面应用（基于 Electron）。桌面端会内置服务，启动后自动开窗，并在设备列表页展示二维码 + 局域网地址，方便手机扫码连入。

```bash
# 桌面端开发调试（构建前端 + 主进程后用 Electron 启动）
npm run electron:dev

# 打包当前平台
npm run dist

# 仅打包 macOS（产出 release/*.dmg）
npm run dist:mac

# 一键打包 macOS（自动检查依赖、生成图标、清理旧产物并输出 release/*.dmg）
npm run package:mac

# 一键打包 Windows（默认同时产出 x64 + ia32 安装包，兼容 Win7 / Win10 / Win11）
npm run package:win

# 仅打包 Windows（产出 release/*.exe，需在 Windows 或 CI 上构建）
npm run dist:win
```

打包产物在 `release/` 目录。

说明：
- macOS 上可直接构建 Mac 包；Windows 包通常需在 Windows 机器或 CI（如 GitHub Actions）上构建。
- Win7 兼容需要使用 Electron 22；`npm run package:win` 会自动用 Electron 22.3.27 打包 Windows 版。Electron 23+ 已不支持 Windows 7/8/8.1。
- 未配置代码签名时，首次打开会被 Gatekeeper / SmartScreen 拦截，需手动允许（自用无妨）。
- 国内网络下载 Electron 二进制较慢，项目已在 `.npmrc` 配置淘宝镜像加速。
- 主进程通过 esbuild 打包为单个 CommonJS 文件（`dist/electron/main.cjs`），原生模块 `sharp` 保持外置。

## GitHub Actions 自动打包

项目已配置 `.github/workflows/package.yml`：

- 在 GitHub 的 Actions 页面可手动运行 `Package Desktop Apps`
- 推送 `v*` tag（如 `v0.1.0`）会自动打包 macOS / Windows，并创建 GitHub Release 上传安装包

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 使用方法

1. 在电脑上运行桌面应用，或 `npm run preview` / `npm start`
2. 终端（或设备列表页）会显示局域网访问地址（如 `http://192.168.1.10:5180`）和二维码
3. 手机 / 平板连接同一 Wi-Fi，扫码或在浏览器中打开该地址
4. 电脑端能看到设备上线，点击设备即可发送文件；也可把文件直接拖到设备卡片上
5. 接收方在弹窗确认接收，随后可在「收件箱」中预览或下载

> 提示：从手机相册选视频时，系统需要先导出文件（选择器内自带小转圈），导出完成后我方会显示「正在读取文件」直至就绪——这是正常流程，并非卡死。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 5180 | 服务端口（被占用时自动顺延） |
| `BIND` | 0.0.0.0 | 监听地址 |
| `AUTO_OPEN` | false | 启动后自动打开浏览器 |

桌面端的下载目录、开机自启可在「设置」中调整。

## 技术栈

- **后端**：Node.js + Fastify + @fastify/websocket + @fastify/multipart + sharp（图片缩略图）
- **前端**：Vue 3 + Vite + Pinia + Vue Router + Lucide 图标
- **桌面端**：Electron（esbuild 打包主进程）+ electron-builder
- **测试**：Vitest + fast-check（含属性测试）
- **传输**：HTTP 分片上传 + WebSocket 信令 + Range 下载/流式预览

## HTTP / WebSocket 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/ws` | WebSocket：设备发现、信令、进度推送 |
| POST | `/api/upload` | 分片上传 |
| GET | `/api/upload/status` | 查询已接收分片（断点续传） |
| GET | `/api/download/:transferId/:fileId` | 单文件下载（Range，触发"已完成"） |
| GET | `/api/download/:transferId` | 多文件 ZIP 打包下载 |
| GET | `/api/stream/:transferId/:fileId` | 流式预览（Range，不触发"已完成"） |
| GET | `/api/preview/:transferId/:fileId` | 图片缩略图 |
| GET | `/api/qrcode` / `/api/info` / `/api/health` | 二维码 / 服务信息 / 健康检查 |

所有下载/预览接口需在查询参数携带 `deviceId`，仅接收方可访问。

## 传输流程

```
发送方                       服务端                       接收方
  │── transfer:offer ────────▶│                            │
  │◀── transfer:created ──────│── transfer:offer ─────────▶│ (弹窗确认)
  │                           │◀── transfer:accept ────────│
  │◀── transfer:accept ───────│                            │
  │── HTTP 分片上传 ─────────▶│ (落盘+完整性校验)          │
  │◀── transfer:progress ─────│── transfer:progress ──────▶│
  │                           │── transfer:ready ─────────▶│ (可预览/下载)
  │◀── transfer:done ─────────│◀── HTTP 下载/流式预览 ─────│
```

## 项目结构

```
FlyDrop/
├── server/                 # 服务端
│   ├── index.ts           # CLI 入口
│   ├── createServer.ts    # 服务装配（CLI 与 Electron 共用）
│   ├── config.ts          # 配置
│   ├── network.ts         # 局域网 IP 探测
│   ├── deviceManager.ts   # 设备管理
│   ├── transferManager.ts # 传输状态机 / 分片 / 完整性校验
│   ├── storage.ts         # 临时文件存储
│   ├── routes/            # upload / download / stream / preview / meta
│   └── utils/             # id / ua / sanitize / logger
├── web/                    # 前端 Vue SPA
│   ├── src/
│   │   ├── views/         # Devices / Send / Inbox / Settings
│   │   ├── components/    # Toast / IncomingOffer / Onboarding
│   │   ├── stores/        # devices / transfers / settings
│   │   ├── services/      # ws / upload / desktop / notify / format / videoThumb 等
│   │   └── styles/        # 全局样式
│   └── public/            # 图标 / manifest
├── electron/              # 桌面端主进程 + preload
├── tests/                 # vitest 单元 / 属性测试
├── scripts/               # 图标生成 / electron 打包脚本
└── package.json
```

## License

MIT
