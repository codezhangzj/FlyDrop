# 发版指南（Releasing）

本项目通过 GitHub Actions 自动打包 macOS（`.dmg`）和 Windows（`.exe`）桌面应用，并发布到 GitHub Release。本文档说明发版的标准流程和必须注意的约定。

## 快速发版

发版只需要推一个新 tag：

```bash
# 1. 确保 main 已是最新、改动已提交并推送
git push origin main

# 2. 打一个新的版本 tag（必须是没用过的版本号）
git tag v0.1.6
git push origin v0.1.6
```

推送 tag 后，GitHub Actions 的 `Package Desktop Apps` 工作流会自动：

1. 跑测试 + 构建（`test` job）
2. 在真实 macOS / Windows 机器上分别打包 `.dmg` / `.exe`
3. 把产物上传到对应 tag 的 GitHub Release

整个流程约 5-10 分钟。跑完后到 Release 页面刷新，「Assets」区会出现 `.dmg`、`.exe` 及其 `.blockmap` 文件。

> 也可以在 GitHub 仓库的 **Actions** 页面手动点 **Run workflow** 触发（`workflow_dispatch`），但手动触发不会创建 Release、只产出 artifacts。

## 版本号

- **版本号会在打包时从 tag 自动注入**到 `package.json`（tag `v0.1.6` → 版本 `0.1.6`），所以产物文件名永远和 tag 一致，**无需手动改 `package.json` 再提交**。
- 仍建议发版前把 `package.json` 的 `version` 同步改成目标版本并提交，让仓库里的版本号保持诚实。`test` job 会在版本不一致时给出 warning 提醒（不会阻断打包）。
- 设置页「关于」显示的版本号会在前端构建时从 `package.json` 自动注入（vite `define` → `__APP_VERSION__`），无需手动维护。

## 重要约定（不知道就会踩）

### tag 不能复用

每次发版必须用**新的、递增的**版本号。已经推送过的 tag 指向旧 commit，重复使用不会包含新改动。如果一次发版失败需要重试，要么删掉远程 tag 重推，要么直接用下一个版本号（推荐后者，更干净）。

### Windows 只支持 x64 / ia32

当前 `sharp` 锁定在 `0.33.5`，它**没有 `win32-arm64` 预编译二进制**。因此 Windows 只打 x64（默认）和 ia32，不能打 arm64——强行打会得到「安装后启动崩溃」的应用。打包脚本（`scripts/package-win.cmd` / `.sh`）已对 arm64 做了拦截。

### sharp 与 Electron 版本是绑定的

`sharp 0.33.x` 要求 Node ≥ 18.17，对应 **Electron 必须 ≥ 23**。本项目打包用 Electron 33。

- 不要为了兼容 Windows 7 把 Electron 降到 22（它内置 Node 16，会导致 sharp 原生模块加载失败、应用启动即崩）。
- 如果将来确实要支持 Win7，必须同时把 `sharp` 降级到支持 Node 16 的 `0.32.x`，两者要一起改。

### macOS 包未签名

未配置 Apple 开发者证书时，打出的 `.dmg` 没有代码签名。用户首次打开会被 Gatekeeper 拦截，需要**右键点应用 →「打开」**手动允许一次。自用和内部分发无影响；正式上架或大规模分发才需要购买签名证书（约 $99/年）。

### 国内网络

Electron 二进制默认从 npmmirror（淘宝镜像）下载（见 `.npmrc`），CI 上已生效。本地打包若下载慢，确认镜像配置即可。

## 工作流文件

发版流程定义在 `.github/workflows/package.yml`，包含四个 job：

- `test`：测试 + 构建 + 版本一致性提醒（ubuntu）
- `package-macos`：注入版本 → 打 `.dmg`（macos）
- `package-windows`：注入版本 → 打 `.exe`（windows）
- `release`：把所有产物上传到 Release（仅 tag 触发）

打包脚本本体在 `scripts/package-mac.sh`、`scripts/package-win.cmd`（CI 用）、`scripts/package-win.sh`（本地用）。

## 本地打包（可选）

需要在对应平台上执行：

```bash
npm run package:mac   # 在 macOS 上，产出 release/*.dmg
npm run package:win   # 在 Windows 上，产出 release/*.exe
```

跨平台本地打包（如 macOS 上打 Windows 包）需额外安装 Wine，且不如 CI 在原生平台打包稳定，推荐优先用 CI。
