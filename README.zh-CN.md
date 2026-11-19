# DSChat

[English](README.md) | 简体中文

DSChat 是一个面向 DeepSeek API 的 Windows 桌面聊天客户端，基于官方开源项目 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的网页 demo，用 Electron 封装为原生桌面应用。v1 的目标是完整复刻官方 demo 的功能：多会话、流式回答、智能搜索、附件、语音、Markdown 渲染、主题与历史导入导出，原样搬到桌面端。

本项目没有应用后端。每个使用者填写自己的 DeepSeek API Key，客户端直接请求所配置的 API 服务。Key 通过操作系统的凭据保护机制（Electron `safeStorage`，Windows 下为 DPAPI）加密后保存在本机 `userData` 目录，不会被打包、记录、导出，也不会发送到除你配置的 API 服务之外的任何地方。

## 环境要求

- Windows 10/11（x64）
- Node.js 22.12 或更高版本
- pnpm

## 构建与运行

```sh
git clone <本仓库地址>
cd <仓库目录>
pnpm install
```

网页版（与官方 demo 相同的界面）：

```sh
pnpm dev       # 开发服务器 http://localhost:8090
pnpm build     # 静态产物输出到 dist/
```

桌面版：

```sh
pnpm dev:desktop  # Electron 外壳 + 开发服务器
pnpm start        # 构建并启动桌面应用
pnpm smoke        # 启动已构建应用，页面加载完成后退出
pnpm smoke:blob   # 验证附件 blob: 预览窗口
pnpm dist:dir     # 生成免安装的 release/win-unpacked
pnpm dist:win     # 生成 Windows 安装包
pnpm dist:test    # 生成千机测试包到 release-test/（不对外分发）
```

`pnpm build` 产出 `dist/` 下的网页资源；打包命令使用 electron-builder，产物写入 `release/`（见 [package.json](package.json) 的 `build.directories.output`）。

完整的自部署与分发说明见 [docs/SELF-HOST.md](docs/SELF-HOST.md)，包括自定义 API 地址、Windows 脚本、麦克风权限、代理与 `file://` 限制。

## 使用

1. 启动桌面应用。
2. 打开设置，填写你的 DeepSeek API Key；应用会先校验再保存。
3. 像官方 demo 一样聊天。Key 可随时在设置中更换。

API Key 可在 [DeepSeek 开放平台](https://platform.deepseek.com/) 获取，用量计入你自己的账户。

## 功能

DSChat v1 在桌面端复刻官方 demo 的功能：

- 多会话、自动标题、重命名与删除；编辑提问、重新生成、切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止生成与符合条件的继续生成。
- 附件上传、粘贴与拖拽；语音输入与回复朗读。移动端录音时，输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式与 Mermaid 图表。
- 简体中文与英文、浅色与深色主题（含跟随系统）、移动端布局、位置设置、历史导入导出。

0.3.3 新增：

- `dsc://app` 严格 CSP：禁止内联脚本，渲染层不能直连 API。
- Messages、Files、ASR、TTS 与模型校验全部改由主进程代理发出。
- API Key 只存在于主进程（`safeStorage` 或仅内存）；渲染层只能看到 `hasApiKey`。
- 移除明文 `secrets.json` 降级与 `localStorage` Key 回退。

0.3.2 新增：

- 选中消息文本后引用回复。
- 会话/消息导出为图片，保证 KaTeX/Mermaid 渲染正确。
- 可选完成提示音。
- HTTP / SOCKS5 代理设置（跟随系统 / 手动）。

0.3.1 新增：

- 预设变量（`{{user}}`、`{{char}}`、`{{date}}`、`{{time}}`、`{{original}}`）。
- 空/错/加载状态使用开源装饰，并补第三方许可声明。
- 会话级输入历史（↑/↓）与可选字数统计。

0.3.0 新增：

- 设置第三组「预设」：新建/编辑、默认标记、会话快照与每轮 system 注入；空会话显示预设开场白。
- 支持酒馆角色卡 V2/V3 的 `.json` / `.png`（tEXt/iTXt `chara`/`ccv3`）导入为预设；不含世界书、群聊、STscript。
- 临时会话（仅内存）、会话置顶、舒适/宽阅读宽度、朗读语速 0.8/1.0/1.2、Enter / Ctrl+Enter 发送偏好。
- 行间公式 hover 复制按钮；CJK 粗体 Markdown 回归覆盖。

0.2.1 新增：

- 会话菜单按当前分支导出 Markdown。
- 生成超过 15 秒且窗口未聚焦时可选系统通知。
- 界面缩放 90/100/110/125%，跨启动持久化。
- 中断/断网回复支持行内「重试本条」，并提示网络恢复/断开。
- 附件在选中、拖入或粘贴时先做数量/大小/类型预检，文案准确区分 32/64MB。
- 原生 `Ctrl+K` 搜索、`Ctrl+N` 新建、`Ctrl+,` 设置、`Esc` 关闭/停止。

0.2.0 新增：

- 侧栏会话搜索，匹配标题与正文；原生 `Ctrl+K` 搜索、`Ctrl+N` 新建，150ms 节流。
- 每条回复的元信息：时间、输入/缓存/输出 Token、耗时（窄屏隐藏）。
- 窗口位置/大小记忆与多显示器越界回退；托盘菜单（显示/隐藏、新建、退出）；可选关闭到托盘与首次关闭提示。
- 关于页展示版本、API 端点、模型与可用功能；支持导出脱敏诊断日志（附操作系统与 Electron 版本）。

逐项功能清单（含桌面端预期行为、验证步骤和服务端依赖）见 [docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md)；手动验收清单见 [docs/QA-CHECKLIST.md](docs/QA-CHECKLIST.md)。

智能搜索、链接阅读、语音识别（ASR）、回复朗读（TTS）、附件校验、自动标题、继续生成与内容安全过滤由 API 服务实现，客户端不本地重写这些能力，只保持原有的请求/响应协议。详见功能对齐文档中的服务端能力矩阵。

## 数据与安全

- **桌面端 API Key：** 只由主进程持有，经 Electron `safeStorage`（Windows DPAPI）加密后写入 `userData` 目录下的 `secrets.json`。若系统加密不可用，Key 仅在本次运行的主进程内存中保留，设置页显示未加密/降级；不会写明文文件，也不会回退到 `localStorage`。渲染层只能看到布尔值 `hasApiKey`，所有需要鉴权的请求都由主进程发出。设置页还提供带确认的「清除 API Key」。
- **网页版 API Key 与设置：** 保存在浏览器 `localStorage`（`chat-demo:api-key` 等键）。网页版请只在可信的浏览器配置中使用。
- **会话与附件原件：** 保存在本机 IndexedDB。
- **历史导入导出：** ZIP 归档，包含会话与本地可用的图片原件；导出不包含 API Key、设置和非图片附件原件。
- **删除全部对话：** 清空本地会话、附件原件与未发送草稿；API Key 与设置保留。
- **网络：** 消息、附件与语音会发送到所配置的 API 服务，上传文件受该服务的保留策略约束。

归档格式见 [src/services/chat/history/README.md](src/services/chat/history/README.md)。

## 自定义 API 地址

API 地址在构建时固定，默认为 `https://api.deepseek.com`。构建时设置 `DSCHAT_API_ORIGIN` 可指向兼容网关或自建端点：

```sh
# Git Bash / macOS / Linux
DSCHAT_API_ORIGIN=https://api.example.com pnpm build

# PowerShell
$env:DSCHAT_API_ORIGIN = "https://api.example.com"; pnpm build
```

目标端点需实现 Anthropic 兼容的 Messages / Files API，以及 demo 使用的扩展能力（搜索、链接阅读、标题、`latest_reminder`、ASR/TTS）。构建会把解析后的 provider（origin、端点路径、模型、功能开关）写入 `electron/provider-config.json`；主进程把它同时用作默认 provider 和代理白名单，因此自建安装包在用户机器上不依赖运行时环境变量。桌面端请求全部由主进程代理发出，不需要目标服务配置 CORS。细节与安全注意事项见 [docs/SELF-HOST.md](docs/SELF-HOST.md)。

## 开发

| 命令                    | 说明                                   |
| ----------------------- | -------------------------------------- |
| `pnpm dev`              | 启动 8090 端口的网页开发服务器         |
| `pnpm dev:desktop`      | Electron 外壳 + 开发服务器             |
| `pnpm build`            | 构建网页资源到 `dist/`                 |
| `pnpm start`            | 构建并启动桌面应用                     |
| `pnpm smoke`            | 启动已构建应用，页面加载后退出         |
| `pnpm smoke:blob`       | 验证附件 blob: 预览窗口                |
| `pnpm dist:dir`         | 打包免安装桌面应用到 `release/`        |
| `pnpm dist:win`         | 打包 Windows 安装包到 `release/`       |
| `pnpm dist:test`        | 打包千机测试包到 `release-test/`       |
| `pnpm type`             | TypeScript 类型检查                    |
| `pnpm lint`             | oxlint 检查                            |
| `pnpm test`             | 运行全部无头回归测试                   |
| `pnpm test:proxy`       | 对本机 mock 上游验证主进程 API 代理     |
| `pnpm format`           | oxfmt 格式化                           |
| `node tests/smoke.mjs`  | 零依赖的构建后冒烟测试                 |

源码结构沿用上游 demo：

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
electron/              主进程、preload 桥接与桌面集成
tests/                 冒烟测试
docs/                  功能对齐、自部署与 QA 文档
```

## 上游与许可证

本项目派生自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)，Copyright (c) 2026 DeepSeek，遵循 [MIT 许可证](LICENSE)。上游署名与许可证声明均已保留；构建会把许可证复制到 `dist/LICENSE`，分发时请一并保留。第三方依赖遵循各自的许可证。

DSChat 是独立的社区桌面封装，并非 DeepSeek 官方产品。请勿以暗示官方背书的方式使用 DeepSeek 名称或标识。
