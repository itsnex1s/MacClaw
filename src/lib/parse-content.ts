import { guessMime } from "./media-types";

export interface TextSegment {
  kind: "text";
  value: string;
}

export interface MediaSegment {
  kind: "media";
  filePath: string;
  mimeType: string;
}

export interface InlineImageSegment {
  kind: "inline-image";
  mediaType: string;
  base64: string;
}

export type ContentSegment = TextSegment | MediaSegment | InlineImageSegment;

const MEDIA_RE = /^\s*MEDIA:\s*(\S+)/;
const INLINE_IMAGE_RE = /^<!--INLINE_IMAGE:([^:]+):(.+)-->$/;

/**
 * Parse raw response text into renderable segments.
 * - Strips ```tool_code blocks (complete + unclosed trailing)
 * - Extracts MEDIA: /path lines into MediaSegments
 * - Extracts <!--INLINE_IMAGE:mime:base64--> markers into InlineImageSegments
 * - Keeps remaining text as TextSegments
 */
export function parseContent(raw: string): ContentSegment[] {
  if (!raw) return [];

  // Strip complete tool_code blocks
  let cleaned = raw.replace(/```tool_code\n[\s\S]*?```/g, "");

  // Strip unclosed tool_code block at the end (streaming)
  cleaned = cleaned.replace(/```tool_code\n[\s\S]*$/, "");

  const segments: ContentSegment[] = [];
  let textBuf = "";

  const flushText = () => {
    const trimmed = textBuf.trim();
    if (trimmed) {
      segments.push({ kind: "text", value: trimmed });
    }
    textBuf = "";
  };

  for (const line of cleaned.split("\n")) {
    const inlineMatch = line.match(INLINE_IMAGE_RE);
    if (inlineMatch) {
      flushText();
      segments.push({
        kind: "inline-image",
        mediaType: inlineMatch[1],
        base64: inlineMatch[2],
      });
      continue;
    }

    const mediaMatch = line.match(MEDIA_RE);
    if (mediaMatch) {
      flushText();
      const filePath = mediaMatch[1];
      segments.push({
        kind: "media",
        filePath,
        mimeType: guessMime(filePath),
      });
      continue;
    }

    textBuf += (textBuf ? "\n" : "") + line;
  }

  flushText();
  return segments;
}
