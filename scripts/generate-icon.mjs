// 生成 build/icon.png（512x512）：深蓝底 + 白色语音气泡 + DS 几何字标。
// 纯 SVG 路径绘制，不依赖系统字体，保证在 CI/无中文字体的机器上稳定输出。
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 512 },
  background: 'rgba(0,0,0,0)',
})
const png = resvg.render().asPng()
const output = path.join(root, 'build', 'icon.png')
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, png)
console.log(`[icon] wrote ${output} (${png.length} bytes)`)
