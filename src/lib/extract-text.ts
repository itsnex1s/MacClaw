export type JsonMap = Record<string, unknown>;

export function isJsonMap(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseFrame(raw: string): JsonMap | null {
  try {
    const parsed = JSON.parse(raw);
    return isJsonMap(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Like extractText but preserves image content blocks as markers that flow
 * through the text pipeline and get parsed at render time:
 * <!--ARTIFACT_IMAGE:artifact_id:mime--> for gateway-managed artifacts and
 * <!--INLINE_IMAGE:media_type:base64_data--> for inline base64 images.
 */
export function extractTextWithMedia(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (!isJsonMap(input)) {
    return "";
  }

  // Handle content blocks array with mixed text + image blocks
  if (Array.isArray(input.content)) {
    const parts: string[] = [];
    for (const block of input.content) {
      if (!isJsonMap(block)) continue;

      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
        continue;
      }

      // Managed images carry an artifactId; the bytes come from artifacts.download.
      if (
        block.type === "image" &&
        typeof block.artifactId === "string" &&
        block.artifactId
      ) {
        const mime =
          typeof block.mimeType === "string"
            ? block.mimeType
            : typeof block.mediaType === "string"
              ? block.mediaType
              : "image/png";
        parts.push(`<!--ARTIFACT_IMAGE:${block.artifactId}:${mime}-->`);
        continue;
      }

      if (
        block.type === "image" &&
        isJsonMap(block.source as unknown) &&
        (block.source as JsonMap).type === "base64" &&
        typeof (block.source as JsonMap).media_type === "string" &&
        typeof (block.source as JsonMap).data === "string"
      ) {
        const src = block.source as JsonMap;
        parts.push(
          `<!--INLINE_IMAGE:${src.media_type as string}:${src.data as string}-->`,
        );
        continue;
      }
    }

    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  // Fall back to extractText for everything else
  return extractText(input);
}

export function extractText(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (!isJsonMap(input)) {
    return "";
  }

  const directTextFields = [
    input.text,
    input.message,
    input.content,
    input.summary,
    input.delta,
  ];

  for (const field of directTextFields) {
    if (typeof field === "string" && field.length > 0) {
      return field;
    }
  }

  // Handle content blocks: [{type: "text", text: "..."}]
  if (Array.isArray(input.content)) {
    const parts = input.content
      .filter(
        (block: unknown) =>
          isJsonMap(block) && block.type === "text" && typeof block.text === "string",
      )
      .map((block: unknown) => String((block as JsonMap).text))
      .filter(Boolean);

    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  if (Array.isArray(input.payloads)) {
    const nested = input.payloads
      .map((payload) => extractText(payload))
      .filter(Boolean)
      .join("\n")
      .trim();

    if (nested) {
      return nested;
    }
  }

  return "";
}
