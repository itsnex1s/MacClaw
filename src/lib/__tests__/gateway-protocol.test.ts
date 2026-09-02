import { describe, expect, it } from "vitest";
import {
  buildConnectParams,
  buildDeviceAuthPayload,
  describeConnectFailure,
  OPERATOR_SCOPES,
  parseChatEvent,
  parseConnectChallenge,
  parseConnectFailure,
  selectConnectAuth,
  shouldPauseReconnect,
} from "../gateway-protocol";

describe("buildDeviceAuthPayload", () => {
  it("matches the gateway's v3 payload layout byte for byte", () => {
    expect(
      buildDeviceAuthPayload({
        deviceId: "abc123",
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        signedAtMs: 1737264000000,
        token: "tok",
        nonce: "nonce-1",
      }),
    ).toBe(
      "v3|abc123|webchat-ui|ui|operator|operator.read,operator.write|1737264000000|tok|nonce-1|darwin|",
    );
  });

  it("writes an empty token field when there is no token", () => {
    const payload = buildDeviceAuthPayload({
      deviceId: "d",
      role: "operator",
      scopes: [],
      signedAtMs: 1,
      token: null,
      nonce: "n",
    });
    expect(payload).toBe("v3|d|webchat-ui|ui|operator||1||n|darwin|");
  });
});

describe("selectConnectAuth", () => {
  it("prefers the shared token and default scopes", () => {
    const plan = selectConnectAuth({
      token: "shared",
      password: "",
      storedDeviceToken: { token: "dev", scopes: ["operator.read"] },
    });
    expect(plan.auth).toEqual({
      token: "shared",
      password: undefined,
      deviceToken: undefined,
    });
    expect(plan.signatureToken).toBe("shared");
    expect(plan.scopes).toEqual(OPERATOR_SCOPES);
    expect(plan.usingStoredDeviceToken).toBe(false);
  });

  it("falls back to the stored device token and its approved scopes", () => {
    const plan = selectConnectAuth({
      token: "",
      password: "",
      storedDeviceToken: { token: "dev", scopes: ["operator.read"] },
    });
    expect(plan.auth).toEqual({
      token: "dev",
      password: undefined,
      deviceToken: "dev",
    });
    expect(plan.signatureToken).toBe("dev");
    expect(plan.scopes).toEqual(["operator.read"]);
    expect(plan.usingStoredDeviceToken).toBe(true);
  });

  it("sends only the password when password auth is configured", () => {
    const plan = selectConnectAuth({
      token: "",
      password: "pw",
      storedDeviceToken: { token: "dev", scopes: [] },
    });
    expect(plan.auth).toEqual({
      token: undefined,
      password: "pw",
      deviceToken: undefined,
    });
    expect(plan.signatureToken).toBeNull();
  });
});

describe("buildConnectParams", () => {
  const identity = { deviceId: "dev-id", publicKey: "pub" };
  const challenge = { nonce: "n1", ts: 42 };

  it("advertises protocol v4 with the signed device identity", () => {
    const params = buildConnectParams({
      identity,
      auth: { token: "tok" },
      scopes: ["operator.read"],
      challenge,
      signature: "sig",
    });
    expect(params.minProtocol).toBe(4);
    expect(params.maxProtocol).toBe(4);
    expect(params.client).toMatchObject({
      id: "webchat-ui",
      mode: "ui",
      displayName: "MacClaw",
    });
    expect(params.role).toBe("operator");
    expect(params.auth).toEqual({ token: "tok" });
    expect(params.device).toEqual({
      id: "dev-id",
      publicKey: "pub",
      signature: "sig",
      signedAt: 42,
      nonce: "n1",
    });
  });

  it("omits empty auth and device blocks so the closed schema accepts the frame", () => {
    const params = buildConnectParams({
      identity: null,
      auth: {},
      scopes: [],
      challenge,
      signature: null,
    });
    expect(params).not.toHaveProperty("auth");
    expect(params).not.toHaveProperty("device");
  });
});

describe("parseConnectChallenge", () => {
  it("requires a nonce and a non-negative integer timestamp", () => {
    expect(parseConnectChallenge({ nonce: "n", ts: 5 })).toEqual({ nonce: "n", ts: 5 });
    expect(parseConnectChallenge({ nonce: "n" })).toBeNull();
    expect(parseConnectChallenge({ nonce: "n", ts: -1 })).toBeNull();
    expect(parseConnectChallenge({ nonce: "", ts: 1 })).toBeNull();
  });
});

describe("connect failures", () => {
  it("explains a pairing request and keeps retrying", () => {
    const failure = parseConnectFailure({
      code: "INVALID_REQUEST",
      message: "pairing required",
      details: {
        code: "PAIRING_REQUIRED",
        requestId: "req-7",
        recommendedNextStep: "wait_then_retry",
        retryable: true,
        pauseReconnect: false,
      },
    });
    expect(failure.code).toBe("PAIRING_REQUIRED");
    expect(failure.requestId).toBe("req-7");
    expect(shouldPauseReconnect(failure)).toBe(false);
    expect(describeConnectFailure(failure)).toContain("openclaw devices approve req-7");
  });

  it("stops retrying on a token mismatch", () => {
    const failure = parseConnectFailure({
      code: "INVALID_REQUEST",
      message: "unauthorized: gateway token mismatch",
      details: { code: "AUTH_TOKEN_MISMATCH", canRetryWithDeviceToken: true },
    });
    expect(shouldPauseReconnect(failure)).toBe(true);
    expect(describeConnectFailure(failure)).toContain("/connect");
  });

  it("falls back to the gateway message for unknown codes", () => {
    const failure = parseConnectFailure({
      code: "UNAVAILABLE",
      message: "starting up",
    });
    expect(failure.code).toBe("UNAVAILABLE");
    expect(shouldPauseReconnect(failure)).toBe(false);
    expect(describeConnectFailure(failure)).toBe("starting up");
  });
});

describe("parseChatEvent", () => {
  it("uses the cumulative message snapshot for deltas", () => {
    const { update, buffer } = parseChatEvent(
      { state: "delta", deltaText: "lo", message: { text: "Hello" } },
      "Hel",
    );
    expect(update).toEqual({ kind: "delta", text: "Hello" });
    expect(buffer).toBe("Hello");
  });

  it("accumulates deltaText and honours replace", () => {
    const first = parseChatEvent({ state: "delta", deltaText: "Hel" }, "");
    const second = parseChatEvent({ state: "delta", deltaText: "lo" }, first.buffer);
    const replaced = parseChatEvent(
      { state: "delta", deltaText: "Bye", replace: true },
      second.buffer,
    );
    expect(second.update).toEqual({ kind: "delta", text: "Hello" });
    expect(replaced.update).toEqual({ kind: "delta", text: "Bye" });
  });

  it("returns the final text from content blocks and clears the buffer", () => {
    const { update, buffer } = parseChatEvent(
      { state: "final", message: { content: [{ type: "text", text: "Done" }] } },
      "partial",
    );
    expect(update).toEqual({ kind: "final", text: "Done" });
    expect(buffer).toBe("");
  });

  it("reports errors with the provider preview", () => {
    const { update } = parseChatEvent(
      {
        state: "error",
        errorMessage: "Model call failed",
        errorDetail: { providerErrorMessagePreview: "429 rate limited" },
      },
      "",
    );
    expect(update).toEqual({
      kind: "error",
      text: "Model call failed\n429 rate limited",
    });
  });

  it("ignores status events", () => {
    expect(parseChatEvent({ state: "status", phase: "starting" }, "x").update).toEqual({
      kind: "ignore",
    });
  });
});
