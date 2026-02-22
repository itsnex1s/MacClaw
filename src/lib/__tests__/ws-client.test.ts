import { describe, expect, it } from "vitest";
import { extractText } from "../extract-text";

describe("extractText", () => {
  it("returns strings as-is", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("reads direct text-like fields", () => {
    expect(extractText({ message: "ok" })).toBe("ok");
  });

  it("reads nested payload arrays", () => {
    expect(
      extractText({
        payloads: [{ text: "first" }, { content: "second" }],
      }),
    ).toBe("first\nsecond");
  });

  it("returns empty string for unsupported objects", () => {
    expect(extractText({ foo: "bar" })).toBe("");
  });

  it("reads content blocks array", () => {
    expect(
      extractText({
        content: [
          { type: "text", text: "block one" },
          { type: "text", text: "block two" },
        ],
      }),
    ).toBe("block one\nblock two");
  });

  it("prefers direct string content over content blocks", () => {
    expect(extractText({ content: "direct string" })).toBe("direct string");
  });

  it("returns empty string for null/undefined", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("returns empty string for arrays", () => {
    expect(extractText([1, 2, 3])).toBe("");
  });
});
