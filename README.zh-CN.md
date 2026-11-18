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

逐项功能清单（含桌面端预期行为、验证步骤和服务端依赖）见 [docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md)；手动验收清单见 [docs/QA-CHECKLIST.md](docs/QA-CHECKLIST.md)。

智能搜索、链接阅读、语音识别（ASR）、回复朗读（TTS）、附件校验、自动标题、继续生成与内容安全过滤由 API 服务实现，客户端不本地重写这些能力，只保持原有的请求/响应协议。详见功能对齐文档中的服务端能力矩阵。

## 数据与安全

- **桌面端 API Key：** 经 Electron `safeStorage`（Windows DPAPI）加密后写入 `userData` 目录下的 `secrets.json`。若系统加密不可用，应用会在该文件中写入明确标注的明文降级数据，设置页显示“未加密/降级”；若 IPC 保存失败，渲染层回退到 `localStorage`（重启后仍加载），同样显示降级状态。设置页还提供带确认的「清除 API Key」。
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

目标端点需实现 Anthropic 兼容的 Messages / Files API，以及 demo 使用的扩展能力（搜索、链接阅读、标题、`latest_reminder`、ASR/TTS）。细节与安全注意事项见 [docs/SELF-HOST.md](docs/SELF-HOST.md)。

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
| `pnpm type`             | TypeScript 类型检查                    |
| `pnpm lint`             | oxlint 检查                            |
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
