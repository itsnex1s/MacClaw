// Runs the real WsClient against a live gateway. Skipped unless MACCLAW_GATEWAY_URL is set:
//   MACCLAW_GATEWAY_URL=ws://127.0.0.1:18789 MACCLAW_GATEWAY_TOKEN=... npx vitest run gateway.live
import { Buffer } from "node:buffer";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceAuthBridge } from "../device-auth";
import type { DeviceTokenRecord } from "../gateway-protocol";
import { DEFAULT_SETTINGS } from "../settings";
import { WsClient, type BotEvent, type ConnectionState } from "../ws-client";

const gatewayUrl = process.env.MACCLAW_GATEWAY_URL;
const token = process.env.MACCLAW_GATEWAY_TOKEN ?? "";

function nodeBridge(): {
  bridge: DeviceAuthBridge;
  tokens: Map<string, DeviceTokenRecord>;
} {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { x: string };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const publicKey = jwk.x;
  const deviceId = createHash("sha256")
    .update(Buffer.from(publicKey, "base64url"))
    .digest("hex");
  const tokens = new Map<string, DeviceTokenRecord>();
  return {
    tokens,
    bridge: {
      identity: async () => ({ deviceId, publicKey }),
      sign: async (payload) =>
        sign(null, Buffer.from(payload, "utf8"), key).toString("base64url"),
      loadToken: async (url) => tokens.get(url) ?? null,
      saveToken: async (url, record) => {
        tokens.set(url, record);
      },
      clearToken: async (url) => {
        tokens.delete(url);
      },
    },
  };
}

describe.skipIf(!gatewayUrl)("live gateway", () => {
  // Node sends no Origin header; the WebView sends tauri://localhost, which the gateway checks.
  const NativeWebSocket = globalThis.WebSocket;
  class OriginWebSocket extends NativeWebSocket {
    constructor(url: string | URL) {
      super(url, { headers: { origin: "tauri://localhost" } } as unknown as string[]);
    }
  }

  beforeEach(() => vi.stubGlobal("WebSocket", OriginWebSocket));
  afterEach(() => vi.unstubAllGlobals());

  it("completes the v4 handshake, stores the device token and gets chat events", async () => {
    const states: ConnectionState[] = [];
    const events: BotEvent[] = [];
    const { bridge, tokens } = nodeBridge();
    const client = new WsClient({
      deviceAuth: bridge,
      handlers: {
        onState: (state) => states.push(state),
        onEvent: (event) => events.push(event),
      },
    });
    const settings = { ...DEFAULT_SETTINGS, gatewayUrl: gatewayUrl!, token };

    await expect(client.connectAndVerify(settings, 15000)).resolves.toBe("Connected");
    expect(states).toContain("connected");
    expect(tokens.get(gatewayUrl!)?.token).toBeTruthy();

    client.sendChatMessage("Reply with the single word: pong", settings);
    const deadline = Date.now() + 30000;
    while (
      Date.now() < deadline &&
      !events.some((e) => e.kind === "assistant" || e.kind === "error")
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    client.disconnect();

    const terminal = events.find((e) => e.kind === "assistant" || e.kind === "error");
    expect(terminal).toBeDefined();
    console.warn("live gateway events:", JSON.stringify(events).slice(0, 400));
  }, 60000);
});
