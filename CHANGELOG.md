# Changelog

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
