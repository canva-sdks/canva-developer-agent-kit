import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  completeCanvaOAuth, createCanvaOAuthChallenge, getCanvaAccessToken,
  getCanvaSessionStatus, hashOpaqueValue, storeCanvaOAuthAttempt,
} from "../src/lib/canva-oauth";
import {
  canvaOAuthSessionsTable, insertCanvaOAuthSessionSchema,
} from "../../../lib/db/src/schema/canva-oauth-sessions";
import { rows } from "./helpers/canva-store";
import { connectedSession, deferred, mockCanva, pendingSession, tokenPayload } from "./helpers/canva-fixtures";

describe("Canva OAuth and encrypted sessions", () => {
  it("creates independent opaque values and an S256 PKCE challenge", () => {
    const attempt = createCanvaOAuthChallenge();
    expect(attempt.challenge).toBe(createHash("sha256").update(attempt.verifier).digest("base64url"));
    expect(attempt.verifier).toMatch(/^[\w-]{43,128}$/);
    expect(new Set([attempt.sessionId, attempt.state, attempt.verifier]).size).toBe(3);
    expect(createCanvaOAuthChallenge()).not.toEqual(attempt);
  });

  it("stores only hashed identifiers and randomized authenticated ciphertext", async () => {
    const attempt = await pendingSession();
    expect(attempt.row.sessionHash).toBe(hashOpaqueValue(attempt.sessionId));
    expect(attempt.row.stateHash).toBe(hashOpaqueValue(attempt.state));
    expect(attempt.row.stateExpiresAt?.getTime()).toBe(Date.now() + 600_000);
    expect(attempt.row.encryptedCodeVerifier).not.toContain(attempt.verifier);
    expect(attempt.row.encryptedCodeVerifier?.split(".")).toHaveLength(3);
    await storeCanvaOAuthAttempt(attempt.sessionId, attempt.state, attempt.verifier);
    expect(rows.size).toBe(1);
    expect(rows.get(attempt.row.sessionHash)?.encryptedCodeVerifier).not.toBe(attempt.row.encryptedCodeVerifier);
  });

  it.each(["unknown session", "wrong state", "expired", "expiry boundary", "missing expiry", "missing verifier", "consumed state"])(
    "rejects %s before contacting Canva", async condition => {
      const attempt = await pendingSession();
      if (condition === "expired") attempt.row.stateExpiresAt = new Date(Date.now() - 1);
      if (condition === "expiry boundary") attempt.row.stateExpiresAt = new Date(Date.now());
      if (condition === "missing expiry") attempt.row.stateExpiresAt = null;
      if (condition === "missing verifier") attempt.row.encryptedCodeVerifier = null;
      if (condition === "consumed state") attempt.row.stateHash = null;
      await expect(completeCanvaOAuth(
        condition === "unknown session" ? "unknown" : attempt.sessionId,
        condition === "wrong state" ? "wrong" : attempt.state, "synthetic-code",
      )).rejects.toMatchObject({ status: 400, code: "canva_oauth_state_invalid" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("exchanges the original PKCE verifier and stores encrypted tokens, then rejects replay", async () => {
    const attempt = await pendingSession();
    mockCanva(tokenPayload);
    await completeCanvaOAuth(attempt.sessionId, attempt.state, "synthetic-code");
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.canva.com/rest/v1/oauth/token");
    expect(options).toMatchObject({
      method: "POST", headers: {
        Authorization: `Basic ${Buffer.from("test-client:synthetic-client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    expect(Object.fromEntries(options!.body as URLSearchParams)).toEqual({
      grant_type: "authorization_code", code: "synthetic-code",
      code_verifier: attempt.verifier,
      redirect_uri: "https://studio.example/api/canva/oauth/callback",
    });
    const stored = rows.get(attempt.row.sessionHash)!;
    expect(stored).toMatchObject({
      stateHash: null, stateExpiresAt: null, encryptedCodeVerifier: null,
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    expect(stored.encryptedAccessToken).not.toContain(tokenPayload.access_token);
    expect(stored.encryptedRefreshToken).not.toContain(tokenPayload.refresh_token);
    expect(await getCanvaAccessToken(attempt.sessionId)).toBe(tokenPayload.access_token);
    await expect(completeCanvaOAuth(attempt.sessionId, attempt.state, "replay"))
      .rejects.toMatchObject({ code: "canva_oauth_state_invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("allows only one overlapping callback to claim an OAuth state", async () => {
    const attempt = await pendingSession();
    const response = deferred<Response>();
    const started = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(() => { started.resolve(); return response.promise; });
    const first = completeCanvaOAuth(attempt.sessionId, attempt.state, "code");
    // Both calls read the same unconsumed state before either can claim it.
    const replay = completeCanvaOAuth(attempt.sessionId, attempt.state, "code");
    const settled = Promise.allSettled([first, replay]);
    await started.promise;
    response.resolve(new Response(JSON.stringify(tokenPayload)));
    const results = await settled;
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected", reason: { code: "canva_oauth_state_invalid" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { refresh_token: "refresh", expires_in: 3600 },
    { access_token: "access", expires_in: 3600 },
    { ...tokenPayload, expires_in: 0 },
    { ...tokenPayload, expires_in: "3600" },
  ])("rejects incomplete token responses without persisting tokens: %j", async payload => {
    const attempt = await pendingSession();
    mockCanva(payload);
    await expect(completeCanvaOAuth(attempt.sessionId, attempt.state, "code"))
      .rejects.toMatchObject({ status: 502, code: "invalid_token_response" });
    expect(rows.get(attempt.row.sessionHash)?.encryptedAccessToken).toBeNull();
  });

  it("does not allow retrying a consumed state after the provider rejects the code", async () => {
    const session = await pendingSession();
    mockCanva({ code: "invalid_grant", message: "Code rejected" }, 400);
    await expect(completeCanvaOAuth(session.sessionId, session.state, "code"))
      .rejects.toMatchObject({ code: "invalid_grant" });
    await expect(completeCanvaOAuth(session.sessionId, session.state, "code"))
      .rejects.toMatchObject({ code: "canva_oauth_state_invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rows.get(session.row.sessionHash)?.encryptedAccessToken).toBeNull();
  });

  it("uses the real session schema with a unique hashed key, nullable secrets, and timezone-aware expiry", () => {
    const config = getTableConfig(canvaOAuthSessionsTable);
    expect(config.columns.find(column => column.name === "session_hash")?.primary).toBe(true);
    for (const column of config.columns.filter(column => column.name.endsWith("_at"))) {
      expect(column.getSQLType()).toBe("timestamp with time zone");
    }
    expect(insertCanvaOAuthSessionSchema.safeParse({ sessionHash: "hash" }).success).toBe(true);
    expect(insertCanvaOAuthSessionSchema.safeParse({ stateHash: "state" }).success).toBe(false);
    expect(insertCanvaOAuthSessionSchema.safeParse({
      sessionHash: "hash", stateHash: null, encryptedAccessToken: null, stateExpiresAt: new Date(),
    }).success).toBe(true);
  });

  it("keeps sessions isolated and exposes only connection status, never tokens", async () => {
    const first = await connectedSession();
    const second = await pendingSession();
    expect(await getCanvaSessionStatus(first.sessionId)).toEqual({
      connected: true, expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(await getCanvaSessionStatus(second.sessionId)).toEqual({ connected: false, expiresAt: null });
    await expect(getCanvaAccessToken(second.sessionId)).rejects.toMatchObject({ status: 401 });
    expect(await getCanvaSessionStatus(undefined)).toEqual({ connected: false, expiresAt: null });
    await expect(getCanvaAccessToken(undefined)).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["access token", "verifier", "encryption key"])("detects tampered %s without making a provider request", async target => {
    const attempt = target === "verifier" ? await pendingSession() : await connectedSession();
    if (target === "encryption key") vi.stubEnv("SESSION_SECRET", "different-synthetic-key");
    else {
      const key = target === "verifier" ? "encryptedCodeVerifier" : "encryptedAccessToken";
      const parts = attempt.row[key]!.split(".");
      parts[1] = Buffer.alloc(16).toString("base64url");
      attempt.row[key] = parts.join(".");
    }
    await expect(target === "verifier"
      ? completeCanvaOAuth(attempt.sessionId, attempt.state, "code")
      : getCanvaAccessToken(attempt.sessionId))
      .rejects.toMatchObject({ status: 401, code: "canva_session_invalid" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Canva refresh rotation", () => {
  it("shares one in-flight refresh for simultaneous callers and uses the rotated token next time", async () => {
    const session = await connectedSession();
    session.row.accessTokenExpiresAt = new Date(Date.now() + 60_000);
    const response = deferred<Response>();
    const started = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(() => { started.resolve(); return response.promise; });
    const first = getCanvaAccessToken(session.sessionId);
    await started.promise;
    const second = getCanvaAccessToken(session.sessionId);
    response.resolve(new Response(JSON.stringify({
      access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600,
    })));
    expect(await Promise.all([first, second])).toEqual(["rotated-access", "rotated-access"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(vi.mocked(fetch).mock.calls[0][1]!.body as URLSearchParams))
      .toEqual({ grant_type: "refresh_token", refresh_token: tokenPayload.refresh_token });
    expect(await getCanvaAccessToken(session.sessionId)).toBe("rotated-access");
    expect(fetch).toHaveBeenCalledTimes(1);
    const stored = rows.get(session.row.sessionHash)!;
    expect(stored.encryptedRefreshToken).not.toContain("rotated-refresh");
    stored.accessTokenExpiresAt = new Date(Date.now() - 1);
    mockCanva({ ...tokenPayload, access_token: "second-access" });
    expect(await getCanvaAccessToken(session.sessionId)).toBe("second-access");
    expect(Object.fromEntries(vi.mocked(fetch).mock.calls[1][1]!.body as URLSearchParams))
      .toEqual({ grant_type: "refresh_token", refresh_token: "rotated-refresh" });
  });

  it("preserves the old refresh token if Canva omits rotation", async () => {
    const session = await connectedSession();
    session.row.accessTokenExpiresAt = new Date(Date.now() - 1);
    mockCanva({ access_token: "new-access", expires_in: 3600 });
    expect(await getCanvaAccessToken(session.sessionId)).toBe("new-access");
    rows.get(session.row.sessionHash)!.accessTokenExpiresAt = new Date(Date.now() - 1);
    mockCanva(tokenPayload);
    await getCanvaAccessToken(session.sessionId);
    expect((vi.mocked(fetch).mock.calls[1][1]!.body as URLSearchParams).get("refresh_token"))
      .toBe(tokenPayload.refresh_token);
  });

  it("shares a refresh failure without overwriting tokens, then releases the lock for a retry", async () => {
    const session = await connectedSession();
    session.row.accessTokenExpiresAt = new Date(Date.now() - 1);
    const original = { ...session.row };
    const response = deferred<Response>();
    const started = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(() => { started.resolve(); return response.promise; });
    const first = getCanvaAccessToken(session.sessionId);
    await started.promise;
    const second = getCanvaAccessToken(session.sessionId);
    response.resolve(new Response(JSON.stringify({ error: { code: "temporarily_unavailable", message: "Try later" } }), { status: 503 }));
    const results = await Promise.allSettled([first, second]);
    for (const result of results) expect(result).toMatchObject({
      status: "rejected", reason: { status: 502, code: "temporarily_unavailable", message: "Try later" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rows.get(session.row.sessionHash)).toEqual(original);
    mockCanva(tokenPayload);
    expect(await getCanvaAccessToken(session.sessionId)).toBe(tokenPayload.access_token);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { error: "invalid_grant", error_description: "Refresh token revoked" },
    { code: "invalid_grant", message: "Refresh token expired" },
    { error: { code: "invalid_grant", message: "Refresh token invalid" } },
  ])("disconnects rejected refresh credentials without touching other sessions: %j", async payload => {
    const session = await connectedSession();
    const other = await connectedSession();
    session.row.accessTokenExpiresAt = new Date(Date.now() - 1);
    // Keep a pending reconnect attempt usable.
    await storeCanvaOAuthAttempt(session.sessionId, session.state, session.verifier);
    const pending = { ...rows.get(session.row.sessionHash)! };
    mockCanva(payload, 400);
    await expect(getCanvaAccessToken(session.sessionId)).rejects.toMatchObject({
      status: 401, code: "canva_reconnect_required",
    });
    expect(rows.get(session.row.sessionHash)).toMatchObject({
      encryptedAccessToken: null, encryptedRefreshToken: null, accessTokenExpiresAt: null,
      stateHash: pending.stateHash, encryptedCodeVerifier: pending.encryptedCodeVerifier,
      stateExpiresAt: pending.stateExpiresAt,
    });
    expect(await getCanvaSessionStatus(session.sessionId)).toEqual({ connected: false, expiresAt: null });
    expect(await getCanvaSessionStatus(other.sessionId)).toMatchObject({ connected: true });
    await expect(getCanvaAccessToken(session.sessionId)).rejects.toMatchObject({ code: "canva_auth_required" });
    expect(fetch).toHaveBeenCalledTimes(1);
    mockCanva(tokenPayload);
    await completeCanvaOAuth(session.sessionId, session.state, "new-code");
    expect(await getCanvaSessionStatus(session.sessionId)).toMatchObject({ connected: true });
  });

  it.each([
    [429, { error: "invalid_grant" }],
    [503, { error: "invalid_grant" }],
    [401, { error: "invalid_client" }],
    [400, { error: "temporarily_unavailable" }],
    [400, { message: "Unknown rejection" }],
    [200, { expires_in: 3600 }],
  ])("preserves credentials after non-definitive refresh HTTP %s", async (status, payload) => {
    const session = await connectedSession();
    session.row.accessTokenExpiresAt = new Date(Date.now() - 1);
    const original = { ...session.row };
    mockCanva(payload, status as number);
    await expect(getCanvaAccessToken(session.sessionId)).rejects.toBeInstanceOf(Error);
    expect(rows.get(session.row.sessionHash)).toEqual(original);
    expect(await getCanvaSessionStatus(session.sessionId)).toMatchObject({ connected: true });
    mockCanva(tokenPayload);
    expect(await getCanvaAccessToken(session.sessionId)).toBe(tokenPayload.access_token);
  });

  it.each(["network", "timeout", "non-JSON"])("preserves credentials after a %s refresh failure", async scenario => {
    const session = await connectedSession();
    session.row.accessTokenExpiresAt = new Date(Date.now() - 1);
    const original = { ...session.row };
    if (scenario === "non-JSON") vi.mocked(fetch).mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    else vi.mocked(fetch).mockRejectedValueOnce(
      scenario === "timeout" ? new DOMException("Timed out", "TimeoutError") : new Error("Network failed"),
    );
    await expect(getCanvaAccessToken(session.sessionId)).rejects.toBeInstanceOf(Error);
    expect(rows.get(session.row.sessionHash)).toEqual(original);
    expect(await getCanvaSessionStatus(session.sessionId)).toMatchObject({ connected: true });
    mockCanva(tokenPayload);
    await expect(getCanvaAccessToken(session.sessionId)).resolves.toBe(tokenPayload.access_token);
  });

  it("shares a definitive refresh rejection and leaves subsequent calls disconnected", async () => {
    const session = await connectedSession();
    session.row.accessTokenExpiresAt = new Date(Date.now() - 1);
    const response = deferred<Response>();
    const started = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(() => { started.resolve(); return response.promise; });
    const first = getCanvaAccessToken(session.sessionId);
    await started.promise;
    const second = getCanvaAccessToken(session.sessionId);
    const settled = Promise.allSettled([first, second]);
    response.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }));
    for (const result of await settled) expect(result).toMatchObject({
      status: "rejected", reason: { status: 401, code: "canva_reconnect_required" },
    });
    await expect(getCanvaAccessToken(session.sessionId)).rejects.toMatchObject({ code: "canva_auth_required" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not serialize different users behind the same refresh lock", async () => {
    const first = await connectedSession();
    const second = await connectedSession();
    first.row.accessTokenExpiresAt = second.row.accessTokenExpiresAt = new Date(Date.now() - 1);
    mockCanva({ ...tokenPayload, access_token: "user-one" });
    mockCanva({ ...tokenPayload, access_token: "user-two" });
    expect(await Promise.all([
      getCanvaAccessToken(first.sessionId), getCanvaAccessToken(second.sessionId),
    ])).toEqual(["user-one", "user-two"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
