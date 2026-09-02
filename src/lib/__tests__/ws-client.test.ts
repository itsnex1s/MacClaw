import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceAuthBridge } from "../device-auth";
import { extractText } from "../extract-text";
import type { DeviceTokenRecord } from "../gateway-protocol";
import { DEFAULT_SETTINGS, type AppSettings } from "../settings";
import { WsClient, type BotEvent, type ConnectionState } from "../ws-client";

describe("extractText", () => {
  it("returns strings as-is", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("reads direct text-like fields", () => {
    expect(extractText({ message: "ok" })).toBe("ok");
  });

  it("reads nested payload arrays", () => {
    expect(
      extractText({
        payloads: [{ text: "first" }, { content: "second" }],
      }),
    ).toBe("first\nsecond");
  });

  it("returns empty string for unsupported objects", () => {
    expect(extractText({ foo: "bar" })).toBe("");
  });

  it("reads content blocks array", () => {
    expect(
      extractText({
        content: [
          { type: "text", text: "block one" },
          { type: "text", text: "block two" },
        ],
      }),
    ).toBe("block one\nblock two");
  });

  it("prefers direct string content over content blocks", () => {
    expect(extractText({ content: "direct string" })).toBe("direct string");
  });

  it("returns empty string for null/undefined", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("returns empty string for arrays", () => {
    expect(extractText([1, 2, 3])).toBe("");
  });
});

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: Record<string, any>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const settle = async () => {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
};

function fakeBridge(stored: DeviceTokenRecord | null = null) {
  const tokens = new Map<string, DeviceTokenRecord>();
  if (stored) tokens.set(DEFAULT_SETTINGS.gatewayUrl, stored);
  const bridge: DeviceAuthBridge = {
    identity: async () => ({ deviceId: "device-1", publicKey: "pub-1" }),
    sign: async (payload) => `sig(${payload})`,
    loadToken: async (url) => tokens.get(url) ?? null,
    saveToken: async (url, record) => {
      tokens.set(url, record);
    },
    clearToken: async (url) => {
      tokens.delete(url);
    },
  };
  return { bridge, tokens };
}

function harness(stored: DeviceTokenRecord | null = null) {
  const states: Array<{ state: ConnectionState; note?: string }> = [];
  const events: BotEvent[] = [];
  const { bridge, tokens } = fakeBridge(stored);
  const client = new WsClient({
    deviceAuth: bridge,
    handlers: {
      onState: (state, note) => states.push({ state, note }),
      onEvent: (event) => events.push(event),
    },
  });
  return { client, states, events, tokens };
}

const settings: AppSettings = { ...DEFAULT_SETTINGS, token: "shared-token" };
const challenge = {
  type: "event",
  event: "connect.challenge",
  payload: { nonce: "n-1", ts: 1700 },
};
const helloOk = (id: string, deviceToken = "dev-token") => ({
  type: "res",
  id,
  ok: true,
  payload: {
    type: "hello-ok",
    protocol: 4,
    auth: {
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      deviceToken,
    },
    policy: { maxPayload: 1, maxBufferedBytes: 1, tickIntervalMs: 30000 },
  },
});

async function connectClient(client: WsClient, options: { stored?: boolean } = {}) {
  client.connect(settings);
  const socket = FakeWebSocket.instances.at(-1)!;
  socket.open();
  socket.receive(challenge);
  await settle();
  const connect = socket.sent.find((frame) => frame.method === "connect")!;
  if (!options.stored) {
    socket.receive(helloOk(connect.id));
  }
  return { socket, connect };
}

describe("WsClient", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("answers the challenge with a signed v4 connect and stores the device token", async () => {
    const { client, states, tokens } = harness();
    const { socket, connect } = await connectClient(client);

    expect(connect.params.minProtocol).toBe(4);
    expect(connect.params.auth).toEqual({ token: "shared-token" });
    expect(connect.params.scopes).toEqual(["operator.read", "operator.write"]);
    expect(connect.params.device).toMatchObject({
      id: "device-1",
      publicKey: "pub-1",
      signedAt: 1700,
      nonce: "n-1",
      signature:
        "sig(v3|device-1|webchat-ui|ui|operator|operator.read,operator.write|1700|shared-token|n-1|darwin|)",
    });
    expect(client.connected).toBe(true);
    expect(client.deviceId).toBe("device-1");
    expect(states.at(-1)?.state).toBe("connected");
    expect(tokens.get(settings.gatewayUrl)).toEqual({
      token: "dev-token",
      scopes: ["operator.read", "operator.write"],
    });
    expect(socket.closeCalls).toHaveLength(0);
  });

  it("reconnects with the stored device token when no shared token is set", async () => {
    const { client } = harness({ token: "stored-token", scopes: ["operator.read"] });
    client.connect({ ...DEFAULT_SETTINGS, token: "" });
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.open();
    socket.receive(challenge);
    await settle();

    const connect = socket.sent.find((frame) => frame.method === "connect")!;
    expect(connect.params.auth).toEqual({
      token: "stored-token",
      deviceToken: "stored-token",
    });
    expect(connect.params.scopes).toEqual(["operator.read"]);
    expect(connect.params.device.signature).toContain(
      "|operator.read|1700|stored-token|",
    );
  });

  it("surfaces pairing instructions and retries after the gateway closes the socket", async () => {
    vi.useFakeTimers();
    const { client, states } = harness();
    const verify = client.connectAndVerify(settings);
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.open();
    socket.receive(challenge);
    await settle();
    const connect = socket.sent.find((frame) => frame.method === "connect")!;
    socket.receive({
      type: "res",
      id: connect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "pairing required",
        details: {
          code: "PAIRING_REQUIRED",
          requestId: "req-42",
          recommendedNextStep: "wait_then_retry",
          retryable: true,
          pauseReconnect: false,
        },
      },
    });
    await expect(verify).rejects.toThrow("openclaw devices approve req-42");
    expect(states.at(-1)).toMatchObject({ state: "error" });

    socket.close(1008, "pairing required");
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("stops reconnecting after a token mismatch", async () => {
    vi.useFakeTimers();
    const { client, states } = harness();
    client.connect(settings);
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.open();
    socket.receive(challenge);
    await settle();
    const connect = socket.sent.find((frame) => frame.method === "connect")!;
    socket.receive({
      type: "res",
      id: connect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized: gateway token mismatch",
        details: { code: "AUTH_TOKEN_MISMATCH" },
      },
    });
    socket.close(1008, "unauthorized");
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(states.at(-1)).toMatchObject({ state: "error" });
    expect(states.at(-1)?.note).toContain("token mismatch");
    expect(client.lastFailure?.code).toBe("AUTH_TOKEN_MISMATCH");
  });

  it("streams chat deltas for the active run and ignores other runs", async () => {
    const { client, events } = harness();
    const { socket } = await connectClient(client);

    client.sendChatMessage("hello", settings);
    const send = socket.sent.find((frame) => frame.method === "chat.send")!;
    expect(send.params).toEqual({
      message: "hello",
      sessionKey: "main",
      idempotencyKey: "uuid-1",
    });
    socket.receive({
      type: "res",
      id: send.id,
      ok: true,
      payload: { runId: "run-1", status: "started" },
    });
    await settle();

    socket.receive({
      type: "event",
      event: "chat",
      payload: { runId: "run-9", state: "delta", deltaText: "noise" },
    });
    socket.receive({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "agent:dev:main",
        state: "delta",
        deltaText: "Hel",
      },
    });
    socket.receive({
      type: "event",
      event: "chat",
      payload: { runId: "run-1", state: "delta", deltaText: "lo" },
    });
    socket.receive({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        state: "final",
        message: { content: [{ type: "text", text: "Hello!" }] },
      },
    });

    expect(events).toEqual([
      { kind: "assistant_delta", text: "Hel" },
      { kind: "assistant_delta", text: "Hello" },
      { kind: "assistant_done" },
      { kind: "assistant", text: "Hello!" },
    ]);
    expect(client.currentSessionKey).toBe("agent:dev:main");
  });

  it("reports a rejected chat.send as an error event", async () => {
    const { client, events } = harness();
    const { socket } = await connectClient(client);
    client.sendChatMessage("hello", settings);
    const send = socket.sent.find((frame) => frame.method === "chat.send")!;
    socket.receive({
      type: "res",
      id: send.id,
      ok: false,
      error: { code: "INVALID_REQUEST", message: "missing scope" },
    });
    await settle();
    expect(events).toEqual([{ kind: "error", text: "missing scope" }]);
  });

  it("closes a silent socket after two tick intervals", async () => {
    vi.useFakeTimers();
    const { client } = harness();
    const { socket } = await connectClient(client);
    await vi.advanceTimersByTimeAsync(59000);
    expect(socket.closeCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(socket.closeCalls).toEqual([{ code: 4000, reason: "tick timeout" }]);
  });
});
