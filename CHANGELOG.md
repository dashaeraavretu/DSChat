# Changelog

All notable changes to DSChat are recorded here. Versions follow `package.json`
and release tags use the `vX.Y.Z` form.

## 0.6.0 — 2026-11-19

### Added

- **Ink** appearance: paper background, animated ink-wash WebGL layer,
  vermilion accents, serif headings.
- **Geek** appearance: cool grid, drifting particles, scanlines and a cyan/green
  WebGL background.
- Appearance motion setting; Ink/Geek backgrounds respect
  `prefers-reduced-motion` and pause when the page is hidden.
- Appearance design notes and WebGL references in `docs/APPEARANCE.md`.

### Changed

- Sidebar: more breathing room between **New chat** and the session search,
  search icon and `Ctrl K` hint, clearer focus state.
- README now shows the six appearances with screenshots, a self-hosting section
  with direct links to `docs/WEB-DEPLOY.md` and `docs/SELF-HOST.md`, and a
  feature overview table.

## 0.5.0 — 2026-11-19

### Added

- User-facing Chinese README as the default, with an English `README.en.md`.
- Web/PWA deployment: service worker with versioned offline shell, installable
  manifest, iOS safe-area handling, and a Cloudflare Pages guide/workflow.
- Generated `dist/_headers` with a strict CSP that follows the build-time API
  origin; generated `dist/sw.js`.
- `wrangler.toml`, `pnpm deploy:cf`, and a manual Cloudflare Pages deploy
  workflow.
- Web setting: **Remember API key in this browser**. When off, the key stays in
  memory for the current page only and is removed from `localStorage`.

### Changed

- Web API key hint now explains the session-only option.
- README screenshots and deployment documentation.

## 0.4.0 — 2026-11-19

### Added

- About dialog: **Check for updates** against the public GitHub Releases of the
  configured repository; shows the latest version and opens the download page.
  No automatic download or installation.
- Build-time release configuration (`electron/release-config.json`) from
  `DSCHAT_GITHUB_REPO` or `package.json.repository`.
- Windows GitHub Actions release workflow: install, typecheck, lint, tests,
  main-process proxy smoke, default installer, checksums, and GitHub Release
  upload.
- Release notes / changelog and SHA256 checksums for release assets.

### Changed

- 0.3.3's provider configuration is generated at build time, so self-hosted
  `DSCHAT_API_ORIGIN` builds keep working without runtime environment variables.
- Update checks are main-process only; the renderer never talks to GitHub
  directly.

### Known limitations

- The Windows installer is **unsigned**. SmartScreen warnings are expected.
  Users should verify SHA256 checksums from the release page.
- Automatic download/installation is not implemented; updates open the release
  download page for a manual install.
- Private GitHub repositories are not supported by the update checker (the
  public Releases API needs no token).

## 0.3.3 — 2026-11-19

### Security

- Strict Content-Security-Policy for `dsc://app`; inline scripts are blocked and
  the renderer cannot connect to the API directly.
- Messages, Files, ASR, TTS, and model verification are proxied by the main
  process. The renderer only sees `hasApiKey`.
- API keys remain in the main process (`safeStorage` or memory-only). Plaintext
  `secrets.json` and `localStorage` key fallbacks were removed.
- Main-process proxy only targets the build-time provider allowlist (official,
  Qianji, or a baked `DSCHAT_API_ORIGIN`).

### Added

- Provider configuration module and build-time `electron/provider-config.json`.
- Headless provider, CSP, key-isolation, and main-process proxy smoke tests.
- Unified `pnpm test` and `pnpm test:proxy` commands.

### Changed

- README, SELF-HOST, FEATURE-PARITY, and QA-CHECKLIST now document the new key,
  proxy, CSP, and self-hosted-origin behavior.

## 0.3.2

### Added

- Quote selected message text.
- Export a conversation branch as an image.
- Optional completion sound.
- HTTP / SOCKS5 proxy settings.

## 0.3.1

### Added

- Prompt variables, open-source decorations, per-session input history, and an
  optional character counter.

## 0.3.0

### Added

- Prompt presets, Tavern V2/V3 character-card import, temporary chats, session
  pinning, reading width, TTS speed, send-key preference, formula copy, and CJK
  Markdown regression coverage.
