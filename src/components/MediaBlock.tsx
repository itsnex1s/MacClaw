import { useCallback, useState } from "react";
import type { WsClient } from "../lib/ws-client";
import { getArtifactUrl, getMediaCacheEntry } from "../lib/media-cache";
import { fileNameFromPath } from "../lib/media-types";

interface ArtifactImageProps {
  artifactId: string;
  mimeType: string;
  client: WsClient;
}

/** Image produced by the agent; bytes arrive through artifacts.download. */
export function ArtifactImage({ artifactId, mimeType, client }: ArtifactImageProps) {
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  const url = getArtifactUrl(client, artifactId, mimeType, forceUpdate);
  const entry = getMediaCacheEntry(artifactId);

  if (entry?.state === "error") {
    return (
      <div className="media-block media-block--error">
        Failed to load image: {entry.message}
      </div>
    );
  }

  if (!url) {
    return (
      <div className="media-block media-block--loading">
        <span className="media-block-loader" />
      </div>
    );
  }

  return (
    <div className="media-block">
      <img src={url} alt="Generated image" className="media-block--image" />
    </div>
  );
}

interface LegacyMediaProps {
  filePath: string;
}

/** A legacy `MEDIA:/path` line: the gateway no longer serves local files, so show the name. */
export function LegacyMedia({ filePath }: LegacyMediaProps) {
  return (
    <div className="media-block">
      <span className="media-file-link" title={filePath}>
        {fileNameFromPath(filePath)}
      </span>
    </div>
  );
}

interface InlineImageProps {
  mediaType: string;
  base64: string;
}

export function InlineImage({ mediaType, base64 }: InlineImageProps) {
  return (
    <div className="media-block">
      <img
        src={`data:${mediaType};base64,${base64}`}
        alt="Inline image"
        className="media-block--image"
      />
    </div>
  );
}
