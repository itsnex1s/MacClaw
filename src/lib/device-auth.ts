// Bridge to the Rust side for the device identity, challenge signing and device tokens.
import type { DeviceIdentity, DeviceTokenRecord } from "./gateway-protocol";

export type DeviceAuthBridge = {
  identity: () => Promise<DeviceIdentity | null>;
  sign: (payload: string) => Promise<string>;
  loadToken: (gatewayUrl: string) => Promise<DeviceTokenRecord | null>;
  saveToken: (gatewayUrl: string, record: DeviceTokenRecord) => Promise<void>;
  clearToken: (gatewayUrl: string) => Promise<void>;
};

async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/** Outside Tauri (browser dev mode) there is no identity; the gateway then decides. */
export const tauriDeviceAuth: DeviceAuthBridge = {
  async identity() {
    try {
      return await tauriInvoke<DeviceIdentity>("device_identity");
    } catch (error) {
      console.warn("device identity unavailable:", error);
      return null;
    }
  },
  sign(payload) {
    return tauriInvoke<string>("sign_device_payload", { payload });
  },
  async loadToken(gatewayUrl) {
    try {
      return await tauriInvoke<DeviceTokenRecord | null>("load_device_token", {
        gatewayUrl,
      });
    } catch (error) {
      console.warn("device token unavailable:", error);
      return null;
    }
  },
  async saveToken(gatewayUrl, record) {
    try {
      await tauriInvoke("save_device_token", { gatewayUrl, record });
    } catch (error) {
      console.warn("device token not saved:", error);
    }
  },
  async clearToken(gatewayUrl) {
    try {
      await tauriInvoke("clear_device_token", { gatewayUrl });
    } catch (error) {
      console.warn("device token not cleared:", error);
    }
  },
};
