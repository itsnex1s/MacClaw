export type AppSettings = {
  gatewayUrl: string;
  token: string;
  password: string;
  agentId: string;
  sessionKey: string;
  shortcuts: [string, string, string];
};

export const DEFAULT_SETTINGS: AppSettings = {
  gatewayUrl: "ws://127.0.0.1:19819",
  token: "",
  password: "",
  agentId: "",
  sessionKey: "main",
  shortcuts: ["CmdOrCtrl+Shift+Space", "CmdOrCtrl+Shift+K", "Alt+Space"],
};

const LOCAL_FALLBACK_KEY = "macclaw.panel.settings";

type LocalFallbackSettings = {
  gatewayUrl?: string;
  agentId?: string;
  sessionKey?: string;
  shortcuts?: [string, string, string];
};

type KeychainCredentials = {
  gatewayUrl?: string;
  token?: string;
  password?: string;
  agentId?: string;
  sessionKey?: string;
  shortcuts?: string[] | null;
};

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asShortcuts(
  value: unknown,
  fallback: [string, string, string],
): [string, string, string] {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((v) => typeof v === "string" && v.length > 0)
  ) {
    return value as [string, string, string];
  }
  return fallback;
}

export function normalizeSettings(input?: Partial<AppSettings>): AppSettings {
  const source = input ?? {};

  return {
    gatewayUrl: asText(source.gatewayUrl, DEFAULT_SETTINGS.gatewayUrl),
    token: asText(source.token, DEFAULT_SETTINGS.token),
    password: asText(source.password, DEFAULT_SETTINGS.password),
    agentId: asText(source.agentId, DEFAULT_SETTINGS.agentId),
    sessionKey: asText(source.sessionKey, DEFAULT_SETTINGS.sessionKey),
    shortcuts: asShortcuts(source.shortcuts, DEFAULT_SETTINGS.shortcuts),
  };
}

function loadFromLocalStorage(): AppSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_FALLBACK_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as LocalFallbackSettings;
    return normalizeSettings({
      gatewayUrl: parsed.gatewayUrl,
      agentId: parsed.agentId,
      sessionKey: parsed.sessionKey,
      shortcuts: parsed.shortcuts,
      token: "",
      password: "",
    });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveToLocalStorage(settings: AppSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const safeFallback: LocalFallbackSettings = {
      gatewayUrl: settings.gatewayUrl,
      agentId: settings.agentId,
      sessionKey: settings.sessionKey,
      shortcuts: settings.shortcuts,
    };
    window.localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(safeFallback));
  } catch {
    // Ignore browser fallback storage failures.
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const creds = await invoke<KeychainCredentials>("load_credentials");

    return normalizeSettings({
      gatewayUrl: creds.gatewayUrl,
      token: creds.token,
      password: creds.password,
      agentId: creds.agentId,
      sessionKey: creds.sessionKey,
      shortcuts: (creds.shortcuts ?? undefined) as
        | [string, string, string]
        | undefined,
    });
  } catch {
    return loadFromLocalStorage();
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const normalized = normalizeSettings(settings);

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_credentials", {
      creds: {
        gatewayUrl: normalized.gatewayUrl,
        token: normalized.token,
        password: normalized.password,
        agentId: normalized.agentId,
        sessionKey: normalized.sessionKey,
        shortcuts: normalized.shortcuts,
      },
    });
    return;
  } catch {
    saveToLocalStorage(normalized);
  }
}
