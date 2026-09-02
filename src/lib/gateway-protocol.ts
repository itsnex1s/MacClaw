// OpenClaw Gateway protocol v4: connect handshake, device auth payload and chat events.
// Keep this module free of transport and UI concerns so it stays unit-testable.
import { version as APP_VERSION } from "../../package.json";
import {
  extractText,
  extractTextWithMedia,
  isJsonMap,
  type JsonMap,
} from "./extract-text";

export const PROTOCOL_VERSION = 4;

/** The gateway only admits ids from its closed registry; webchat-ui is the generic browser UI. */
export const CLIENT_INFO = {
  id: "webchat-ui",
  displayName: "MacClaw",
  version: APP_VERSION,
  platform: "darwin",
  mode: "ui",
} as const;

export const OPERATOR_ROLE = "operator";
/** chat.send needs operator.write; chat.history and status reads need operator.read. */
export const OPERATOR_SCOPES = ["operator.read", "operator.write"];

export type DeviceIdentity = { deviceId: string; publicKey: string };
export type DeviceTokenRecord = { token: string; scopes: string[] };
export type ConnectChallenge = { nonce: string; ts: number };
export type ConnectAuth = { token?: string; password?: string; deviceToken?: string };

/** The gateway lowercases ASCII letters of platform metadata before comparing signatures. */
function normalizeMetadata(value?: string | null): string {
  return (value ?? "").trim().replace(/[A-Z]/g, (char) => char.toLowerCase());
}

/** Mirrors buildDeviceAuthPayloadV3 in @openclaw/gateway-client; compared byte for byte. */
export function buildDeviceAuthPayload(params: {
  deviceId: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
  deviceFamily?: string | null;
}): string {
  return [
    "v3",
    params.deviceId,
    CLIENT_INFO.id,
    CLIENT_INFO.mode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    normalizeMetadata(CLIENT_INFO.platform),
    normalizeMetadata(params.deviceFamily),
  ].join("|");
}

export type ConnectAuthPlan = {
  auth: ConnectAuth;
  /** Token that goes into the signed payload: the shared token, else the device token. */
  signatureToken: string | null;
  scopes: string[];
  usingStoredDeviceToken: boolean;
};

/** Same priority as selectGatewayConnectAuth in the reference client. */
export function selectConnectAuth(params: {
  token: string;
  password: string;
  storedDeviceToken: DeviceTokenRecord | null;
}): ConnectAuthPlan {
  const token = params.token.trim() || undefined;
  const password = params.password.trim() || undefined;
  const stored = params.storedDeviceToken?.token.trim() || undefined;
  const deviceToken = !token && !password && stored ? stored : undefined;
  const usingStoredDeviceToken = Boolean(deviceToken);
  const storedScopes = params.storedDeviceToken?.scopes ?? [];
  return {
    auth: { token: token ?? deviceToken, password, deviceToken },
    signatureToken: token ?? deviceToken ?? null,
    scopes:
      usingStoredDeviceToken && storedScopes.length > 0
        ? [...storedScopes]
        : [...OPERATOR_SCOPES],
    usingStoredDeviceToken,
  };
}

export function buildConnectParams(params: {
  identity: DeviceIdentity | null;
  auth: ConnectAuth;
  scopes: string[];
  challenge: ConnectChallenge | null;
  signature: string | null;
}): JsonMap {
  const connect: JsonMap = {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: { ...CLIENT_INFO },
    role: OPERATOR_ROLE,
    scopes: params.scopes,
    caps: [],
  };

  const auth = Object.fromEntries(
    Object.entries(params.auth).filter(([, value]) => Boolean(value)),
  );
  if (Object.keys(auth).length > 0) {
    connect.auth = auth;
  }

  if (params.identity && params.challenge && params.signature) {
    connect.device = {
      id: params.identity.deviceId,
      publicKey: params.identity.publicKey,
      signature: params.signature,
      signedAt: params.challenge.ts,
      nonce: params.challenge.nonce,
    };
  }

  return connect;
}

export function parseConnectChallenge(payload: unknown): ConnectChallenge | null {
  if (!isJsonMap(payload)) return null;
  const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
  const ts = payload.ts;
  if (!nonce || typeof ts !== "number" || !Number.isInteger(ts) || ts < 0) {
    return null;
  }
  return { nonce, ts };
}

export type ConnectFailure = {
  code: string;
  message: string;
  requestId?: string;
  recommendedNextStep?: string;
  retryable?: boolean;
  pauseReconnect?: boolean;
  retryAfterMs?: number;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseConnectFailure(error: unknown): ConnectFailure {
  const shape = isJsonMap(error) ? error : {};
  const details = isJsonMap(shape.details) ? shape.details : {};
  return {
    code: asString(details.code) ?? asString(shape.code) ?? "UNKNOWN",
    message: asString(shape.message) ?? "Connection rejected by the gateway",
    requestId: asString(details.requestId),
    recommendedNextStep: asString(details.recommendedNextStep),
    retryable: asBoolean(details.retryable) ?? asBoolean(shape.retryable),
    pauseReconnect: asBoolean(details.pauseReconnect),
    retryAfterMs:
      typeof shape.retryAfterMs === "number" ? shape.retryAfterMs : undefined,
  };
}

/** Failures where retrying without operator action only spams the gateway. */
const NON_RECOVERABLE_CODES = new Set([
  "AUTH_REQUIRED",
  "AUTH_TOKEN_MISSING",
  "AUTH_TOKEN_MISMATCH",
  "AUTH_TOKEN_NOT_CONFIGURED",
  "AUTH_PASSWORD_MISSING",
  "AUTH_PASSWORD_MISMATCH",
  "AUTH_PASSWORD_NOT_CONFIGURED",
  "AUTH_BOOTSTRAP_TOKEN_INVALID",
  "AUTH_DEVICE_TOKEN_MISMATCH",
  "AUTH_SCOPE_MISMATCH",
  "AUTH_RATE_LIMITED",
  "AUTH_IDENTITY_HEADER_REQUIRED",
  "CONTROL_UI_BUILD_MISMATCH",
  "CONTROL_UI_ORIGIN_NOT_ALLOWED",
  "CONTROL_UI_DEVICE_IDENTITY_REQUIRED",
  "DEVICE_IDENTITY_REQUIRED",
  "PROTOCOL_MISMATCH",
  "CLIENT_VERSION_MISMATCH",
]);

export function shouldPauseReconnect(failure: ConnectFailure): boolean {
  if (failure.code === "PAIRING_REQUIRED") {
    return !(
      failure.pauseReconnect === false ||
      failure.recommendedNextStep === "wait_then_retry"
    );
  }
  return NON_RECOVERABLE_CODES.has(failure.code);
}

export function describeConnectFailure(failure: ConnectFailure): string {
  switch (failure.code) {
    case "PAIRING_REQUIRED": {
      const approve = failure.requestId
        ? `openclaw devices approve ${failure.requestId}`
        : "openclaw devices list";
      return `Pairing required. On the gateway host run:\n\n\`${approve}\`\n\nMacClaw keeps retrying until the request is approved.`;
    }
    case "AUTH_REQUIRED":
    case "AUTH_TOKEN_MISSING":
      return "The gateway requires a token. Open /connect and enter it.";
    case "AUTH_TOKEN_MISMATCH":
      return "Gateway token mismatch. Open /connect and paste the current gateway token.";
    case "AUTH_PASSWORD_MISSING":
    case "AUTH_PASSWORD_MISMATCH":
      return "Gateway password missing or wrong. Open /connect and enter it.";
    case "AUTH_DEVICE_TOKEN_MISMATCH":
      return "The stored device token was rejected. Reconnect with the gateway token to pair again.";
    case "AUTH_SCOPE_MISMATCH":
      return "The device token does not cover the requested scopes. Approve the new pairing request on the gateway host.";
    case "PROTOCOL_MISMATCH":
      return `The gateway speaks a different protocol version than MacClaw (v${PROTOCOL_VERSION}). Update MacClaw or the gateway.`;
    case "CONTROL_UI_ORIGIN_NOT_ALLOWED":
      return 'The gateway rejected MacClaw\'s origin. For a remote gateway add "tauri://localhost" to gateway.controlUi.allowedOrigins.';
    case "DEVICE_IDENTITY_REQUIRED":
    case "CONTROL_UI_DEVICE_IDENTITY_REQUIRED":
      return "The gateway requires a device identity, but MacClaw could not load its device key from the Keychain.";
    default:
      return failure.message;
  }
}

export type ChatUpdate =
  | { kind: "delta"; text: string }
  | { kind: "final"; text: string }
  | { kind: "error"; text: string }
  | { kind: "ignore" };

/**
 * Turn a v4 `chat` event into a UI update. `message` is the cumulative
 * assistant snapshot when present; otherwise deltas are accumulated from
 * `deltaText`, where `replace` restarts the buffer.
 */
export function parseChatEvent(
  payload: JsonMap,
  buffer: string,
): { update: ChatUpdate; buffer: string } {
  const state = typeof payload.state === "string" ? payload.state : "";

  if (state === "delta") {
    const snapshot = extractText(payload.message);
    let next = buffer;
    if (snapshot) {
      next = snapshot;
    } else if (typeof payload.deltaText === "string") {
      next = payload.replace === true ? payload.deltaText : buffer + payload.deltaText;
    }
    return {
      update: next ? { kind: "delta", text: next } : { kind: "ignore" },
      buffer: next,
    };
  }

  if (state === "final") {
    const text = extractTextWithMedia(payload.message) || buffer;
    return { update: { kind: "final", text }, buffer: "" };
  }

  if (state === "error" || state === "aborted") {
    const detail = isJsonMap(payload.errorDetail) ? payload.errorDetail : {};
    const preview = asString(detail.providerErrorMessagePreview);
    const base =
      asString(payload.errorMessage) ??
      extractText(payload.message) ??
      (state === "aborted" ? "Run aborted." : "Agent error.");
    const text = preview && !base.includes(preview) ? `${base}\n${preview}` : base;
    return { update: { kind: "error", text: text || "Agent error." }, buffer: "" };
  }

  return { update: { kind: "ignore" }, buffer };
}
