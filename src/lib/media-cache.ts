import type { WsClient } from "./ws-client";

type CacheEntry =
  | { state: "loading" }
  | { state: "ready"; dataUrl: string }
  | { state: "error"; message: string };

const cache = new Map<string, CacheEntry>();

/**
 * Get a data URL for a gateway file. Returns the cached data URL if available,
 * null while loading. Calls `onLoaded` when the fetch completes so the
 * component can re-render.
 */
export function getMediaUrl(
  client: WsClient,
  filePath: string,
  mimeType: string,
  onLoaded: () => void,
): string | null {
  const entry = cache.get(filePath);

  if (entry?.state === "ready") return entry.dataUrl;
  if (entry?.state === "loading") return null;
  if (entry?.state === "error") return null;

  cache.set(filePath, { state: "loading" });

  client
    .request<{ data: string }>("files.read", { path: filePath })
    .then((result) => {
      const dataUrl = `data:${mimeType};base64,${result.data}`;
      cache.set(filePath, { state: "ready", dataUrl });
      onLoaded();
    })
    .catch((err) => {
      cache.set(filePath, {
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      onLoaded();
    });

  return null;
}

export function getMediaCacheEntry(filePath: string): CacheEntry | undefined {
  return cache.get(filePath);
}

export function clearMediaCache(): void {
  cache.clear();
}
