import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack, type Configuration } from '@rspack/core'

const dev = process.env.NODE_ENV !== 'production'
const targets = ['chrome >= 105', 'edge >= 105', 'safari >= 16', 'firefox >= 110']
const root = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets },
}

type FeatureFlags = { files: boolean; speech: boolean; webTools: boolean }
type VerifyMode = 'models' | 'message' | 'skip'
type Provider = {
  origin: string
  messagesBase: string
  modelsUrl: string
  model: string
  features: FeatureFlags
  verifyMode: VerifyMode
}

type ConfigOptions = {
  /** 公开 API 的地址；未设置时使用 provider 配置 */
  apiOrigin?: string
  /** 开发服务器配置，支持本地接口代理 */
  devServer?: Configuration['devServer']
  /** 构建期 provider；未设置时从 DSCHAT_* 环境变量解析 */
  provider?: Provider
}

const joinUrl = (origin: string, pathname: string) =>
  /^https?:\/\//i.test(pathname)
    ? pathname
    : `${origin.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`

const envFlag = (name: string, fallback: boolean) => {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) {
    return fallback
  }
  return !['0', 'false', 'off', 'no'].includes(value)
}

/**
 * 构建期 provider 配置。默认值必须与 0.1.3 完全一致；
 * DSCHAT_PROFILE=qianji 或显式 DSCHAT_* 变量用于测试构建，不影响默认发布。
 */
const resolveProvider = (): Provider => {
  const profile = process.env.DSCHAT_PROFILE?.trim().toLowerCase()
  const qianji = profile === 'qianji'
  const origin = (
    process.env.DSCHAT_API_ORIGIN?.trim() ||
    (qianji ? 'https://dygpt.duoyioa.com/qianji' : 'https://api.deepseek.com')
  ).replace(/\/+$/, '')
  const messagesPath =
    process.env.DSCHAT_MESSAGES_PATH?.trim() || (qianji ? '/v1' : '/anthropic/v1')
  const modelsPath =
    process.env.DSCHAT_MODELS_PATH?.trim() || (qianji ? '/v1/models' : '/models')
  const model =
    process.env.DSCHAT_MODEL?.trim() || (qianji ? 'DS/DeepSeek-V4.1-Flash' : 'deepseek-flash')
  const verifyMode =
    (process.env.DSCHAT_VERIFY_MODE?.trim() as VerifyMode | undefined) ||
    (qianji ? 'message' : 'models')

  return {
    origin,
    messagesBase: joinUrl(origin, messagesPath),
    modelsUrl: joinUrl(origin, modelsPath),
    model,
    verifyMode:
      verifyMode === 'message' || verifyMode === 'skip' || verifyMode === 'models'
        ? verifyMode
        : 'models',
    features: qianji
      ? { files: false, speech: false, webTools: false }
      : {
          files: envFlag('DSCHAT_FEATURE_FILES', true),
          speech: envFlag('DSCHAT_FEATURE_SPEECH', true),
          webTools: envFlag('DSCHAT_FEATURE_WEB_TOOLS', true),
        },
  }
}

/** 创建构建配置，支持自定义 API 地址和开发服务器选项 */
export const createConfig = ({
  apiOrigin,
  devServer,
  provider = resolveProvider(),
}: ConfigOptions = {}): Configuration => {
  const origin = apiOrigin?.replace(/\/+$/, '') || provider.origin
  // 显式覆盖 apiOrigin 时才重新拼路径；默认/DSCHAT_PROFILE 直接使用 provider 的完整地址
  const messagesBase = apiOrigin
    ? joinUrl(origin, new URL(provider.messagesBase).pathname)
    : provider.messagesBase
  const modelsUrl = apiOrigin ? joinUrl(origin, new URL(provider.modelsUrl).pathname) : provider.modelsUrl

  return {
  mode: dev ? 'development' : 'production',
  entry: './src/main.tsx',
  output: {
    path: path.resolve(root, 'dist'),
    // 运行时按当前脚本地址推导资源路径，file:// 下异步 chunk、字体都按相对位置加载
    publicPath: 'auto',
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/async/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    cssChunkFilename: 'static/css/async/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: dev ? 'cheap-module-source-map' : false,
  // 开发模式预编译异步模块，保持首次加载代码高亮和公式时的页面状态
  lazyCompilation: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // 将 .js 导入路径解析到同名 .ts、.tsx 或 .js 文件
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    // CSS Modules 使用默认导出：`import styles from './x.module.css'`
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.(j|t)sx?$/,
        exclude: /[\\/]node_modules[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: dev } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf)$/, type: 'asset/resource' },
      { test: /\.svg$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    // 经典 defer 脚本支持 file:// 页面的资源加载
    new rspack.HtmlRspackPlugin({
      template: './src/index.html',
      scriptLoading: 'defer',
      meta: { 'application-version': version },
    }),
    new rspack.DefinePlugin({
      __APP_VERSION__: JSON.stringify(
        process.env.DSCHAT_DISPLAY_VERSION?.trim() || version
      ),
      __API_ORIGIN__: JSON.stringify(origin),
      __MESSAGES_BASE__: JSON.stringify(messagesBase),
      __MODELS_URL__: JSON.stringify(modelsUrl),
      __API_MODEL__: JSON.stringify(provider.model),
      __FEATURES__: JSON.stringify(provider.features),
      __VERIFY_MODE__: JSON.stringify(provider.verifyMode),
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        { from: path.resolve(root, 'LICENSE'), to: 'LICENSE', toType: 'file' },
        { from: path.resolve(root, 'THIRD_PARTY_NOTICES.md'), to: 'THIRD_PARTY_NOTICES.md', toType: 'file' },
        { from: path.resolve(root, 'build/site.webmanifest'), to: 'site.webmanifest', toType: 'file' },
        { from: path.resolve(root, 'build/favicon-32.png'), to: 'favicon-32.png', toType: 'file' },
        { from: path.resolve(root, 'build/favicon-192.png'), to: 'favicon-192.png', toType: 'file' },
        { from: path.resolve(root, 'build/favicon-512.png'), to: 'favicon-512.png', toType: 'file' },
        { from: path.resolve(root, 'build/maskable-512.png'), to: 'maskable-512.png', toType: 'file' },
      ],
    }),
  ],
  performance: { hints: false },
  devServer: { port: 8090, ...devServer },
  }
}

// eslint-disable-next-line import/no-default-export
export default defineConfig(createConfig())
