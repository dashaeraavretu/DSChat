# 外观系统与 WebGL 背景

DSChat 的外观系统只覆盖 CSS variables / token，不改 DOM 与消息区布局。默认 `original` 不写任何覆盖，保持官方 `chat-demo` 的观感；其余外观通过 `body[data-ds-preset='...']` 切换。

## 现有外观

| 值 | 名称 | 特点 |
| --- | --- | --- |
| `original` | 原版 | 官方 chat-demo 外观 |
| `tui` | TUI | Gruvbox 暖色、方角、终端感 |
| `fish` | 胖鱼 | 青绿 + 珊瑚、大圆角、原创吉祥物 |
| `paper` | 纸张 | 暖白、低饱和、衬线标题 |
| `ink` | 水墨 | 宣纸底、墨晕、朱砂强调、WebGL 动态背景 |
| `geek` | 极客 | 冷色网格、粒子、扫描线、WebGL 动态背景 |

所有外观都支持浅色 / 深色 / 跟随系统，并与中英文界面兼容。

## WebGL 背景实现

代码在 `src/app/BackgroundFx.tsx`，样式与 token 在 `src/app/presets.css`。

设计原则：

- **只做氛围**：全屏固定 `<canvas>`，`pointer-events: none`，放在内容层之后；不拦截点击、不影响选中。
- **性能优先**：内部渲染分辨率低于显示分辨率（水墨约 0.55×，极客约 0.8×），DPR 上限 1.25；页面隐藏时暂停 `requestAnimationFrame`。
- **可访问性**：遵循 `prefers-reduced-motion: reduce`，只渲染一帧静态画面；设置中也可关闭「动态背景」。
- **可降级**：WebGL 不可用时，canvas 保留 CSS 渐变 / 网格兜底。
- **可读性**：侧栏、消息区、输入框使用半透明 token，背景只透出很低的比例；文字对比度仍按 WCAG 目标设计。
- **不改布局**：外观只改 token、背景层和少量稳定类名（`.ds-new-chat`、`.ds-search-field`、`.ds-app-frame`）。

### 水墨

- 用 FBM（分形噪声）+ 域扭曲模拟墨滴在宣纸上的缓慢扩散；
- 纸面加入轻微 grain 和暗角；
- 浅色是暖纸 + 淡墨，深色是墨底 + 淡墨光；
- 朱砂色只用于品牌、链接和选中态。

### 极客

- 网格 + 缓慢移动的光晕 + 每个单元一个漂移粒子 + 扫描线；
- 浅色是冷灰蓝网格，深色是深青黑 + 青绿荧光；
- 强调色只用于品牌、按钮和焦点，不铺满正文。

## 参考与灵感

以下资料用于理解博客 / 创意站点的常见做法。DSChat 的 shader 与实现为原创，没有复制这些项目的代码：

- Harry Fan：《拆解一個 demo：讓水墨背景「被捲動攪動」的互動頁》  
  https://harryfan.github.io/blog/2026-07-09-ink-scroll-fluid-backdrop/  
  参考点：固定背景层、`pointer-events`、滚动/指针驱动流体、墨色吸收模型。
- Andrew Voirol：MUJŌ — first ink on digital washi  
  https://andrewvoirol.com/log/mujo-first-ink-on-digital-washi  
  参考点：GPU 水墨/和纸质感与颜料混色的整体方向。
- gradient-gl（零依赖 WebGL 渐变背景）  
  https://www.npmjs.com/package/gradient-gl  
  参考点：WebGL/WebGPU 背景的性能取舍、seed 化配色。
- Radiant（94 个 Canvas2D/WebGL 背景 shader）  
  https://atomgit.com/gh_mirrors/radiant4/radiant  
  参考点：独立 shader 文件、可见性暂停、DPR 处理。
- StackOverflow：Animated WebGL background appears in front of content  
  https://stackoverflow.com/questions/79652604/animated-webgl-background-appears-in-front-of-content-instead-of-behind-using  
  参考点：canvas 层级、`position: fixed` 与内容层的 stacking context 处理。
- 通用最佳实践：`prefers-reduced-motion`、页面隐藏暂停、移动端限制 DPR/粒子数量、canvas `aria-hidden`。

这些项目的许可证各不相同；本项目不复制其代码，只在设计层面参考技术模式。

## 新增一套外观

1. 在 `src/services/settings.ts` 的 `Appearance` 类型与校验中加入新值。
2. 在 `src/app/presets.css` 中为浅色 / 深色写 token 覆盖（颜色、边框、圆角、字体）。
3. 如需动态背景，在 `src/app/BackgroundFx.tsx` 增加 fragment shader，并在 `enabled` 判断中加入新值。
4. 在 `SettingsDialog` 的外观下拉与 i18n 中加入选项。
5. 更新 `scripts/write-web-deploy.mjs` 不需要改；CSP 与 PWA 与外观无关。
6. 截图验收：900×620、1200×800、1920×1080，zh/en，light/dark，zoom 90–125%，检查对比度、横滚、裁切、重叠。
7. 运行 `pnpm test`、`pnpm test:proxy`、`pnpm test:update`，并更新 README 截图。

## 测试与已知限制

- 水墨 shader 为低分辨率渲染，放大后会略柔和；这是有意的性能取舍。
- 软件渲染 / 无 GPU 环境会自动降低效果，仍保持静态可读。
- 外观预设不改变消息区 DOM；任何需要改布局的风格不应放进预设系统。
- 目前不提供用户自定义 token 编辑器；后续可考虑导入/导出主题 JSON。
