# DSChat

English | [简体中文](README.zh-CN.md)

DSChat is a Windows desktop chat client for the DeepSeek API, built as an Electron wrapper around the official [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) web demo. The v1 goal is feature parity with the demo: the same conversations, streaming replies, search, attachments, speech, rendering, themes, and history tools, packaged as a native desktop app.

There is no application backend. Each user brings their own DeepSeek API key and the app talks directly to the configured API service. The key is encrypted with the operating system's credential protection (Electron `safeStorage`) and stored locally in the app's `userData` directory; it is never bundled, logged, exported, or sent anywhere except the API service you configure.

## Requirements

- Windows 10/11 (x64)
- Node.js 22.12 or newer
- pnpm

## Build and run

```sh
git clone <this-repository>
cd <repository>
pnpm install
```

Web version (same UI as the official demo):

```sh
pnpm dev       # development server at http://localhost:8090
pnpm build     # static site in dist/
```

Desktop version:

```sh
pnpm dev:desktop  # Electron shell with the development server
pnpm start        # build and launch the desktop app
pnpm smoke        # launch the built app and exit after page load
pnpm dist:dir     # unpacked desktop app for local testing
pnpm dist:win     # Windows installer / distributable
pnpm dist:test    # qianji test build in release-test/ (not for distribution)
```

`pnpm build` produces the web assets in `dist/`. Packaging commands use electron-builder and write installers to `release/` as configured by `build.directories.output` in [package.json](package.json).

See [docs/SELF-HOST.md](docs/SELF-HOST.md) for a complete self-hosting and redistribution guide, including custom API origins, Windows script notes, microphone permissions, proxies, and `file://` limitations.

## Using DSChat

1. Launch the desktop app.
2. Open Settings and enter your DeepSeek API key. The app verifies it before saving.
3. Chat as in the official demo. The key can be replaced at any time in Settings.

Get an API key from the [DeepSeek platform](https://platform.deepseek.com/). Usage is billed to your own account.

## Features

DSChat v1 aims to reproduce the official demo's feature set on the desktop:

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile layouts.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes (including follow-system), mobile layouts, location settings, and chat history import and export.

Added in 0.3.3:

- Strict Content-Security-Policy on `dsc://app`; no inline scripts and no direct renderer connections to the API.
- All Messages, Files, ASR, TTS and model-verification requests now go through a main-process proxy.
- The API key stays in the main process (`safeStorage` or memory-only); the renderer only sees `hasApiKey`.
- Removed the plaintext `secrets.json` fallback and the `localStorage` key fallback.

Added in 0.3.2:

- Quote selected message text when replying.
- Export a conversation branch as an image with KaTeX/Mermaid rendered correctly.
- Optional completion sound.
- HTTP / SOCKS5 proxy settings (system / manual).

Added in 0.3.1:

- Prompt variables (`{{user}}`, `{{char}}`, `{{date}}`, `{{time}}`, `{{original}}`).
- Open-source decorations for empty/error/loading states with third-party notices.
- Per-session input history (↑/↓) and an optional character counter.

Added in 0.3.0:

- Prompt presets in a third Settings tab: create/edit, default marker, per-session snapshot and per-turn system injection; empty chats show the preset greeting.
- Import Tavern character cards V2/V3 from `.json` or `.png` (tEXt/iTXt `chara` / `ccv3`) into a preset; no world books, group chat or STscript.
- Temporary chats (memory only), session pinning, comfortable/wide reading width, TTS speed 0.8/1.0/1.2, and Enter / Ctrl+Enter send preference.
- Copy button on hover for display math blocks; CJK bold Markdown regression coverage.

Added in 0.2.1:

- Export a single conversation branch as Markdown from the session menu.
- Optional completion notification after 15s when the window is unfocused.
- Interface zoom (90/100/110/125%) persisted across launches.
- Inline retry for interrupted/network replies and online/offline toasts.
- Attachment count/size/type precheck before upload, with accurate 32/64 MB limits.
- Native `Ctrl+K` search, `Ctrl+N` new chat, `Ctrl+,` settings and `Esc` close/stop.

Added in 0.2.0:

- Sidebar chat search across titles and message text, with native `Ctrl+K` / `Ctrl+N` shortcuts (150 ms debounce).
- Per-reply metadata: timestamp, input/cache/output tokens, and elapsed time (hidden on narrow layouts).
- Window position/size memory with multi-monitor fallback, tray menu (show/hide, new chat, quit), and optional close-to-tray with a first-close hint.
- About panel showing version, API endpoint, model, and available features, plus redacted local diagnostics export (OS/Electron versions included).

A per-feature checklist with expected desktop behavior, verification steps, and known server-side dependencies is in [docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md). Manual release checks are in [docs/QA-CHECKLIST.md](docs/QA-CHECKLIST.md).

Some capabilities are implemented by the API service rather than the client: smart search, link reading, speech recognition (ASR), read-aloud (TTS), attachment validation, automatic titles, continuation, and content-safety filtering require a compatible DeepSeek service. The desktop port does not reimplement them locally; it preserves the original request/response protocol. See the API capability matrix in the parity document.

## Data and storage

- **Desktop API key:** held only by the main process and encrypted with Electron `safeStorage` (Windows DPAPI) before being written to `secrets.json` in the Electron `userData` directory. If system encryption is unavailable, the key is kept in main-process memory only for that run and the settings screen shows an unencrypted/degraded status; it is never written as plaintext and never falls back to `localStorage`. The renderer only sees a boolean `hasApiKey`; every authenticated request is sent by the main process. Settings also provides a confirmed **Clear API Key** action.
- **Web API key and settings:** stored in browser `localStorage` (`chat-demo:api-key` and related keys). Use the web build only on a trusted profile.
- **Conversations and attachment originals:** stored locally in IndexedDB.
- **History import/export:** ZIP archives containing conversations and locally available image originals. Exports exclude the API key, settings, and original non-image attachments.
- **Delete all chats:** clears local conversations, attachment originals, and unsent drafts; the API key and settings are preserved.
- **Network:** messages, attachments, and speech audio are sent to the configured API service. Uploaded files remain subject to that service's retention policy.

See [src/services/chat/history/README.md](src/services/chat/history/README.md) for the archive format.

## Custom API origin

The API origin is fixed at build time. By default it is `https://api.deepseek.com`; set `DSCHAT_API_ORIGIN` when building to target a compatible gateway or self-hosted endpoint:

```sh
# Git Bash / macOS / Linux
DSCHAT_API_ORIGIN=https://api.example.com pnpm build

# PowerShell
$env:DSCHAT_API_ORIGIN = "https://api.example.com"; pnpm build
```

The build writes the resolved provider (origin, endpoint paths, model, feature flags) to `electron/provider-config.json`. The main process reads this file as both its default provider and its proxy allowlist, so a packaged self-hosted build keeps working without any runtime environment variable. The renderer never requests the API directly, so server-side CORS configuration is not required for the desktop build.

The endpoint must implement the Anthropic-compatible Messages / Files API and the extensions used by the demo (search, link reading, titles, `latest_reminder`, ASR/TTS). See [docs/SELF-HOST.md](docs/SELF-HOST.md) for details and security considerations.

## Development

| Command           | Description                                   |
| ----------------- | --------------------------------------------- |
| `pnpm dev`        | Start the web development server on port 8090 |
| `pnpm dev:desktop`| Run the Electron shell with the dev server    |
| `pnpm build`      | Build the web assets into `dist/`             |
| `pnpm start`      | Build and launch the desktop app              |
| `pnpm smoke`      | Launch the built app and exit after page load |
| `pnpm dist:dir`   | Package an unpacked desktop app in `release/` |
| `pnpm dist:win`   | Package the Windows installer in `release/`   |
| `pnpm dist:test`  | Build the qianji test installer in `release-test/` |
| `pnpm type`       | Run TypeScript type checks                    |
| `pnpm lint`       | Lint with oxlint                              |
| `pnpm test`       | Run all headless regression tests             |
| `pnpm test:proxy` | Exercise the main-process API proxy against a local mock |
| `pnpm format`     | Format with oxfmt                             |
| `node tests/smoke.mjs` | Zero-dependency post-build smoke test    |

The source layout follows the upstream demo:

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
electron/              Main process, preload bridge, and desktop integration
tests/                 Smoke tests
docs/                  Parity, self-hosting, and QA documentation
```

## Upstream and license

This project is a derivative of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo), Copyright (c) 2026 DeepSeek, licensed under the [MIT License](LICENSE). The upstream attribution and license notice are retained. Builds copy the license to `dist/LICENSE`; include it when redistributing. Third-party dependencies remain subject to their own licenses.

DSChat is an independent community desktop wrapper and is not an official DeepSeek product. Do not use DeepSeek names or marks in a way that suggests endorsement.
