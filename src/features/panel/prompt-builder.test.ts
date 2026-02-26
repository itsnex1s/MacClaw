import { describe, expect, it } from "vitest";
import {
  buildOutgoingPrompt,
  buildQueryLabel,
  buildStatusMessage,
} from "./prompt-builder";

describe("buildOutgoingPrompt", () => {
  it("returns instruction when there is no selection", () => {
    expect(
      buildOutgoingPrompt({
        selectionContext: null,
        userInstruction: " summarize ",
      }),
    ).toBe("summarize");
  });

  it("returns selected text when instruction is empty", () => {
    expect(
      buildOutgoingPrompt({
        selectionContext: { text: "Hello world", chars: 11 },
        userInstruction: " ",
      }),
    ).toBe("Hello world");
  });

  it("combines selection and instruction into a single prompt", () => {
    expect(
      buildOutgoingPrompt({
        selectionContext: { text: "Source", chars: 6 },
        userInstruction: "Summarize",
      }),
    ).toContain("Instruction:\nSummarize");
  });
});

describe("buildQueryLabel", () => {
  it("returns plain instruction without selection", () => {
    expect(
      buildQueryLabel({ selectionContext: null, userInstruction: "translate" }),
    ).toBe("translate");
  });

  it("returns selection label only when no instruction", () => {
    expect(
      buildQueryLabel({
        selectionContext: { text: "abc", chars: 3 },
        userInstruction: " ",
      }),
    ).toBe("[selected: 3 chars]");
  });
});

describe("buildStatusMessage", () => {
  it("masks token in status output", () => {
    expect(
      buildStatusMessage({
        gatewayUrl: "ws://localhost:8765",
        connectionState: "connected",
        token: "secret",
      }),
    ).toContain("Token: ***");
  });
});
