import { describe, expect, it } from "vitest";
import { extractTextWithMedia } from "../extract-text";
import { parseContent } from "../parse-content";

describe("extractTextWithMedia", () => {
  it("keeps managed images as artifact markers next to the text", () => {
    const text = extractTextWithMedia({
      content: [
        { type: "text", text: "Here you go" },
        {
          type: "image",
          artifactId: "art-1",
          mimeType: "image/png",
          url: "/artifacts/art-1",
        },
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
        },
      ],
    });
    expect(text).toBe(
      "Here you go\n<!--ARTIFACT_IMAGE:art-1:image/png-->\n<!--INLINE_IMAGE:image/jpeg:AAAA-->",
    );
  });
});

describe("parseContent", () => {
  it("splits artifact markers, legacy MEDIA lines and text", () => {
    expect(
      parseContent(
        "Result:\n<!--ARTIFACT_IMAGE:art-1:image/png-->\nMEDIA:/tmp/report.pdf\nDone",
      ),
    ).toEqual([
      { kind: "text", value: "Result:" },
      { kind: "artifact-image", artifactId: "art-1", mimeType: "image/png" },
      { kind: "media", filePath: "/tmp/report.pdf", mimeType: "application/pdf" },
      { kind: "text", value: "Done" },
    ]);
  });
});
