import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from "../settings";

describe("normalizeSettings", () => {
  it("fills defaults for empty input", () => {
    expect(normalizeSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps provided values", () => {
    expect(
      normalizeSettings({
        gatewayUrl: "ws://example/ws",
        token: "token",
        password: "pass",
        agentId: "a1",
        sessionKey: "s1",
        shortcuts: ["Alt+A", "Alt+B", "Alt+C"],
      }),
    ).toEqual({
      gatewayUrl: "ws://example/ws",
      token: "token",
      password: "pass",
      agentId: "a1",
      sessionKey: "s1",
      shortcuts: ["Alt+A", "Alt+B", "Alt+C"],
    });
  });

  it("normalizes non-string values to defaults", () => {
    expect(
      normalizeSettings({
        gatewayUrl: 1 as unknown as string,
        token: null as unknown as string,
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      gatewayUrl: DEFAULT_SETTINGS.gatewayUrl,
      token: DEFAULT_SETTINGS.token,
    });
  });
});

describe("fallback storage", () => {
  const localStorageMock = {
    store: new Map<string, string>(),
    getItem(key: string) {
      return this.store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      this.store.set(key, value);
    },
  };

  beforeEach(() => {
    localStorageMock.store.clear();
    Object.assign(globalThis, {
      window: {
        localStorage: localStorageMock,
      },
    });
  });

  it("stores only non-sensitive settings when keychain is unavailable", async () => {
    await saveSettings({
      gatewayUrl: "ws://example/ws",
      token: "secret-token",
      password: "secret-password",
      agentId: "agent-1",
      sessionKey: "main",
    });

    const savedRaw = localStorageMock.getItem("macclaw.panel.settings");
    expect(savedRaw).not.toBeNull();

    const saved = JSON.parse(savedRaw as string) as Record<string, string>;
    expect(saved.gatewayUrl).toBe("ws://example/ws");
    expect(saved.agentId).toBe("agent-1");
    expect(saved.sessionKey).toBe("main");
    expect(saved.token).toBeUndefined();
    expect(saved.password).toBeUndefined();
  });

  it("drops token/password from legacy fallback payloads", async () => {
    localStorageMock.setItem(
      "macclaw.panel.settings",
      JSON.stringify({
        gatewayUrl: "ws://example/ws",
        agentId: "agent-1",
        sessionKey: "main",
        token: "legacy-token",
        password: "legacy-password",
      }),
    );

    const loaded = await loadSettings();

    expect(loaded.gatewayUrl).toBe("ws://example/ws");
    expect(loaded.agentId).toBe("agent-1");
    expect(loaded.sessionKey).toBe("main");
    expect(loaded.token).toBe("");
    expect(loaded.password).toBe("");
  });
});
