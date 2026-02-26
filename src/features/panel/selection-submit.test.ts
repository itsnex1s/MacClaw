import { describe, expect, it } from "vitest";
import { resolveSelectionPrefill } from "./selection-prefill";
import { resolveSubmitAction } from "./submit-resolver";

describe("resolveSelectionPrefill", () => {
  it("compacts long selected text into badge context", () => {
    const longSelection = "a".repeat(60);
    const result = resolveSelectionPrefill({ text: longSelection, hasText: true });

    expect(result.input).toBe("");
    expect(result.selectionContext).toEqual({ text: longSelection, chars: 60 });
  });

  it("puts short selected text directly in input", () => {
    const result = resolveSelectionPrefill({ text: "short text", hasText: true });

    expect(result.input).toBe("short text");
    expect(result.selectionContext).toBeNull();
  });

  it("shows payload error when selection was not captured", () => {
    const result = resolveSelectionPrefill({
      text: "",
      hasText: false,
      error: "Grant Accessibility permission",
    });

    expect(result.placeholder).toBe("Grant Accessibility permission");
  });
});

describe("resolveSubmitAction", () => {
  it("routes /connect command", () => {
    expect(
      resolveSubmitAction({
        rawInput: "/connect",
        selectionContext: null,
        gatewayUrl: "ws://localhost:8765",
        token: "",
        connectionState: "idle",
      }),
    ).toEqual({ kind: "open_connect" });
  });

  it("builds prompt with selection and user instruction", () => {
    const action = resolveSubmitAction({
      rawInput: "summarize this",
      selectionContext: { text: "Selected source", chars: 15 },
      gatewayUrl: "ws://localhost:8765",
      token: "",
      connectionState: "connected",
    });

    expect(action.kind).toBe("send_prompt");
    if (action.kind === "send_prompt") {
      expect(action.outgoingPrompt).toContain("Selected source");
      expect(action.outgoingPrompt).toContain("Instruction:\nsummarize this");
    }
  });

  it("returns noop for empty submit without selection", () => {
    expect(
      resolveSubmitAction({
        rawInput: "   ",
        selectionContext: null,
        gatewayUrl: "ws://localhost:8765",
        token: "",
        connectionState: "connected",
      }),
    ).toEqual({ kind: "noop" });
  });
});
