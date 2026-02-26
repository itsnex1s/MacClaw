import { parsePanelCommand, safeTrim } from "../../lib/commands";
import type { ConnectionState } from "../../lib/ws-client";
import {
  buildOutgoingPrompt,
  buildQueryLabel,
  buildStatusMessage,
} from "./prompt-builder";
import type { SelectionContext } from "./types";

type ResolveSubmitParams = {
  rawInput: string;
  selectionContext: SelectionContext | null;
  gatewayUrl: string;
  token: string;
  connectionState: ConnectionState;
};

export type SubmitAction =
  | { kind: "noop" }
  | { kind: "open_connect" }
  | { kind: "open_settings" }
  | { kind: "show_status"; query: string; message: string }
  | { kind: "send_prompt"; outgoingPrompt: string; queryLabel: string };

export function resolveSubmitAction(params: ResolveSubmitParams): SubmitAction {
  const rawInput = safeTrim(params.rawInput);
  const command = parsePanelCommand(rawInput);

  if (!command && !params.selectionContext) {
    return { kind: "noop" };
  }

  if (command?.kind === "connect") {
    return { kind: "open_connect" };
  }

  if (command?.kind === "settings") {
    return { kind: "open_settings" };
  }

  if (command?.kind === "status") {
    return {
      kind: "show_status",
      query: "/status",
      message: buildStatusMessage({
        gatewayUrl: params.gatewayUrl,
        connectionState: params.connectionState,
        token: params.token,
      }),
    };
  }

  const isSelectionOnly = !command && !!params.selectionContext;
  const promptCommand = command?.kind === "prompt" ? command : null;
  if (!isSelectionOnly && !promptCommand) {
    return { kind: "noop" };
  }

  const userInstruction = safeTrim(promptCommand?.text ?? rawInput);
  const outgoingPrompt = buildOutgoingPrompt({
    selectionContext: params.selectionContext,
    userInstruction,
  });
  if (!outgoingPrompt) {
    return { kind: "noop" };
  }

  return {
    kind: "send_prompt",
    outgoingPrompt,
    queryLabel: buildQueryLabel({
      selectionContext: params.selectionContext,
      userInstruction,
    }),
  };
}
