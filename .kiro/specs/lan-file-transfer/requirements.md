# 需求文档：局域网文件传输系统（lan-file-transfer）

## 背景与目标

在用户主机电脑上运行一个零配置的局域网文件 / 图片传输服务。局域网内的其他设备（手机、平板、其他电脑）通过浏览器访问 `http://<主机局域网IP>:<端口>` 即可加入会话；主机端可看到所有已连入设备并发起传输；目标设备在浏览器中下载文件。前端响应式，自适应手机与平板。

技术栈：Node.js (>=18) + Fastify + @fastify/websocket + Vue 3 + Vite。
默认不启用 PIN 配对（局域网即受信任）。

---

## Requirement 1：服务启动与访问入口

**用户故事**：作为主机用户，我希望启动程序后立刻看到可被局域网其他设备访问的地址，以便我把地址告诉手机或平板使用者。

**验收标准**（EARS）：

1. **WHEN** 程序启动 **THE SYSTEM SHALL** 在默认端口（5180）监听 `0.0.0.0` 并提供 HTTP + WebSocket 服务。
2. **WHEN** 程序启动 **THE SYSTEM SHALL** 探测主机所有非回环、非虚拟网卡的局域网 IPv4 地址，并按 `192.168.* > 10.* > 172.16-31.*` 优先级排序后打印到控制台。
3. **WHEN** 默认端口被占用 **THE SYSTEM SHALL** 自动顺延端口最多 10 次后再退出报错。
4. **WHEN** 程序启动 **THE SYSTEM SHALL** 控制台输出可访问的完整 URL（`http://<lan-ip>:<port>`）以及对应的 ASCII 二维码，并提供 `/api/qrcode` 路由返回 PNG 二维码。
5. **THE SYSTEM SHALL** 通过 `PORT` / `BIND` 环境变量允许覆盖端口与监听地址。

---

## Requirement 2：响应式 Web 前端

**用户故事**：作为手机或平板用户，我希望访问页面时排版自适应我的屏幕，触控操作顺手。

**验收标准**：

1. **WHEN** 浏览器访问根路径 **THE SYSTEM SHALL** 返回单页应用（Vue 3 SPA），并在断点 `<640px / 640–1024px / >1024px` 下分别使用手机、平板、桌面三套布局。
2. **THE SYSTEM SHALL** 在手机布局下使用底部 Tab 导航，在平板及桌面布局下使用侧边栏导航。
3. **THE SYSTEM SHALL** 所有可点击元素的最小触控区不小于 44×44 px。
4. **THE SYSTEM SHALL** 根据 `prefers-color-scheme` 自动切换暗色 / 亮色主题。
5. **THE SYSTEM SHALL** 提供 manifest.json 与基础 Service Worker 以支持"添加到主屏幕"。

---

## Requirement 3：设备注册与设备发现

**用户故事**：作为主机用户，我希望任何设备一打开页面就出现在我的设备列表中，便于我选择目标设备。

**验收标准**：

1. **WHEN** 客户端建立 WebSocket 连接 **THE SYSTEM SHALL** 为该设备分配唯一 `deviceId`（UUID v4），按 User-Agent 推断 `deviceType`（PHONE / TABLET / DESKTOP / UNKNOWN），生成默认 `deviceName`。
2. **WHEN** 任何设备上线、下线、改名 **THE SYSTEM SHALL** 通过 WebSocket 向所有在线连接广播最新设备列表。
3. **WHEN** 客户端发送 `device:rename` 消息 **THE SYSTEM SHALL** 在校验长度（1–32）后更新 `deviceName` 并广播。
4. **WHEN** 设备 `lastHeartbeatAt` 超出心跳超时（默认 30s） **THE SYSTEM SHALL** 移除该设备并广播列表更新。
5. **THE SYSTEM SHALL** 列表广播做节流（debounce ≥ 100ms）防止抖动风暴。
6. **THE SYSTEM SHALL** 主机本机自身也以 `isHost=true` 的 Device 形态出现在列表中。

---

## Requirement 4：发起传输（信令）

**用户故事**：作为发送方，我希望选中目标设备后立刻发起传输，目标设备能马上感知到。

**验收标准**：

1. **WHEN** 客户端发送 `transfer:offer`（含 `toDeviceId` 与 `files[]`） **THE SYSTEM SHALL** 校验目标设备在线，生成 `transferId`，落库为 `PENDING` 状态，并向目标设备推送 `transfer:offer` 信令。
2. **IF** 目标设备不在线 **THEN THE SYSTEM SHALL** 向发起方返回 `transfer:error` 并不创建任务。
3. **THE SYSTEM SHALL** 一次 offer 至少包含 1 个 `FileMeta`（`fileName`、`totalSize`、`totalChunks`、`chunkSize`、`mime`），文件名经路径穿越过滤。
4. **THE SYSTEM SHALL** 任意客户端均可作为发起方（任意 ↔ 任意，主机仅做中继）。
5. **THE SYSTEM SHALL** 默认自动接受 offer（`transfer:accept`），可后续扩展为手动确认。

---

## Requirement 5：分片上传与进度

**用户故事**：作为发送方，我希望大文件也能稳定上传，过程中能看到进度。

**验收标准**：

1. **THE SYSTEM SHALL** 提供 `POST /api/upload`（multipart/form-data：`transferId, fileId, chunkIndex, chunk`），按 `transferId/fileId/chunkIndex` 落盘到临时分块目录。
2. **THE SYSTEM SHALL** 默认分片大小 4MB，可由前端按文件大小生成 `totalChunks`。
3. **THE SYSTEM SHALL** 同一 `(transferId, fileId, chunkIndex)` 重复上传必须幂等：不破坏已接收集合，不重复累计进度字节。
4. **WHEN** 单个分片落盘成功 **THE SYSTEM SHALL** 通过 WebSocket 向发送方与接收方推送 `transfer:progress`（`uploadedBytes`、`totalBytes`）。
5. **WHEN** 一个 `FileMeta` 的所有分片到齐 **THE SYSTEM SHALL** 流式拼接为最终文件，删除分块目录，文件状态置为 `COMPLETE`。
6. **WHEN** 一个 Transfer 的所有 File 都 `COMPLETE` **THE SYSTEM SHALL** 把任务状态置为 `READY`，并向接收方推送 `transfer:ready`（含下载 URL）。
7. **THE SYSTEM SHALL** 提供 `GET /api/upload/status?transferId=&fileId=` 返回服务端已收到的 `chunkIndex` 列表，供发送端断点续传。
8. **THE SYSTEM SHALL** 单文件大小上限默认 10GB，超限返回 413。

---

## Requirement 6：下载与预览

**用户故事**：作为接收方，我希望在浏览器里直接下载文件，图片可以先预览。

**验收标准**：

1. **THE SYSTEM SHALL** 提供 `GET /api/download/:transferId/:fileId` 返回单文件，支持 HTTP `Range` 与 206 部分响应。
2. **THE SYSTEM SHALL** 提供 `GET /api/download/:transferId` 流式返回多文件 zip 打包结果。
3. **THE SYSTEM SHALL** 下载请求必须校验 `requestingDeviceId == transfer.targetDeviceId`，否则返回 403。
4. **WHEN** `mime` 为 `image/*` **THE SYSTEM SHALL** 通过 `GET /api/preview/:transferId/:fileId` 返回缩略图（最长边 ≤ 512px）。
5. **WHEN** 下载完成 **THE SYSTEM SHALL** 把任务状态置为 `COMPLETED`，并向发送方推送 `transfer:done`。
6. **THE SYSTEM SHALL** 响应头 `Content-Disposition` 中 `filename*=UTF-8''<encoded>` 正确编码中文 / 特殊字符文件名。

---

## Requirement 7：临时存储与生命周期

**用户故事**：作为主机用户，我不希望服务长期累积文件占用磁盘。

**验收标准**：

1. **THE SYSTEM SHALL** 把所有上传内容存放在 `<userTmp>/lan-file-transfer/<transferId>/` 命名空间隔离。
2. **THE SYSTEM SHALL** 每个 Transfer 默认 TTL 24h，过期且未 `COMPLETED` 时由后台任务清理目录并把状态置为 `EXPIRED`。
3. **WHEN** 发送方在传输中关闭浏览器（WS 断开） **THE SYSTEM SHALL** 把对应 `PENDING/UPLOADING` 任务置为 `FAILED` 并清理已写入分块。
4. **THE SYSTEM SHALL** 状态机仅允许合法转移：`PENDING→UPLOADING→READY→COMPLETED`、`*→FAILED`、`PENDING/UPLOADING/READY→EXPIRED`，非法转移必须被拒绝。

---

## Requirement 8：粘贴截图直发

**用户故事**：作为发送方，我希望按 Ctrl+V 把剪贴板中的截图直接发送出去。

**验收标准**：

1. **WHEN** 在发送视图按下 `paste` 且 `clipboardData` 中存在 `image/*` blob **THE SYSTEM SHALL** 把它当作普通文件（默认名 `screenshot-<timestamp>.png`）加入待发送队列。
2. **THE SYSTEM SHALL** 截图作为普通文件走相同的分片上传通道。

---

## Requirement 9：错误处理与可观测性

**用户故事**：作为开发者 / 运维者，我希望出错时有清晰提示，不留下脏数据。

**验收标准**：

1. **WHEN** 校验和不匹配（如客户端提供 `sha256`） **THE SYSTEM SHALL** 把文件置为 `ERROR`、任务置为 `FAILED`，推送 `transfer:error` 并清理分块。
2. **WHEN** 请求体格式非法 / 字段缺失 **THE SYSTEM SHALL** 返回 HTTP 400 + 结构化错误 JSON。
3. **WHEN** 文件名包含 `../`、`/`、`\` 等路径穿越字符 **THE SYSTEM SHALL** 在 `sanitizeName` 阶段过滤；存储路径不直接拼接用户输入。
4. **THE SYSTEM SHALL** 后端使用结构化日志输出（含 `transferId`、`deviceId`、`event`），异常路径不打印文件原始字节。

---

## Requirement 10：测试与质量

**用户故事**：作为开发者，我希望关键不变量有自动化测试保障。

**验收标准**：

1. **THE SYSTEM SHALL** 使用 `vitest` 进行单元测试，核心模块（`DeviceRegistry`、`TransferStore`、`sanitizeName`、状态机）分支覆盖率 ≥ 85%。
2. **THE SYSTEM SHALL** 使用 `fast-check` 编写以下属性测试：
   - 设备 `deviceId` 唯一性（属性 1）。
   - 注册—断开—列表一致性（属性 2）。
   - `writeChunk` 幂等性（属性 3）。
   - `COMPLETE` 完成单调性（属性 4）。
   - 下载授权封闭性（属性 5）。
   - 状态机合法性（属性 6）。
   - `pruneStaleDevices` 正确性（属性 8）。
3. **THE SYSTEM SHALL** 提供端到端集成测试：启动服务 → 模拟两个 WS 客户端 → 主机发起传输 → 分片上传 → 接收方下载 → 校验内容一致。
