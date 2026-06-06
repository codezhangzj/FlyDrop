# 任务清单：局域网文件传输系统

## Task 1: 项目脚手架搭建
- [x] 初始化 monorepo 结构（server/ + web/）
- [x] 配置 package.json、tsconfig.json
- [x] 安装服务端依赖（fastify, @fastify/websocket, @fastify/multipart, @fastify/static）
- [x] 安装前端依赖（vue3, vite, pinia, vue-router）
- [x] 配置开发脚本（dev 同时启动前后端）

## Task 2: 服务端核心启动
- [x] 实现 network.ts（探测局域网 IP）
- [x] 实现 config.ts（端口/TTL/分片大小配置）
- [x] 实现 server/index.ts（Fastify 启动 + 端口顺延 + 控制台输出）
- [x] 二维码生成（qrcode 库 + /api/qrcode 路由）

## Task 3: 设备管理与 WebSocket 信令
- [x] 实现 DeviceRegistry（注册/注销/心跳/超时清理/广播节流）
- [x] 实现 WS Hub（连接管理、消息分发）
- [x] 实现消息处理器（device:hello/rename, transfer:offer/accept/cancel）

## Task 4: 传输管理与存储
- [x] 实现 StorageManager（分块写入/拼接/清理）
- [x] 实现 TransferManager（状态机/createOffer/ingestChunk/finalize）
- [x] 实现过期清理定时器

## Task 5: HTTP 路由（上传/下载/预览）
- [x] POST /api/upload（分片上传）
- [x] GET /api/upload/status（断点续传查询）
- [x] GET /api/download/:transferId/:fileId（单文件 Range 下载）
- [x] GET /api/download/:transferId（多文件 zip）
- [x] GET /api/preview/:transferId/:fileId（图片缩略图）

## Task 6: 前端基础框架
- [x] Vue 3 + Vite 项目结构
- [x] Pinia stores（devices, transfers）
- [x] WebSocket 客户端封装（自动重连）
- [x] 响应式布局组件（手机/平板/桌面断点切换）
- [x] Vue Router 路由配置

## Task 7: 前端视图实现
- [x] 设备列表视图（DevicesView）
- [x] 发送视图（SendView）— 文件选择/拖拽/粘贴截图/分块上传/进度
- [x] 收件箱视图（InboxView）— 接收文件列表/下载/图片预览

## Task 8: 前后端集成与联调
- [x] Vite 代理配置（开发模式代理 /api 和 /ws 到后端）
- [x] 生产模式下 Fastify 托管 web/dist 静态资源
- [x] 启动后自动打开浏览器（可选）
