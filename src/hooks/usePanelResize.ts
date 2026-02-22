import { useEffect, type RefObject } from "react";
import type { PanelMode } from "../constants/panel";
import { resizePanelToContent, resizePanelWindow } from "../lib/panel-window";

export function usePanelResize(
  panelMode: PanelMode,
  responsePanelRef: RefObject<HTMLElement | null>,
  renderedAnswer: string,
  isThinking: boolean,
): void {
  // Fixed-size panels (compact, hints, connect).
  useEffect(() => {
    if (panelMode !== "response") {
      void resizePanelWindow(panelMode);
    }
  }, [panelMode]);

  // Dynamic-size panel: measure content and resize window.
  useEffect(() => {
    if (panelMode !== "response") {
      return;
    }

    requestAnimationFrame(() => {
      const panel = responsePanelRef.current;
      if (!panel) return;
      // Measure the answer-body content, not the flex-stretched panel.
      const body = panel.querySelector(".answer-body");
      const height = body ? body.scrollHeight + 18 : 48;
      void resizePanelToContent(height);
    });
  }, [panelMode, renderedAnswer, isThinking]);
}
