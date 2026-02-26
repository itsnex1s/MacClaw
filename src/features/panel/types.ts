export const DEFAULT_INPUT_PLACEHOLDER = "Ask MacClaw...";
export const EMPTY_SELECTION_PLACEHOLDER = "No selected text found";
export const SELECTION_COMPACT_THRESHOLD = 50;

export type SelectionPrefillPayload = {
  text?: string;
  hasText?: boolean;
  error?: string | null;
};

export type SelectionContext = {
  text: string;
  chars: number;
};
