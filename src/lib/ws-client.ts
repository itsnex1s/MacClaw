import { tauriDeviceAuth, type DeviceAuthBridge } from "./device-auth";
import { extractText, isJsonMap, parseFrame, type JsonMap } from "./extract-text";
import {
  buildConnectParams,
  buildDeviceAuthPayload,
  describeConnectFailure,
  OPERATOR_ROLE,
  parseChatEvent,
  parseConnectChallenge,
  parseConnectFailure,
  selectConnectAuth,
  shouldPauseReconnect,
  type ConnectFailure,
  type DeviceIdentity,
} from "./gateway-protocol";
import type { AppSettings } from "./settings";

export { extractText } from "./extract-text";

export type ConnectionState = "idle" | "connecting" | "connected" | "error";

export type BotEvent =
  | { kind: "assistant"; text: string }
  | { kind: "assistant_delta"; text: string }
  | { kind: "assistant_done" }
  | { kind: "error"; text: string }
  | { kind: "info"; text: string };

type Handlers = {
  onState: (state: ConnectionState, note?: string) => void;
  onEvent: (event: BotEvent) => void;
};

type Attempt = {
  onSuccess: () => void;
  onFailure: (reason: string) => void;
};

type Pending = {
  resolve: (payload: unknown) => void;
  reject: (error: GatewayError) => void;
};

/** Error returned by the gateway in a `res` frame; `raw` keeps the structured details. */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly raw: unknown = null,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

const CHALLENGE_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const DEFAULT_TICK_INTERVAL_MS = 30_000;
const TICK_TIMEOUT_CLOSE_CODE = 4000;

const NOOP_HANDLERS: Handlers = { onState: () => {}, onEvent: () => {} };

export class WsClient {
  private ws: WebSocket | null = null;
  private requestId = 1;
  private handlers: Handlers = NOOP_HANDLERS;
  private readonly deviceAuth: DeviceAuthBridge;
  private identity: DeviceIdentity | null = null;
  private authenticated = false;
  private pendingResponses = new Map<string, Pending>();
  private lastSettings: AppSettings | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private reconnectPaused = false;
  private intentionalDisconnect = false;
  private challengeTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
  private handshakeFailure: ConnectFailure | null = null;
  private streamBuffer = "";
  private activeRunId: string | null = null;
  private sessionKey = "main";

  constructor(options: { handlers?: Handlers; deviceAuth?: DeviceAuthBridge } = {}) {
    this.handlers = options.handlers ?? NOOP_HANDLERS;
    this.deviceAuth = options.deviceAuth ?? tauriDeviceAuth;
  }

  setHandlers(handlers: Handlers): void {
    this.handlers = handlers;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }

  get active(): boolean {
    return (
      this.ws?.readyState === WebSocket.CONNECTING ||
      this.ws?.readyState === WebSocket.OPEN
    );
  }

  /** Fingerprint the gateway lists under `openclaw devices list`, once known. */
  get deviceId(): string | null {
    return this.identity?.deviceId ?? null;
  }

  /** Session key the gateway reported for the current conversation. */
  get currentSessionKey(): string {
    return this.sessionKey;
  }

  get gatewayUrl(): string {
    return this.lastSettings?.gatewayUrl ?? "";
  }

  get lastFailure(): ConnectFailure | null {
    return this.handshakeFailure;
  }

  connect(settings: AppSettings): void {
    this.reconnectPaused = false;
    this.open(settings);
  }

  connectAndVerify(settings: AppSettings, timeoutMs = 8000): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.disconnect();
          this.handlers.onState("error", "Connection timed out");
          reject(new Error("Connection timed out"));
        }
      }, timeoutMs);

      this.reconnectPaused = false;
      this.open(settings, {
        onSuccess: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve("Connected");
        },
        onFailure: (reason) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error(reason));
        },
      });
    });
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    this.disconnectSocket();
  }

  private open(settings: AppSettings, attempt?: Attempt): void {
    this.intentionalDisconnect = false;
    this.clearReconnectTimer();
    this.disconnectSocket();
    this.lastSettings = settings;
    this.handshakeFailure = null;
    this.handlers.onState("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(settings.gatewayUrl);
    } catch (error) {
      const reason = `Invalid URL: ${String(error)}`;
      this.handlers.onState("error", reason);
      attempt?.onFailure(reason);
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    this.challengeTimer = setTimeout(() => {
      if (this.ws === socket && !this.authenticated) {
        const reason = "Gateway did not send a connect challenge";
        this.handlers.onState("error", reason);
        attempt?.onFailure(reason);
        socket.close();
      }
    }, CHALLENGE_TIMEOUT_MS);

    socket.onerror = () => {
      this.handlers.onState("error", "WebSocket error");
      attempt?.onFailure(`Cannot connect to ${settings.gatewayUrl}`);
    };

    socket.onclose = () => {
      const failure = this.handshakeFailure;
      this.authenticated = false;
      this.stopTimers();
      this.rejectAllPending("Connection closed");
      if (!failure) {
        this.handlers.onState("idle", "Disconnected");
      }
      attempt?.onFailure(
        failure ? describeConnectFailure(failure) : "Connection closed",
      );
      this.scheduleReconnect();
    };

    socket.onmessage = (event) => {
      this.handleMessage(String(event.data), settings, socket, attempt);
    };
  }

  private disconnectSocket(): void {
    this.authenticated = false;
    this.stopTimers();
    this.rejectAllPending("Disconnected");
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close();
      }
    }
  }

  private stopTimers(): void {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.intentionalDisconnect || this.reconnectPaused || !this.lastSettings) {
      return;
    }
    this.clearReconnectTimer();
    const delay = delayMs ?? this.reconnectDelay;
    this.reconnectTimer = setTimeout(() => {
      if (this.lastSettings && !this.intentionalDisconnect && !this.reconnectPaused) {
        this.open(this.lastSettings);
      }
    }, delay);
    // Exponential backoff: 1s, 2s, 4s ... capped at 30s like the reference client.
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** The gateway ticks every policy.tickIntervalMs; silence twice that long means a dead socket. */
  private resetTickWatchdog(): void {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
    }
    const socket = this.ws;
    this.tickTimer = setTimeout(() => {
      if (this.ws === socket && socket) {
        socket.close(TICK_TIMEOUT_CLOSE_CODE, "tick timeout");
      }
    }, this.tickIntervalMs * 2);
  }

  sendChatMessage(text: string, settings: AppSettings): void {
    if (!this.connected || !this.ws) {
      throw new Error("Not connected");
    }

    this.streamBuffer = "";
    this.activeRunId = null;
    this.sessionKey = settings.sessionKey || "main";

    void this.request<{ runId?: string }>("chat.send", {
      message: text,
      sessionKey: this.sessionKey,
      idempotencyKey: crypto.randomUUID(),
      ...(settings.agentId ? { agentId: settings.agentId } : {}),
    })
      .then((result) => {
        if (isJsonMap(result) && typeof result.runId === "string") {
          this.activeRunId = result.runId;
        }
      })
      .catch((error: unknown) => {
        this.handlers.onEvent({
          kind: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /** Send an RPC request to the gateway and return the response payload. */
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.connected || !this.ws) {
      return Promise.reject(new Error("Not connected"));
    }

    const id = String(this.requestId++);
    const frame: JsonMap = { type: "req", id, method };
    if (params) {
      frame.params = params;
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingResponses.set(id, {
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.sendFrame(frame);
    });
  }

  private sendFrame(frame: JsonMap): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private async sendHandshake(
    settings: AppSettings,
    challengePayload: unknown,
    socket: WebSocket,
    attempt?: Attempt,
  ): Promise<void> {
    const challenge = parseConnectChallenge(challengePayload);
    if (!challenge) {
      const reason = "Gateway sent an invalid connect challenge";
      this.handlers.onState("error", reason);
      attempt?.onFailure(reason);
      socket.close();
      return;
    }

    this.identity = this.identity ?? (await this.deviceAuth.identity());
    const stored = this.identity
      ? await this.deviceAuth.loadToken(settings.gatewayUrl)
      : null;
    const plan = selectConnectAuth({
      token: settings.token,
      password: settings.password,
      storedDeviceToken: stored,
    });

    let signature: string | null = null;
    if (this.identity) {
      try {
        signature = await this.deviceAuth.sign(
          buildDeviceAuthPayload({
            deviceId: this.identity.deviceId,
            role: OPERATOR_ROLE,
            scopes: plan.scopes,
            signedAtMs: challenge.ts,
            token: plan.signatureToken,
            nonce: challenge.nonce,
          }),
        );
      } catch (error) {
        const reason = `Could not sign the connect challenge: ${String(error)}`;
        this.handlers.onState("error", reason);
        attempt?.onFailure(reason);
        socket.close();
        return;
      }
    }

    // The socket may have been replaced while we were waiting on the Keychain.
    if (this.ws !== socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const id = String(this.requestId++);
    this.pendingResponses.set(id, {
      resolve: (payload) => {
        this.acceptHello(payload, settings, stored, attempt);
      },
      reject: (error) => {
        this.handleConnectFailure(error, settings, attempt);
      },
    });
    this.sendFrame({
      type: "req",
      id,
      method: "connect",
      params: buildConnectParams({
        identity: this.identity,
        auth: plan.auth,
        scopes: plan.scopes,
        challenge,
        signature,
      }),
    });
  }

  private acceptHello(
    payload: unknown,
    settings: AppSettings,
    stored: { token: string; scopes: string[] } | null,
    attempt?: Attempt,
  ): void {
    const hello = isJsonMap(payload) ? payload : {};
    const auth = isJsonMap(hello.auth) ? hello.auth : {};
    const policy = isJsonMap(hello.policy) ? hello.policy : {};

    this.authenticated = true;
    this.handshakeFailure = null;
    this.reconnectDelay = RECONNECT_INITIAL_MS;
    this.reconnectPaused = false;
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }

    const tickIntervalMs = policy.tickIntervalMs;
    this.tickIntervalMs =
      typeof tickIntervalMs === "number" && tickIntervalMs > 0
        ? tickIntervalMs
        : DEFAULT_TICK_INTERVAL_MS;
    this.resetTickWatchdog();

    const deviceToken =
      typeof auth.deviceToken === "string" ? auth.deviceToken.trim() : "";
    if (deviceToken && this.identity) {
      const liveScopes = Array.isArray(auth.scopes)
        ? auth.scopes.filter((scope): scope is string => typeof scope === "string")
        : [];
      // A re-issued identical token keeps the scopes it was approved with.
      const scopes = stored?.token === deviceToken ? stored.scopes : liveScopes;
      void this.deviceAuth.saveToken(settings.gatewayUrl, {
        token: deviceToken,
        scopes,
      });
    }

    this.handlers.onState("connected");
    attempt?.onSuccess();
  }

  private handleConnectFailure(
    error: GatewayError,
    settings: AppSettings,
    attempt?: Attempt,
  ): void {
    const failure = parseConnectFailure(error.raw);
    this.handshakeFailure = failure;
    this.reconnectPaused = shouldPauseReconnect(failure);
    if (failure.code === "AUTH_DEVICE_TOKEN_MISMATCH") {
      void this.deviceAuth.clearToken(settings.gatewayUrl);
    }
    const reason = describeConnectFailure(failure);
    this.handlers.onState("error", reason);
    attempt?.onFailure(reason);
    // The gateway closes the socket after a rejected connect; onclose schedules the retry.
    if (failure.retryAfterMs && !this.reconnectPaused) {
      this.reconnectDelay = Math.min(failure.retryAfterMs, RECONNECT_MAX_MS);
    }
  }

  private handleMessage(
    raw: string,
    settings: AppSettings,
    socket: WebSocket,
    attempt?: Attempt,
  ): void {
    const frame = parseFrame(raw);
    if (!frame) return;

    if (this.authenticated) {
      this.resetTickWatchdog();
    }

    const frameType = typeof frame.type === "string" ? frame.type : "";

    if (frameType === "res") {
      const id = typeof frame.id === "string" ? frame.id : "";
      const pending = this.pendingResponses.get(id);
      if (!pending) return;
      this.pendingResponses.delete(id);
      if (frame.ok) {
        pending.resolve(frame.payload);
      } else {
        const text = extractText(frame.error) || "Request failed";
        pending.reject(new GatewayError(text, frame.error));
      }
      return;
    }

    if (frameType !== "event") return;

    const eventName = typeof frame.event === "string" ? frame.event : "";
    const payload = isJsonMap(frame.payload) ? frame.payload : {};

    if (eventName === "connect.challenge") {
      void this.sendHandshake(settings, frame.payload, socket, attempt);
      return;
    }

    if (eventName === "chat") {
      this.handleChatEvent(payload);
    }
  }

  private handleChatEvent(payload: JsonMap): void {
    const runId = typeof payload.runId === "string" ? payload.runId : null;
    if (this.activeRunId && runId && runId !== this.activeRunId) {
      return;
    }
    if (typeof payload.sessionKey === "string" && payload.sessionKey) {
      this.sessionKey = payload.sessionKey;
    }

    const { update, buffer } = parseChatEvent(payload, this.streamBuffer);
    this.streamBuffer = buffer;

    if (update.kind === "delta") {
      this.handlers.onEvent({ kind: "assistant_delta", text: update.text });
    } else if (update.kind === "final") {
      this.activeRunId = null;
      this.handlers.onEvent({ kind: "assistant_done" });
      if (update.text) {
        this.handlers.onEvent({ kind: "assistant", text: update.text });
      }
    } else if (update.kind === "error") {
      this.activeRunId = null;
      this.handlers.onEvent({ kind: "error", text: update.text });
    }
  }

  private rejectAllPending(reason: string): void {
    for (const pending of this.pendingResponses.values()) {
      pending.reject(new GatewayError(reason));
    }
    this.pendingResponses.clear();
  }
}
