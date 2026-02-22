# Agent Guide

## Conventions

- Keep UX keyboard-first and minimal (Raycast-style): one command strip, answer panel only after submit.
- Keep window behavior deterministic:
  - global shortcut registration in `src-tauri/src/main.rs`
  - compact window at idle, expanded window on answer/form.
- Never hardcode or commit secrets (gateway tokens/passwords).
- Do not add OpenClaw protocol business logic in UI; protocol handling stays in `src/lib/ws-client.ts`.
- Preserve component boundaries:
  - `src/components/*` for rendering
  - `src/lib/*` for transport, parsing, settings
  - `src/App.tsx` for orchestration

## Verify before DONE

```bash
npm run lint
npm run test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```
