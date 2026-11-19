import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useSettings } from '../services/settings.js'
import { useTheme } from './theme.js'

/**
 * 水墨 / 极客外观的 WebGL 背景。
 *
 * 技术路线参考了常见博客/创意站点的做法（原创 shader，不复制代码）：
 * - 全屏固定 canvas、pointer-events: none，放在内容层之后；
 * - 限制 devicePixelRatio、页面隐藏时暂停、prefers-reduced-motion 时只渲染静态帧；
 * - 水墨用 FBM + 域扭曲模拟墨晕；极客用网格 + 粒子 + 扫描线。
 */

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const COMMON = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_dark;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 3; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    amplitude *= 0.5;
  }
  return value;
}
`

const INK_FRAGMENT = `${COMMON}
void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
  float t = u_time * 0.035;

  // 两层域扭曲：像墨滴在纸上缓慢扩散；只取三次 FBM，保证低端设备/软件渲染也能跑
  vec2 q = vec2(fbm(p * 1.15 + t), fbm(p * 1.15 + vec2(5.2, 1.3) - t));
  float ink = smoothstep(0.34, 0.9, fbm(p * 2.0 + 3.2 * q + vec2(0.0, t * 0.4)));
  float grain = (hash(gl_FragCoord.xy) - 0.5) * 0.035;

  vec3 paper = mix(vec3(0.972, 0.962, 0.936), vec3(0.075, 0.069, 0.061), u_dark);
  vec3 inkColor = mix(vec3(0.10, 0.095, 0.085), vec3(0.86, 0.84, 0.78), u_dark);
  float density = mix(0.13, 0.18, u_dark);
  vec3 color = mix(paper, inkColor, ink * density) + grain;

  float vignette = smoothstep(1.45, 0.15, length(p * vec2(1.0, 0.8)));
  color *= mix(0.95, 1.0, vignette);
  gl_FragColor = vec4(color, 1.0);
}
`

const GEEK_FRAGMENT = `${COMMON}
void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
  float t = u_time * 0.5;

  vec3 base = mix(vec3(0.935, 0.955, 0.965), vec3(0.018, 0.030, 0.038), u_dark);
  vec3 accent = mix(vec3(0.0, 0.46, 0.55), vec3(0.20, 0.96, 0.82), u_dark);

  // 网格
  vec2 cell = abs(fract(gl_FragCoord.xy / 44.0) - 0.5);
  float grid = smoothstep(0.47, 0.5, max(cell.x, cell.y)) * 0.16;

  // 缓慢移动的光晕
  vec2 center = u_resolution * vec2(
    0.5 + 0.28 * sin(u_time * 0.17),
    0.5 + 0.22 * cos(u_time * 0.13)
  );
  float glow = exp(-length(gl_FragCoord.xy - center) / (0.22 * min(u_resolution.x, u_resolution.y)));

  // 每个 72px 单元一个漂移粒子
  vec2 pc = floor(gl_FragCoord.xy / 72.0);
  float h = hash(pc);
  vec2 dotCenter = (pc + 0.5) * 72.0 + vec2(
    sin(u_time * 0.45 + h * 6.283) * 18.0,
    cos(u_time * 0.31 + h * 6.283) * 18.0
  );
  float dot = smoothstep(1.8, 0.0, length(gl_FragCoord.xy - dotCenter));

  float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 0.55 - t * 2.0);
  vec3 color = base;
  color += accent * (grid + glow * 0.28 + dot * mix(0.35, 0.6, u_dark));
  color += accent * scan * mix(0.008, 0.02, u_dark);
  gl_FragColor = vec4(color, 1.0);
}
`

const motionQuery =
  typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)')

const subscribeReducedMotion = (onChange: () => void) => {
  motionQuery?.addEventListener('change', onChange)
  return () => motionQuery?.removeEventListener('change', onChange)
}

const useReducedMotion = () =>
  useSyncExternalStore(subscribeReducedMotion, () => motionQuery?.matches === true)

const compileShader = (gl: WebGLRenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.warn('[background] shader compile failed:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const createProgram = (gl: WebGLRenderingContext, fragmentSource: string) => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertex || !fragment) {
    if (vertex) {
      gl.deleteShader(vertex)
    }
    if (fragment) {
      gl.deleteShader(fragment)
    }
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    // eslint-disable-next-line no-console
    console.warn('[background] program link failed:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  return program
}

export const BackgroundFx = () => {
  const appearance = useSettings((state) => state.appearance)
  const appearanceMotion = useSettings((state) => state.appearanceMotion)
  const theme = useTheme()
  const reducedMotion = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const enabled = appearance === 'ink' || appearance === 'geek'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!enabled || !canvas) {
      return
    }
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    })
    if (!gl) {
      return
    }
    const program = createProgram(
      gl,
      appearance === 'ink' ? INK_FRAGMENT : GEEK_FRAGMENT
    )
    if (!program) {
      return
    }

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    )
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.useProgram(program)
    const resolution = gl.getUniformLocation(program, 'u_resolution')
    const time = gl.getUniformLocation(program, 'u_time')
    const dark = gl.getUniformLocation(program, 'u_dark')
    const animate = appearanceMotion && !reducedMotion

    let frame = 0
    let started = performance.now()
    let elapsed = 0

    const resize = () => {
      // 背景只负责氛围，降低内部分辨率换取流畅度；CSS 会把它拉伸到全屏
      const scale = appearance === 'ink' ? 0.55 : 0.8
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25) * scale
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      gl.viewport(0, 0, canvas.width, canvas.height)
    }

    const draw = (seconds: number) => {
      gl.uniform2f(resolution, canvas.width, canvas.height)
      gl.uniform1f(time, seconds)
      gl.uniform1f(dark, theme === 'dark' ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const tick = (now: number) => {
      elapsed = (now - started) / 1000
      resize()
      draw(elapsed)
      frame = requestAnimationFrame(tick)
    }

    const start = () => {
      if (!animate || frame) {
        return
      }
      started = performance.now() - elapsed * 1000
      frame = requestAnimationFrame(tick)
    }

    const stop = () => {
      if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        start()
      }
    }

    resize()
    draw(0)
    if (animate) {
      start()
    }
    const observer = new ResizeObserver(() => {
      resize()
      if (!animate) {
        draw(0)
      }
    })
    observer.observe(canvas)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [enabled, appearance, appearanceMotion, reducedMotion, theme])

  if (!enabled) {
    return null
  }
  return (
    <canvas
      ref={canvasRef}
      className="ds-bg-fx"
      aria-hidden="true"
      role="presentation"
      tabIndex={-1}
    />
  )
}
