import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { resolveSelectionPrefill } from "./selection-prefill";
import type { SelectionContext, SelectionPrefillPayload } from "./types";

type UseSelectionPrefillParams = {
  inputRef: RefObject<HTMLInputElement | null>;
  preserveNextOpenRef: MutableRefObject<boolean>;
  onPrefillStart: () => void;
  setInput: (value: string) => void;
  setInputPlaceholder: (value: string) => void;
  setSelectionContext: (value: SelectionContext | null) => void;
};

export function useSelectionPrefill(params: UseSelectionPrefillParams): void {
  const {
    inputRef,
    preserveNextOpenRef,
    onPrefillStart,
    setInput,
    setInputPlaceholder,
    setSelectionContext,
  } = params;

  const preserveNextOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    let aborted = false;
    let unlisten: (() => void) | null = null;

    const preservePanelOpenState = () => {
      preserveNextOpenRef.current = true;
      if (preserveNextOpenTimerRef.current) {
        clearTimeout(preserveNextOpenTimerRef.current);
      }

      preserveNextOpenTimerRef.current = setTimeout(() => {
        preserveNextOpenRef.current = false;
        preserveNextOpenTimerRef.current = null;
      }, 700);
    };

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<SelectionPrefillPayload>("panel-prefill-selection", (event) => {
          preservePanelOpenState();
          onPrefillStart();

          const next = resolveSelectionPrefill(event.payload ?? {});
          setInput(next.input);
          setInputPlaceholder(next.placeholder);
          setSelectionContext(next.selectionContext);
          inputRef.current?.focus();
        }),
      )
      .then((dispose) => {
        if (aborted) {
          dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch(() => {
        // Expected outside Tauri runtime.
      });

    return () => {
      aborted = true;
      unlisten?.();
      if (preserveNextOpenTimerRef.current) {
        clearTimeout(preserveNextOpenTimerRef.current);
        preserveNextOpenTimerRef.current = null;
      }
    };
  }, [
    inputRef,
    onPrefillStart,
    preserveNextOpenRef,
    setInput,
    setInputPlaceholder,
    setSelectionContext,
  ]);
}
