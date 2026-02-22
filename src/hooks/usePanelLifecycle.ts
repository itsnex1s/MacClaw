import { useEffect, type MutableRefObject, type RefObject } from "react";
import type { WsClient } from "../lib/ws-client";
import {
  emitNotchState,
  hidePanelWindow,
  showNotch,
} from "../lib/panel-window";
import type { AppSettings } from "../lib/settings";

type PanelLifecycleDeps = {
  client: WsClient;
  settings: AppSettings;
  settingsLoaded: boolean;
  backgroundModeRef: MutableRefObject<boolean>;
  isThinkingRef: MutableRefObject<boolean>;
  streamingTextRef: MutableRefObject<string>;
  inputRef: RefObject<HTMLInputElement | null>;
  clearConversation: () => void;
  setBackgroundMode: (v: boolean) => void;
};

export function usePanelLifecycle(deps: PanelLifecycleDeps): void {
  const {
    client,
    settings,
    settingsLoaded,
    backgroundModeRef,
    isThinkingRef,
    streamingTextRef,
    inputRef,
    clearConversation,
    setBackgroundMode,
  } = deps;

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    if (!client.active) {
      client.connect(settings);
    }

    // Guards against the DOM "focus" event clearing the conversation
    // right after a notch restore. Rust's present_panel triggers both
    // a Tauri "panel-show" event AND a DOM "focus" event, so the flag
    // must survive multiple calls — reset via timeout, not on first use.
    let justRestored = false;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;

    // Called every time the panel becomes visible (hotkey show).
    // Clears stale UI, reconnects if the WebSocket died while hidden.
    const onPanelShow = () => {
      // If restoring from background mode, keep the response.
      if (backgroundModeRef.current || justRestored) {
        inputRef.current?.focus();
        return;
      }
      // Don't clear an active response — the Tauri "panel-show" IPC event
      // can arrive after the user has already submitted a new query, and
      // clearing would reset isThinkingRef causing the notch to not show.
      if (isThinkingRef.current || streamingTextRef.current.length > 0) {
        inputRef.current?.focus();
        return;
      }
      clearConversation();
      if (!client.connected) {
        client.connect(settings);
      }
      inputRef.current?.focus();
    };

    // Notch restore: panel reopens with preserved response.
    const onNotchRestore = () => {
      justRestored = true;
      backgroundModeRef.current = false;
      setBackgroundMode(false);
      inputRef.current?.focus();
      // Keep the flag alive long enough for all focus events to fire,
      // then reset so the next normal open clears conversation.
      if (restoreTimer) clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => {
        justRestored = false;
      }, 500);
    };

    // Called when the panel loses focus (click outside or Rust sends
    // "panel-dismiss"). Rust no longer hides the window on focus loss —
    // we handle background mode first, then hide from JS. This avoids
    // the race where orderOut: suppresses DOM blur and IPC delivery.
    const onPanelBlur = () => {
      if (backgroundModeRef.current) {
        return;
      }
      const hasActiveResponse =
        isThinkingRef.current || streamingTextRef.current.length > 0;
      if (hasActiveResponse) {
        backgroundModeRef.current = true;
        setBackgroundMode(true);
        void showNotch();
        void emitNotchState("streaming");
      } else {
        clearConversation();
      }
      void hidePanelWindow();
    };

    // Tauri event listeners are registered asynchronously. Use an aborted
    // flag so that if the effect is cleaned up before the promises resolve,
    // the listeners are immediately unregistered instead of leaking.
    let aborted = false;
    const unlisteners: (() => void)[] = [];
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        Promise.all([
          listen("panel-show", onPanelShow),
          listen("notch-restore", onNotchRestore),
          // Rust emits "panel-dismiss" right before window.hide().
          // This is more reliable than DOM "blur" which may not fire
          // after macOS orderOut:.
          listen("panel-dismiss", onPanelBlur),
        ]),
      )
      .then((fns) => {
        if (aborted) {
          fns.forEach((fn) => fn());
        } else {
          unlisteners.push(...fns);
        }
      })
      .catch(() => {
        // Expected in browser dev mode where Tauri APIs are unavailable.
      });

    window.addEventListener("focus", onPanelShow);
    window.addEventListener("blur", onPanelBlur);

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();

      // If streaming/thinking, enter background mode with notch.
      if (backgroundModeRef.current) {
        // Already in background mode — just hide the panel.
        void hidePanelWindow();
        return;
      }

      const hasActiveResponse =
        isThinkingRef.current || streamingTextRef.current.length > 0;

      if (hasActiveResponse) {
        backgroundModeRef.current = true;
        setBackgroundMode(true);
        void showNotch();
        void emitNotchState("streaming");
        void hidePanelWindow();
        return;
      }

      clearConversation();
      void hidePanelWindow();
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      aborted = true;
      window.removeEventListener("focus", onPanelShow);
      window.removeEventListener("blur", onPanelBlur);
      document.removeEventListener("keydown", onKeyDown);
      unlisteners.forEach((fn) => fn());
      if (restoreTimer) clearTimeout(restoreTimer);
    };
  }, [client, settings, settingsLoaded]);
}
