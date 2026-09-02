import type { WsClient } from "./ws-client";

type CacheEntry =
  | { state: "loading" }
  | { state: "ready"; url: string; objectUrl: boolean }
  | { state: "error"; message: string };

type ArtifactDownload = {
  encoding?: string;
  data?: string;
  url?: string;
};

const cache = new Map<string, CacheEntry>();

/** ws(s):// gateway URL to the http(s):// origin that serves artifact downloads. */
function gatewayHttpOrigin(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

async function downloadArtifact(
  client: WsClient,
  artifactId: string,
  mimeType: string,
): Promise<{ url: string; objectUrl: boolean }> {
  const result = await client.request<ArtifactDownload>("artifacts.download", {
    sessionKey: client.currentSessionKey,
    artifactId,
  });

  if (typeof result.data === "string" && result.data) {
    return { url: `data:${mimeType};base64,${result.data}`, objectUrl: false };
  }

  if (typeof result.url === "string" && result.url) {
    // The gateway hands out a short-lived URL that may be relative to its HTTP origin.
    const target = new URL(result.url, gatewayHttpOrigin(client.gatewayUrl));
    const response = await fetch(target);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return { url: URL.createObjectURL(await response.blob()), objectUrl: true };
  }

  throw new Error("Download not supported for this artifact");
}

/**
 * Get a displayable URL for a gateway artifact. Returns the cached URL if
 * available, null while loading. Calls `onLoaded` when the download completes
 * so the component can re-render.
 */
export function getArtifactUrl(
  client: WsClient,
  artifactId: string,
  mimeType: string,
  onLoaded: () => void,
): string | null {
  const entry = cache.get(artifactId);

  if (entry?.state === "ready") return entry.url;
  if (entry?.state === "loading") return null;
  if (entry?.state === "error") return null;

  cache.set(artifactId, { state: "loading" });

  downloadArtifact(client, artifactId, mimeType)
    .then((ready) => {
      cache.set(artifactId, { state: "ready", ...ready });
      onLoaded();
    })
    .catch((error: unknown) => {
      cache.set(artifactId, {
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      onLoaded();
    });

  return null;
}

export function getMediaCacheEntry(artifactId: string): CacheEntry | undefined {
  return cache.get(artifactId);
}

export function clearMediaCache(): void {
  for (const entry of cache.values()) {
    if (entry.state === "ready" && entry.objectUrl) {
      URL.revokeObjectURL(entry.url);
    }
  }
  cache.clear();
}
