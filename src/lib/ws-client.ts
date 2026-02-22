import { extractText, extractTextWithMedia, isJsonMap, parseFrame, type JsonMap } from "./extract-text";
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

export class WsClient {
  private ws: WebSocket | null = null;
  private requestId = 1;
  private handlers: Handlers;
  private authenticated = false;
  private pendingResponses = new Map<
    string,
    { resolve: (payload: unknown) => void; reject: (err: Error) => void }
  >();
  private lastSettings: AppSettings | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private intentionalDisconnect = false;

  constructor(handlers: Handlers) {
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

  connect(settings: AppSettings): void {
    this.intentionalDisconnect = false;
    this.clearReconnectTimer();
    this.disconnectSocket();
    this.authenticated = false;
    this.lastSettings = settings;
    this.handlers.onState("connecting");

    try {
      this.ws = new WebSocket(settings.gatewayUrl);
    } catch (error) {
      this.handlers.onState("error", String(error));
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      // Wait for connect.challenge before marking as connected.
    };

    this.ws.onerror = () => {
      this.handlers.onState("error", "WebSocket error");
    };

    this.ws.onclose = () => {
      this.authenticated = false;
      this.rejectAllPending("Connection closed");
      this.handlers.onState("idle", "Disconnected");
      this.scheduleReconnect();
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(String(event.data), settings);
    };
  }

  connectAndVerify(settings: AppSettings, timeoutMs = 8000): Promise<string> {
    return new Promise((resolve, reject) => {
      this.intentionalDisconnect = false;
      this.clearReconnectTimer();
      this.disconnectSocket();
      this.authenticated = false;
      this.lastSettings = settings;
      this.handlers.onState("connecting");

      try {
        this.ws = new WebSocket(settings.gatewayUrl);
      } catch (error) {
        this.handlers.onState("error", String(error));
        reject(new Error(`Invalid URL: ${String(error)}`));
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.disconnect();
          this.handlers.onState("error", "Connection timed out");
          reject(new Error("Connection timed out"));
        }
      }, timeoutMs);

      const onAuthenticated = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve("Connected");
        }
      };

      const onFailed = (reason: string) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.handlers.onState("error", reason);
          reject(new Error(reason));
        }
      };

      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
        // Wait for connect.challenge
      };

      this.ws.onerror = () => {
        onFailed(`Cannot connect to ${settings.gatewayUrl}`);
      };

      this.ws.onclose = () => {
        this.authenticated = false;
        this.rejectAllPending("Connection closed");
        onFailed("Connection closed");
        this.scheduleReconnect();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(String(event.data), settings, onAuthenticated, onFailed);
      };
    });
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    this.disconnectSocket();
  }

  private disconnectSocket(): void {
    this.authenticated = false;
    this.rejectAllPending("Disconnected");
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect || !this.lastSettings) {
      return;
    }
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      if (this.lastSettings && !this.intentionalDisconnect) {
        this.connect(this.lastSettings);
      }
    }, this.reconnectDelay);
    // Exponential backoff: 1s → 2s → 4s → 8s → 15s max.
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  sendChatMessage(text: string, settings: AppSettings): void {
    if (!this.connected || !this.ws) {
      throw new Error("Not connected");
    }

    const frame = {
      type: "req",
      id: String(this.requestId++),
      method: "chat.send",
      params: {
        message: text,
        sessionKey: settings.sessionKey || "main",
        idempotencyKey: crypto.randomUUID(),
        ...(settings.agentId ? { agentId: settings.agentId } : {}),
      },
    };

    this.ws.send(JSON.stringify(frame));
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
      }, 30_000);

      this.pendingResponses.set(id, {
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
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

  private sendHandshake(
    settings: AppSettings,
    onSuccess?: () => void,
    onFailure?: (reason: string) => void,
  ): void {
    const id = String(this.requestId++);
    const frame: JsonMap = {
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openclaw-control-ui",
          version: "0.1.0",
          platform: "darwin",
          mode: "backend",
        },
        role: "operator",
        scopes: ["operator.admin"],
        ...(settings.token || settings.password
          ? {
              auth: {
                ...(settings.token ? { token: settings.token } : {}),
                ...(settings.password ? { password: settings.password } : {}),
              },
            }
          : {}),
      },
    };

    this.sendFrame(frame);

    this.pendingResponses.set(id, {
      resolve: () => {
        this.authenticated = true;
        this.handlers.onState("connected");
        onSuccess?.();
      },
      reject: (err) => {
        this.handlers.onState("error", err.message);
        onFailure?.(err.message);
      },
    });
  }

  private handleMessage(
    raw: string,
    settings: AppSettings,
    onAuthenticated?: () => void,
    onFailed?: (reason: string) => void,
  ): void {
    const frame = parseFrame(raw);
    if (!frame) return;

    const frameType = typeof frame.type === "string" ? frame.type : "";

    // Handle response frames
    if (frameType === "res") {
      const id = typeof frame.id === "string" ? frame.id : "";
      const pending = this.pendingResponses.get(id);
      if (pending) {
        this.pendingResponses.delete(id);
        if (frame.ok) {
          pending.resolve(frame.payload);
        } else {
          const errText =
            extractText(frame.error) || "Request failed";
          pending.reject(new Error(errText));
        }
        return;
      }

      // Response for chat.send or other requests — forward to UI
      if (!frame.ok && frame.error) {
        const text =
          extractText(frame.error) || "Gateway returned an error.";
        this.handlers.onEvent({ kind: "error", text });
        return;
      }

      const text = extractText(frame.payload);
      if (text) {
        this.handlers.onEvent({ kind: "assistant", text });
      }
      return;
    }

    // Handle event frames
    if (frameType === "event") {
      const eventName =
        typeof frame.event === "string" ? frame.event : "";
      const payload = isJsonMap(frame.payload) ? frame.payload : {};

      // Gateway handshake challenge
      if (eventName === "connect.challenge") {
        this.sendHandshake(settings, onAuthenticated, onFailed);
        return;
      }

      // Chat events: {event: "chat", payload: {state: "delta"|"final"|"aborted"|"error", message, ...}}
      if (eventName === "chat") {
        const state = typeof payload.state === "string" ? payload.state : "";

        if (state === "delta") {
          const messageText = extractText(payload.message);
          if (messageText) {
            this.handlers.onEvent({ kind: "assistant_delta", text: messageText });
          }
          return;
        }

        if (state === "final") {
          const messageText = extractTextWithMedia(payload.message);
          this.handlers.onEvent({ kind: "assistant_done" });
          if (messageText) {
            this.handlers.onEvent({ kind: "assistant", text: messageText });
          }
          return;
        }

        const messageText = extractText(payload.message);

        if (state === "error" || state === "aborted") {
          const errText = typeof payload.errorMessage === "string"
            ? payload.errorMessage
            : messageText || "Agent error.";
          this.handlers.onEvent({ kind: "error", text: errText });
          return;
        }

        return;
      }

      // Other events — ignore
      return;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const pending of this.pendingResponses.values()) {
      pending.reject(new Error(reason));
    }
    this.pendingResponses.clear();
  }
}
