import { safeTrim } from "../../lib/commands";
import type { ConnectionState } from "../../lib/ws-client";
import type { SelectionContext } from "./types";

type PromptBuildParams = {
  selectionContext: SelectionContext | null;
  userInstruction: string;
};

export function buildOutgoingPrompt(params: PromptBuildParams): string {
  const { selectionContext, userInstruction } = params;
  const instruction = safeTrim(userInstruction);
  const selectedText = selectionContext?.text ?? "";
  const selectedChars = selectionContext?.chars ?? 0;
  const hasSelection = selectedText.length > 0;

  if (!hasSelection) {
    return instruction;
  }

  if (!instruction) {
    return selectedText;
  }

  return `Selected text (${selectedChars} chars):\n${selectedText}\n\nInstruction:\n${instruction}`;
}

export function buildQueryLabel(params: PromptBuildParams): string {
  const { selectionContext, userInstruction } = params;
  const instruction = safeTrim(userInstruction);
  const hasSelection = !!selectionContext && selectionContext.text.length > 0;

  if (!hasSelection) {
    return instruction;
  }

  const selectionLabel = `[selected: ${selectionContext.chars} chars]`;
  return instruction ? `${selectionLabel} ${instruction}` : selectionLabel;
}

export function buildStatusMessage(params: {
  gatewayUrl: string;
  connectionState: ConnectionState;
  token: string;
}): string {
  return `Gateway: ${params.gatewayUrl}\nStatus: ${params.connectionState}\nToken: ${params.token ? "***" : "(none)"}`;
}
