import { useCallback, useState } from "react";
import type { WsClient } from "../lib/ws-client";
import { getMediaUrl, getMediaCacheEntry } from "../lib/media-cache";
import { mediaKind, fileNameFromPath } from "../lib/media-types";

interface MediaBlockProps {
  filePath: string;
  mimeType: string;
  client: WsClient;
}

export function MediaBlock({ filePath, mimeType, client }: MediaBlockProps) {
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  const url = getMediaUrl(client, filePath, mimeType, forceUpdate);
  const entry = getMediaCacheEntry(filePath);
  const kind = mediaKind(mimeType);

  if (entry?.state === "error") {
    return (
      <div className="media-block media-block--error">
        Failed to load: {fileNameFromPath(filePath)}
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

  if (kind === "image") {
    return (
      <div className="media-block">
        <img
          src={url}
          alt={fileNameFromPath(filePath)}
          className="media-block--image"
        />
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="media-block media-block--audio">
        <audio controls preload="none">
          <source src={url} type={mimeType} />
        </audio>
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="media-block media-block--video">
        <video controls preload="metadata" className="media-video">
          <source src={url} type={mimeType} />
        </video>
      </div>
    );
  }

  return (
    <div className="media-block">
      <a href={url} download={fileNameFromPath(filePath)} className="media-file-link">
        {fileNameFromPath(filePath)}
      </a>
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
