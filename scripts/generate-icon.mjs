// 生成应用图标/托盘图标/多尺寸 PNG/ICO/favicon；纯 SVG，不依赖系统字体。
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const build = path.join(root, 'build')
mkdirSync(path.join(build, 'icons'), { recursive: true })

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#08172e"/>
      <stop offset="0.55" stop-color="#0d2b52"/>
      <stop offset="1" stop-color="#164a86"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#bg)"/>
  <circle cx="392" cy="104" r="58" fill="#2f7de1" opacity="0.18" filter="url(#glow)"/>
  <path d="M256 92 C 352 92 428 150 428 224 C 428 278 394 322 342 346 L 302 424 L 284 350 C 275 352 266 352 256 352 C 160 352 84 294 84 224 C 84 150 160 92 256 92 Z" fill="#ffffff"/>
  <path d="M208 176 H246 A52 52 0 0 1 246 280 H208 Z" fill="#0d2b52"/>
  <path d="M234 200 V256 H246 A28 28 0 0 0 246 200 Z" fill="#ffffff"/>
  <path d="M352 196 A32 32 0 0 0 320 176 H312 A27 27 0 0 0 312 230 H326 A27 27 0 0 1 326 284 H316 A32 32 0 0 1 284 264" fill="none" stroke="#0d2b52" stroke-width="18" stroke-linecap="round"/>
</svg>`

const render = (size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' })
    .render()
    .asPng()

const png512 = render(512)
writeFileSync(path.join(build, 'icon.png'), png512)
const png32 = render(32)
writeFileSync(path.join(build, 'tray.png'), png32)

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const images = icoSizes.map((size) => {
  const png = size === 512 ? png512 : render(size)
  writeFileSync(path.join(build, 'icons', `${size}x${size}.png`), png)
  return { size, png }
})

// ICO 容器：每个尺寸都使用 PNG 数据（Vista+ 支持）
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
const entries = images.map(() => Buffer.alloc(16))
let offset = 6 + entries.length * 16
const dataParts = []
images.forEach(({ size, png }, index) => {
  const entry = entries[index]
  entry[0] = size >= 256 ? 0 : size
  entry[1] = size >= 256 ? 0 : size
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += png.length
  dataParts.push(png)
})
writeFileSync(path.join(build, 'icon.ico'), Buffer.concat([header, ...entries, ...dataParts]))

for (const [name, size] of [
  ['favicon-32.png', 32],
  ['favicon-192.png', 192],
  ['favicon-512.png', 512],
  ['maskable-512.png', 512],
]) {
  writeFileSync(path.join(build, name), render(size))
}
console.log('[icon] wrote icon.png, icon.ico, tray.png, favicon/maskable and 7 PNG sizes')
