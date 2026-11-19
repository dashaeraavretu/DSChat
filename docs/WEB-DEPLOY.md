# Web 版部署

DSChat 的 Web 版是一个纯静态单页应用：没有自有后端，所有消息、附件与语音都直接发送到你配置的 DeepSeek API 服务。构建产物在 `dist/`，可以托管到 Cloudflare Pages、GitHub Pages、Netlify、Vercel 或任意静态文件服务器。

> 网页版只能把 API Key 保存在浏览器 `localStorage`（明文）。请只在可信设备和浏览器配置中使用；公共电脑建议在设置 → 数据管理关闭「在此浏览器记住 API Key」，只保留到当前页面关闭。

## 环境要求

- Node.js 22.12 或更高版本（Cloudflare 构建建议 24）
- pnpm
- 一个可用的 DeepSeek API Key（由每个使用者自己填写）

## 方式一：Cloudflare Pages + Git（推荐）

1. Fork 或推送本仓库到 GitHub。
2. 打开 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
3. 选择仓库，配置：
   - **Framework preset**：None
   - **Build command**：`pnpm build`
   - **Build output directory**：`dist`
   - **Node version**：`24`
   - **pnpm version**：`12.6.0`
4. 保存并部署。

也可以把 Node/pnpm 版本写成环境变量：

```text
NODE_VERSION=24
PNPM_VERSION=12.6.0
```

### 使用自建 API 网关

默认构建连接 `https://api.deepseek.com`。如果使用兼容网关，在 Cloudflare Pages 的 **Settings → Environment variables** 加：

```text
DSCHAT_API_ORIGIN=https://api.example.com
```

然后重新部署。构建脚本会把解析后的地址写入 `electron/provider-config.json`，并生成匹配的 `dist/_headers` CSP 与 `dist/sw.js`。

> 千机测试 profile（`DSCHAT_PROFILE=qianji`）会关闭附件、语音与联网工具，只用于内部验收；不要把测试构建部署为公开站点。

## 方式二：Wrangler CLI

```sh
pnpm install
pnpm build
pnpm dlx wrangler pages deploy dist --project-name dschat
```

首次运行需要登录 Cloudflare：

```sh
pnpm dlx wrangler login
```

`wrangler.toml` 已配置 `pages_build_output_dir = "./dist"`，也可以直接：

```sh
pnpm dlx wrangler pages deploy
```

## 方式三：GitHub Actions 手动部署

仓库内提供 `.github/workflows/deploy-cloudflare.yml`，在 Actions 页面手动触发即可。使用前在仓库 Settings → Secrets and variables → Actions 添加：

- `CLOUDFLARE_API_TOKEN`：Cloudflare API Token，权限包含 Pages:Edit。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。

触发时可填 Pages 项目名（默认 `dschat`）和可选的 `DSCHAT_API_ORIGIN`。工作流会先跑 type/lint/test，再构建并上传 `dist/`。

## 方式四：直接使用 Release 里的 Web zip

每个 Release 都附带 `DSChat-x.y.z-web.zip`（由 CI 构建，包含 `_headers`、`sw.js` 和 manifest）。解压后把里面的文件上传到 Cloudflare Pages / 任意静态托管即可，不需要本地安装 Node。

## 方式五：任意静态托管

把 `dist/` 整个目录上传到你的静态托管即可。请确保：

- 站点使用 HTTPS（Service Worker 和麦克风需要安全上下文）。
- `sw.js` 可以以 `text/javascript` 返回，且不被长期缓存。
- 如果托管在子路径下，`dist/index.html` 中的资源使用相对路径（本项目已使用 `publicPath: 'auto'`）。

## 构建产物与安全头

`pnpm build` 会生成：

- `dist/index.html`、`dist/static/js/*`、`dist/static/css/*`、字体与图标。
- `dist/_headers`：Cloudflare Pages 安全响应头：
  - 严格 CSP：`script-src 'self'`、`connect-src 'self' <API origin>`、`object-src 'none'` 等。
  - `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。
  - `Permissions-Policy` 只允许麦克风，不允许摄像头。
- `dist/sw.js`：PWA 离线外壳，缓存版本号取自 `package.json`。
- `dist/site.webmanifest`：PWA 清单。

修改 API 地址后必须重新构建，否则 CSP 的 `connect-src` 仍会指向旧地址。

## PWA 与离线

- 首次通过 HTTPS 打开后，浏览器会注册 `sw.js`，缓存应用外壳与静态资源。
- 离线时可以打开界面、查看本地会话；发送消息仍需要网络。
- 支持安装到桌面/主屏幕（Chrome、Edge、Safari 的“添加到主屏幕”）。
- iOS 主屏幕模式已处理安全区（刘海、底部手势区）。
- 更新部署后，新的 Service Worker 会在下次加载时接管；缓存名带版本号，旧缓存会自动清理。

## 自定义域名与 HTTPS

在 Cloudflare Pages 的 **Custom domains** 中添加域名并按提示配置 DNS。Cloudflare 会自动签发证书。请保持 HTTPS，否则：

- Service Worker 不会注册。
- 麦克风/语音输入可能不可用。
- 浏览器可能限制部分存储能力。

## CORS

Web 版从浏览器直接请求 API，目标服务必须允许你的站点源（`Origin`）：

- 官方 `https://api.deepseek.com` 已允许跨域请求。
- 自建网关需要在服务端允许你的 Pages 域名，并允许 `Authorization`、`x-api-key`、`content-type` 等请求头。
- 如果网关无法配置 CORS，可以考虑部署一个 Cloudflare Worker 作为转发层；Key 会经过该 Worker，必须自行审计且不要记录请求头。

桌面版不需要 CORS：所有请求由主进程代理发出。

## 常见问题

### 部署后打开是空白页

1. 确认构建命令是 `pnpm build`，输出目录是 `dist`。
2. 检查 `dist/index.html` 是否存在，浏览器控制台是否有 CSP 或资源 404 错误。
3. 如果改了 `DSCHAT_API_ORIGIN`，确认重新构建，且 CSP 的 `connect-src` 包含新地址。

### 发送消息报 CORS 或网络错误

用浏览器开发者工具查看失败请求的 `Origin` 与响应头。目标 API 必须允许该源，并正确处理 OPTIONS 预检。

### 安装 PWA 后没有离线缓存

- 必须通过 HTTPS 访问。
- 首次加载后等待 `sw.js` 注册完成；刷新一次再测试。
- 检查 `dist/sw.js` 是否存在、`_headers` 是否设置了 `Cache-Control: no-cache`。

### API Key 会保存在哪里？

浏览器 `localStorage` 的 `chat-demo:api-key`。关闭「在此浏览器记住 API Key」后会立即删除该键，只保留在当前页面内存中。桌面版则使用系统加密存储，二者互不影响。

### 可以公开提供 API Key 吗？

不可以。本项目不内置 Key、不做 Key 池或代充。每个使用者必须填写自己的 Key；公开站点也不应收集或代理他人的 Key。

## 相关文档

- [README](../README.md)
- [自部署与自定义 API](SELF-HOST.md)
- [手动验收清单](QA-CHECKLIST.md)
- [更新日志](../CHANGELOG.md)
