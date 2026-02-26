import { safeTrim } from "../../lib/commands";
import {
  DEFAULT_INPUT_PLACEHOLDER,
  EMPTY_SELECTION_PLACEHOLDER,
  SELECTION_COMPACT_THRESHOLD,
  type SelectionContext,
  type SelectionPrefillPayload,
} from "./types";

export type SelectionPrefillState = {
  input: string;
  placeholder: string;
  selectionContext: SelectionContext | null;
};

export function resolveSelectionPrefill(
  payload: SelectionPrefillPayload,
): SelectionPrefillState {
  const text = safeTrim(typeof payload.text === "string" ? payload.text : "");

  if (text.length > 0 || payload.hasText) {
    const chars = text.length;
    if (chars > SELECTION_COMPACT_THRESHOLD) {
      return {
        input: "",
        placeholder: DEFAULT_INPUT_PLACEHOLDER,
        selectionContext: { text, chars },
      };
    }

    return {
      input: text,
      placeholder: DEFAULT_INPUT_PLACEHOLDER,
      selectionContext: null,
    };
  }

  const payloadError = safeTrim(payload.error ?? "");
  return {
    input: "",
    placeholder: payloadError || EMPTY_SELECTION_PLACEHOLDER,
    selectionContext: null,
  };
}
