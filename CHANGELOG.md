# Changelog

## 0.2.0

Brings MacClaw back in line with current OpenClaw gateways.

### Gateway protocol

- **Protocol v4** — the connect handshake advertises v4, signs the gateway's challenge with an Ed25519 device identity and requests `operator.read` + `operator.write` instead of `operator.admin`. Gateways since OpenClaw 2026.5 reject the previous v3 handshake.
- **Device pairing** — pairing requests are surfaced with their request id, MacClaw keeps retrying until `openclaw devices approve` runs, and the issued device token is stored and reused.
- **Connection errors** — structured gateway errors become readable guidance; token, scope and protocol mismatches stop the reconnect loop instead of hammering the gateway.
- **Tick watchdog and backoff** — silence for two `tickIntervalMs` closes the socket, reconnects back off from 1 s to 30 s.
- **Chat events** — v4 deltas (`deltaText`, `replace`, cumulative `message`), `status` events and `errorDetail` are understood; only events of the run MacClaw started are shown.
- **Generated images** — loaded through `artifacts.download`; `files.read` no longer exists. Legacy `MEDIA:` lines show the file name.
- **Default gateway URL** — `ws://127.0.0.1:18789`, the port OpenClaw listens on.

### Security

- Gateway token, password, device key and device tokens are stored in the login Keychain; the settings file no longer contains secrets and existing files are migrated.

### App

- Third default hotkey is `Cmd+Option+Space`; `Option+Space` clashed with Quick Chat in OpenClaw's macOS app.
- `/status` shows the device id and the last connection message.
- Minimum macOS version is 12 (the notch detection uses APIs introduced there).

### Project

- Dependencies updated (Vite 8, Vitest 4, ESLint 10, Tauri 2.11 and friends), Node 22 and Rust 1.88 required.
- GitHub Actions workflow with lint, Prettier, type check, Vitest, Vite build, rustfmt, clippy and cargo test.
- Committed `package-lock.json`, Prettier-formatted tree, generated Tauri schemas no longer tracked.
- Opt-in integration test against a live gateway.

## 0.1.0

Initial public release.

### Features

- **Global hotkeys** — toggle panel with `Cmd+Shift+Space`, `Cmd+Shift+K`, or `Alt+Space`
- **Compact idle strip** — minimal 750x56 floating bar, always on top, no dock icon
- **Expanding response panel** — auto-resizes to fit streamed markdown answers
- **OpenClaw WebSocket chat** — JSON-RPC protocol v3, streaming deltas, cumulative text rendering
- **Slash commands** — `/connect` (configure OpenClaw gateway) and `/status` (show connection info)
- **Command hints** — autocomplete dropdown with arrow/tab navigation when typing `/`
- **Connect form** — OpenClaw gateway URL + token input with real-time connection verification
- **macOS vibrancy** — HUD window material with blur-through glass effect
- **Credential storage** — Tauri filesystem-based persistence; localStorage fallback never stores tokens
- **Auto-reconnect** — re-establishes OpenClaw connection each time the panel is shown
- **Copy to clipboard** — one-click response copying
- **Markdown rendering** — full GFM support with syntax highlighting (react-markdown + rehype-highlight)
- **CSP hardened** — strict Content Security Policy for WebSocket and asset loading
- **Dismiss on blur** — panel hides automatically when it loses focus
- **Keyboard-first UX** — Enter to submit, Escape to hide, arrows to navigate hints
