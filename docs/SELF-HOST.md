# DSChat 自托管、构建与分发指南

本文面向自行构建、内部部署或二次分发的用户，说明环境准备、开发与打包命令、API Key 的获取与存储、自定义 API 地址、分发合规和常见问题。

DSChat 是 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的 Electron 桌面封装。应用没有自有后端：桌面版的所有 API 请求由主进程代理到构建时配置的 DeepSeek API 服务。每个最终用户使用自己的 API Key。

## 1. 环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Windows 10/11 x64（主要目标）；其他平台未做 v1 验收 |
| Node.js | 22.12 或更高版本（仓库 CI 使用 Node 24） |
| 包管理器 | pnpm（`corepack enable` 或独立安装） |
| 网络 | 首次安装需访问 npm registry；打包时 electron-builder 需下载 Electron / NSIS 产物 |
| 磁盘 | 预留约 1–2 GB 给依赖、Electron 缓存和打包产物 |

Windows 上建议同时准备 Git Bash：上游脚本包含 `rm -rf`、`NODE_ENV=...` 等 POSIX 写法。本桌面版已引入 `rimraf`、`cross-env` 等跨平台依赖；若仍遇到命令不兼容，见[常见问题](#windows-脚本报错)。

## 2. 安装

```bash
git clone <仓库地址>
cd <仓库目录>
pnpm install
```

不要使用 `npm install`：仓库以 `pnpm-lock.yaml` 为准。

## 3. 开发、构建与打包

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动网页版开发服务器，默认 <http://localhost:8090> |
| `pnpm dev:desktop` | 同时启动开发服务器与 Electron，加载 `http://localhost:8090` |
| `pnpm build` | 生产构建，输出到 `dist/`（HTML、JS、CSS、字体、LICENSE） |
| `pnpm start` | 构建并用 Electron 启动桌面应用 |
| `pnpm smoke` | 启动构建产物，页面加载完成后退出（需先构建） |
| `pnpm smoke:blob` | 验证附件 `blob:` 预览子窗口可加载（需先构建） |
| `pnpm dist:dir` | 生成未打包目录版到 `release/`，便于本机验证 |
| `pnpm dist:win` | 生成 Windows 安装包到 `release/` |
| `node tests/smoke.mjs` | 零依赖构建冒烟检查（标题、静态资源、Electron 入口、打包配置） |
| `pnpm type` / `pnpm lint` | 类型检查 / oxlint |

推荐流程：

```bash
pnpm install
node tests/smoke.mjs      # 首次会失败，因为尚未构建
pnpm build
node tests/smoke.mjs      # 构建后应通过
pnpm start                # 本机试运行
pnpm dist:win             # 发布用安装包
```

electron-builder 的输出目录由 [package.json](../package.json) 的 `build.directories.output` 配置，当前为 `release/`。`dist:win` 和 `dist:dir` 会先执行 `pnpm build`，因此无需单独构建。

Electron 主进程还支持页面加载检查：

```bash
pnpm build
pnpm smoke
```

它会加载构建产物，在 `did-finish-load` 或 `did-fail-load` 后退出，并返回相应退出码，适合 CI 或打包前的快速验证。该命令会启动真实 Electron，不能替代 `tests/smoke.mjs` 的静态检查。

### 3.1 测试 provider（千机）构建

默认构建只连接官方 DeepSeek，行为与 0.1.3 完全一致。内部验收可使用独立测试 profile；**测试包不对外分发，也不包含任何 Key**：

```bash
pnpm dist:test   # 产物：release-test/DSChat-0.2.0-qianji-test-x64.exe
```

`DSCHAT_PROFILE=qianji` 写入以下构建期常量（也可用同名 `DSCHAT_*` 变量逐项覆盖）：

| 字段 | 默认（官方） | 千机测试 |
| --- | --- | --- |
| `DSCHAT_API_ORIGIN` | `https://api.deepseek.com` | `https://dygpt.duoyioa.com/qianji` |
| `DSCHAT_MESSAGES_PATH` | `/anthropic/v1` | `/v1` |
| `DSCHAT_MODEL` | `deepseek-flash` | `DS/DeepSeek-V4.1-Flash` |
| `DSCHAT_MODELS_PATH` | `/models` | `/v1/models` |
| `DSCHAT_VERIFY_MODE` | `models` | `message`（1-token POST） |
| `features.files / speech / webTools` | `true` | `false` |

千机测试构建会禁用附件、语音与联网工具，并在按钮 tooltip 与关于页显示明确提示；Key 仍由使用者在设置页输入，经 `safeStorage` 保存，不进入仓库、日志或产物。测试包输出到 `release-test/`，默认 `release/` 始终是官方构建。

## 4. 获取 API Key

1. 登录 [DeepSeek 开放平台](https://platform.deepseek.com/)。
2. 在 API Keys 页面创建一个 Key，并妥善保存（通常只显示一次）。
3. 确认账户余额或充值；密钥有效但余额不足时，应用会提示余额错误。
4. 启动 DSChat，打开设置，粘贴 Key 并确认。应用会先校验再保存。

每个最终用户必须使用自己的 Key。仓库、安装包和示例配置中都不应包含任何真实 Key。

## 5. API Key 的存储与安全

### 桌面版

- 位置：Electron `userData` 目录下的 `secrets.json`。Windows 默认是 `%APPDATA%\DSChat\secrets.json`（应用名由主进程的 `app.setName('DSChat')` 设定）。
- 加密：优先使用 Electron `safeStorage`。Windows 上由 DPAPI 保护，只有当前用户上下文能解密。
- 文件格式（版本 1）：

  ```json
  { "version": 1, "encrypted": true, "apiKey": "<base64 密文>" }
  ```

- 写入采用“临时文件 + rename”，降低进程中断导致文件损坏的风险；设置页提供“清除 API Key”，确认后删除该文件、清空主进程内存，并清理旧 localStorage 键。
- `safeStorage.isEncryptionAvailable()` 返回 false 的少数环境（例如未配置密钥环的 Linux 桌面）不会写明文文件：Key 只保存在本次运行的主进程内存中，设置页显示“未加密/降级”，重启后需要重新输入。Windows 正常安装下会使用系统加密。
- 若主进程保存失败，界面会回滚到之前的状态并提示；桌面端不会把 Key 写入 `localStorage`，也不会写明文 `secrets.json`。排查时应检查 `secrets.json` 的权限和磁盘状态。
- preload 通过 `contextBridge` 只暴露 `isDesktop`、`hasApiKey`、`setApiKey()`、`verifyAndSaveApiKey()`、代理请求/流方法与 `version`；不再暴露解密后的 Key。渲染进程没有 Node.js 权限（`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`）。
- 真实 Key 只出现在主进程内存中；渲染进程既拿不到 Key，也不能直连 API。能控制当前操作系统账户或读取进程内存的恶意软件仍可获取 Key，请使用系统账户加密、及时锁屏，并避免把 `secrets.json` 纳入备份或云同步。

### 网页版

网页版的 API Key 与设置保存在浏览器 `localStorage`，Key 的键名为 `chat-demo:api-key`，为明文。其他设置键包括 `chat-demo:locale`、`chat-demo:theme-preference`、`chat-demo:location`、`chat-demo:tts-voice`、`chat-demo:thinking`、`chat-demo:search`、`chat-demo:sider-collapsed`。仅应在可信浏览器配置文件和可信设备上使用网页版。

从网页版升级到桌面版时，应用会尝试把 `localStorage` 中遗留的 Key 交给主进程迁移；主进程可能加密落盘，也可能因 safeStorage 不可用而只保留在内存中。无论哪种方式，迁移成功后都会删除 localStorage 中的明文旧键。

### 通用原则

- 导出历史 ZIP 不包含 API Key 和设置。
- 日志中不应打印 Key；排障时也不要粘贴完整 Key。
- 不要把 `secrets.json`、`.env` 或包含 Key 的截图提交到仓库。
- 若怀疑泄露，立即在开放平台吊销并重新生成。

## 6. 自定义 API 地址

默认 API 地址是 `https://api.deepseek.com`，在构建时注入为 `__API_ORIGIN__`。要使用兼容网关或自建服务，在**构建时**设置 `DSCHAT_API_ORIGIN`，然后重新构建：

```bash
# Git Bash / macOS / Linux
DSCHAT_API_ORIGIN=https://api.example.com pnpm build

# PowerShell
$env:DSCHAT_API_ORIGIN = "https://api.example.com"
pnpm build

# cmd.exe
set DSCHAT_API_ORIGIN=https://api.example.com && pnpm build
```

注意：

- 该值在构建时固化，不是运行时设置；修改后必须重新执行 `pnpm build`，并重新打包桌面应用。构建脚本会把解析结果写入 `electron/provider-config.json`，主进程用它作为默认 provider 和代理白名单，因此安装包不依赖用户机器上的环境变量。
- 服务需兼容 demo 使用的 Anthropic Messages / Files 协议，并支持搜索、链接阅读、标题、`latest_reminder`、ASR/TTS 等扩展能力。仅实现普通聊天时，对应功能会失败或不可用。
- 使用 HTTPS。自定义网关若能看到请求，也能看到用户的 API Key 与对话内容，必须信任该网关并明确告知用户。
- 桌面版的 Messages、Files、ASR、TTS 与模型校验全部由主进程代理发出，不使用渲染层的 CORS，因此目标服务不需要允许 `dsc://app`；网页版从其他源访问时仍需服务端允许相应 CORS。主进程只允许把代理指向构建期 origin（官方、千机或 `DSCHAT_API_ORIGIN`），单次请求不能指定任意 URL。
- 服务端还需接受请求中的扩展字段（`deepseek_web_search`、`deepseek_read_url`、`title`、`latest_reminder`、`safety_check`、Files API beta）。
- 不要把 `DSCHAT_API_ORIGIN` 当作安全边界：客户端构建产物中的地址可被修改。主进程的 allowlist 只保证“Key 不会被发往构建期配置之外的主机”，不能防止构建者自己指定恶意网关。

## 7. 分发注意事项

1. **许可证**：项目使用 [MIT](../LICENSE)，版权行必须保留。构建会把 `LICENSE` 复制到 `dist/LICENSE`；分发安装包或解压目录时一并提供。第三方依赖（React、Mermaid、KaTeX、Electron 等）遵循各自许可证，发布时建议附带依赖许可清单。
2. **上游署名**：DSChat 基于 `deepseek-ai/chat-demo`。README、关于页面或发布说明中应保留上游项目名称与链接，并说明修改内容。
3. **非官方身份**：不要使用 DeepSeek 的名称、Logo 或域名暗示官方背书。应用名、图标和发布者信息应明确为独立项目。
4. **不内置密钥**：构建产物、安装包、示例文件和 CI 日志中都不得出现真实 API Key。发布前可检查 `secrets.json`、`.env`、`dist/` 和打包目录。
5. **用户数据**：安装包不应包含开发机的 `userData`。升级安装时保留用户已有数据；卸载是否删除数据应由安装器策略明确说明。
6. **签名与 SmartScreen**：当前发布不购买代码签名证书，Windows 安装包未签名，会触发 SmartScreen 警告。发布说明必须明确披露，并提供 SHA-256 校验值（`release/SHA256SUMS.txt`）。签名是可选项，不影响功能。
7. **版本与更新**：版本号取自 `package.json`，会暴露在 preload 的 `desktop.version` 中。当前只做「检查更新 → 打开下载页」，不自动下载或安装。更新源是公开的 GitHub Releases：构建时设置 `DSCHAT_GITHUB_REPO=owner/repo`（或在 `package.json.repository` 中配置），脚本写入 `electron/release-config.json`；未配置时关于页显示“未配置更新源”。私有仓库不支持，因为公开 Updates API 不需要 Token。
8. **可构建性**：MIT 不要求公开修改源码，但建议发布构建说明与对应源码标签，便于用户自行构建和审计。
9. **CI 发布**：`.github/workflows/release.yml` 在推送 `vX.Y.Z` tag 时于 Windows runner 上安装依赖、跑 type/lint/test/test:proxy、构建官方安装包、生成 `SHA256SUMS.txt` 并上传到 GitHub Releases。只发布默认官方包，千机测试包不进入公开 Release。

## 8. 常见问题

### Windows 脚本报错

症状：`'rm' 不是内部或外部命令`、`NODE_ENV 不是内部或外部命令`，或 `pnpm build` 在 PowerShell 中失败。

处理：

- 优先确认当前版本的 `package.json` 已使用 `rimraf`、`cross-env` 等跨平台写法，并重新 `pnpm install`。
- 临时改用 Git Bash 执行构建命令。
- 不要用管理员权限绕过问题；这通常与权限无关。

### 麦克风无法使用

- Windows：设置 → 隐私和安全性 → 麦克风，允许桌面应用访问麦克风。
- 确认没有其他程序独占麦克风，且系统输入设备可用。
- 桌面版只对 `dsc://app`（开发时为 `http://localhost:8090`）放行 `media` 权限，且只允许音频；请求摄像头会被拒绝。
- 网页版要求安全上下文（HTTPS 或 localhost）。部分浏览器把 `file://` 也视为安全上下文，但权限与存储行为不一致，语音可能不可用。
- 语音识别由 API 服务完成；麦克风正常但 ASR 失败时，检查服务端能力、网络和录音时长限制。

### 代理与网络

- 桌面版使用 Chromium 网络栈，默认跟随 Windows 系统代理。设置「通用 → 网络代理」可切换跟随系统 / 手动 HTTP / SOCKS5；修改后主进程会关闭现有连接，新请求使用新配置。
- 启动前设置 `HTTPS_PROXY` / `HTTP_PROXY` 可能对部分请求生效，但以系统或应用内代理设置为准。
- 需要强制代理时，也可用 Electron/Chromium 的 `--proxy-server=...` 启动参数做诊断；不要把代理凭据写入仓库。
- SSE 流式响应需要代理支持长连接且不缓冲响应体；若回答一次性出现或超时，优先检查代理、网关和防火墙。
- 企业 TLS 拦截需要把根证书装入系统信任库，否则请求会因证书错误失败。

### `file://` 限制

直接用浏览器打开 `dist/index.html` 只适合临时预览：

- `file://` 页面通常是不透明源，`localStorage`、IndexedDB 可能不可用或按文件隔离，历史与设置无法可靠保存。
- 请求的 `Origin` 可能是 `null`，API 服务需允许该跨域请求。
- 语音等依赖安全上下文与权限的能力可能被禁用。
- 桌面版不依赖 `file://`：主进程注册了 `dsc://app` 自定义协议（`standard`、`secure`），IndexedDB、localStorage、`crypto.subtle`、`fetch` 和麦克风都在安全上下文中工作。

本地预览网页产物请起静态服务器，例如：

```bash
pnpm exec http-server dist   # 需自行安装 http-server
# 或使用任意静态服务器，将 dist/ 作为根目录
```

### 开发数据与打包数据不互通

开发模式使用 `http://localhost:8090`，打包版使用 `dsc://app`，两者是不同的存储源。会话和附件（IndexedDB）不会自动迁移；API Key 存在 `userData/secrets.json`，不受源变化影响。需要搬运历史时，使用设置中的导出/导入 ZIP。

### 导入历史失败

- 仅支持当前格式（`export_format_version: 3`）的 DeepSeek 历史 ZIP。
- 文件必须完整、未加密、非分卷；不支持 ZIP64 和旧版导出格式。
- 导入会替换全部本地会话和附件，操作前先导出备份。
- 详见 [历史导入导出说明](../src/services/chat/history/README.md)。

### 启动白屏或页面加载失败

1. 确认已执行 `pnpm build`，且 `dist/index.html` 存在。
2. 运行 `node tests/smoke.mjs` 检查构建产物和 Electron 入口。
3. 查看主进程日志中的 `[main] loading`、`[window] 页面加载失败`、`[protocol]` 信息。
4. 开发模式需先启动 `pnpm dev`（或使用 `pnpm dev:desktop`），并确认 8090 端口未被占用。

## 9. 相关文档

- [功能对齐清单](FEATURE-PARITY.md)
- [手动验收清单](QA-CHECKLIST.md)
- [历史导入导出格式](../src/services/chat/history/README.md)
- [上游项目](https://github.com/deepseek-ai/chat-demo)
