import type { PanelMode } from "../constants/panel";
import {
  PANEL_INPUT_HEIGHT,
  PANEL_MAX_HEIGHT,
  PANEL_RESPONSE_CHROME,
  PANEL_SIZE,
  PANEL_WIDTH,
} from "../constants/panel";

/** Resize window height only — Rust handles position on show. */
async function setHeight(height: number): Promise<void> {
  const { getCurrentWindow, LogicalSize } = await import(
    "@tauri-apps/api/window"
  );
  await getCurrentWindow().setSize(new LogicalSize(PANEL_WIDTH, height));
}

export async function hidePanelWindow(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("hide_panel");
  } catch {
    // Browser mode.
  }
}

export async function resizePanelWindow(mode: PanelMode): Promise<void> {
  if (mode === "response") {
    return;
  }

  try {
    await setHeight(PANEL_SIZE[mode].height);
  } catch {
    // Browser mode.
  }
}

export async function resizePanelToContent(
  contentHeight: number,
): Promise<void> {
  const total = Math.min(
    Math.max(
      PANEL_INPUT_HEIGHT + contentHeight + PANEL_RESPONSE_CHROME,
      PANEL_INPUT_HEIGHT + 48,
    ),
    PANEL_MAX_HEIGHT,
  );

  try {
    await setHeight(total);
  } catch {
    // Browser mode.
  }
}

export async function showNotch(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_notch");
  } catch {
    // Browser mode.
  }
}

export async function hideNotch(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("hide_notch");
  } catch {
    // Browser mode.
  }
}

export async function emitNotchState(
  state: "streaming" | "ready",
  preview?: string,
): Promise<void> {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("notch-state", { state, preview });
  } catch {
    // Browser mode.
  }
}
