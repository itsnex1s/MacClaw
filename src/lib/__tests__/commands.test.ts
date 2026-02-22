import { describe, expect, it } from "vitest";
import { parsePanelCommand, safeTrim } from "../commands";

describe("safeTrim", () => {
  it("trims surrounding spaces", () => {
    expect(safeTrim("  hi  ")).toBe("hi");
  });
});

describe("parsePanelCommand", () => {
  it("returns null for empty input", () => {
    expect(parsePanelCommand("   ")).toBeNull();
  });

  it("recognizes /connect", () => {
    expect(parsePanelCommand(" /connect ")).toEqual({ kind: "connect" });
  });

  it("recognizes /status", () => {
    expect(parsePanelCommand("/status")).toEqual({ kind: "status" });
  });

  it("treats normal text as prompt", () => {
    expect(parsePanelCommand("hello")).toEqual({ kind: "prompt", text: "hello" });
  });
});
