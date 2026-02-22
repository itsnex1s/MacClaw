# Contributing

Thanks for contributing to MacClaw — the macOS client for OpenClaw.

## Prerequisites

- Node.js 20+
- Rust toolchain (stable)
- Tauri prerequisites for macOS
- Running [OpenClaw](https://github.com/openclaw/openclaw) gateway (for manual testing)

## Setup

```bash
npm install
```

## Development

```bash
npm run tauri dev
```

## Build check

```bash
npm run build
```

## Scope and conventions

- Keep the UI keyboard-first and minimal (Raycast-style).
- Keep global shortcut and window lifecycle logic in `src-tauri/src/main.rs`.
- Keep OpenClaw protocol parsing in `src/lib/ws-client.ts`.
- Do not commit credentials, tokens, or local env secrets.

## Pull requests

- Keep PRs small and focused.
- Include verification steps and expected behavior.
- Update docs if behavior or configuration changes.
