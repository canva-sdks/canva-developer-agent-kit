import { createHash } from "node:crypto";
import type { Server } from "node:http";
import express, { type Request } from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import router from "../src/routes/canva";
import { CANVA_SESSION_COOKIE, hashOpaqueValue } from "../src/lib/canva-oauth";
import { connectedSession, mockCanva, pendingSession, tokenPayload } from "./helpers/canva-fixtures";
import { rows } from "./helpers/canva-store";
import { requestApp } from "./helpers/http-client";

const origin = "https://studio.example";
const generationInput = { prompt: "A spring campaign", aspectRatio: "landscape" };
const importInput = { assetId: "asset-123", title: "Spring campaign" };
const cookie = (sessionId: string) => `${CANVA_SESSION_COOKIE}=${sessionId}`;
let server: Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use((req, _res, next) => {
    req.log = { warn: vi.fn(), error: vi.fn() } as unknown as Request["log"];
    next();
  });
  app.use("/api", router);
  server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("OAuth HTTP boundary", () => {
  it("redirects with PKCE and scopes, stores the verifier server-side, and sets a secure opaque cookie", async () => {
    const response = await requestApp(server, "/api/canva/oauth/start");
    expect(response.status).toBe(302);
    const target = new URL(response.headers.location!);
    expect(target.origin + target.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(Object.fromEntries(target.searchParams)).toMatchObject({
      client_id: "test-client", response_type: "code",
      redirect_uri: `${origin}/api/canva/oauth/callback`,
      // Canva's authorization URL examples use lowercase s256:
      // https://www.canva.dev/docs/connect/authentication/
      scope: "asset:write design:content:write", code_challenge_method: "s256",
    });
    const setCookie = response.headers["set-cookie"]![0];
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    const sessionId = setCookie.split(";")[0].split("=")[1];
    const stored = rows.get(hashOpaqueValue(sessionId))!;
    expect(stored.stateHash).toBe(hashOpaqueValue(target.searchParams.get("state")!));
    expect(target.searchParams.has("code_verifier")).toBe(false);
    mockCanva(tokenPayload);
    const callback = await requestApp(server,
      `/api/canva/oauth/callback?code=synthetic-code&state=${target.searchParams.get("state")}`,
      { cookie: cookie(sessionId) });
    expect(callback.headers.location).toBe(`${origin}/?canva=connected`);
    const verifier = (vi.mocked(fetch).mock.calls[0][1]!.body as URLSearchParams).get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url"))
      .toBe(target.searchParams.get("code_challenge"));
    expect(callback.text).not.toContain("synthetic-access");
    expect(callback.headers["set-cookie"]).toBeUndefined();
  });

  it.each(["cancelled", "missing state", "wrong state", "expired", "missing cookie", "replayed"])(
    "maps %s callbacks to a safe app redirect", async scenario => {
      const session = scenario === "replayed" ? await connectedSession() : await pendingSession();
      if (scenario === "expired") session.row.stateExpiresAt = new Date(Date.now() - 1);
      let query = `code=code&state=${scenario === "wrong state" ? "bad" : session.state}`;
      if (scenario === "missing state") query = "code=code";
      if (scenario === "cancelled") query = "error=access_denied";
      const response = await requestApp(server, `/api/canva/oauth/callback?${query}`, {
        cookie: scenario === "missing cookie" ? undefined : cookie(session.sessionId),
      });
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(
        `${origin}/?canva=${scenario === "cancelled" ? "cancelled" : "error"}`,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["missing secret", "invalid redirect", "non-HTTPS redirect"])(
    "fails explicitly on %s without contacting Canva", async configuration => {
      if (configuration === "missing secret") vi.stubEnv("CANVA_CLIENT_SECRET", "");
      else vi.stubEnv("CANVA_REDIRECT_URI", configuration === "invalid redirect" ? "bad" : "http://studio.example/callback");
      const response = await requestApp(server, "/api/canva/oauth/start");
      expect(response.status).toBe(503);
      expect(response.json?.code).toBe("canva_not_configured");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not expose token ciphertext or plaintext in connection status", async () => {
    const session = await connectedSession();
    const response = await requestApp(server, "/api/canva/auth/status", { cookie: cookie(session.sessionId) });
    expect(response.json).toEqual({ connected: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(fetch).not.toHaveBeenCalled();
    const anonymous = await requestApp(server, "/api/canva/auth/status");
    expect(anonymous.json).toEqual({ connected: false, expiresAt: null });
  });
});

describe("Generation to editable-design import", () => {
  it("passes a generated asset into an import and returns the edit URL rather than the view URL", async () => {
    const session = await connectedSession();
    const auth = { cookie: cookie(session.sessionId) };
    mockCanva({ job: { id: "generation-123", status: "in_progress" } });
    const created = await requestApp(server, "/api/canva/generations", {
      ...auth, method: "POST", origin, body: generationInput,
    });
    expect(created.status).toBe(202);
    expect(created.json).toEqual({ jobId: "generation-123", status: "in_progress" });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.canva.com/rest/v1/image-generations");
    const options = vi.mocked(fetch).mock.calls[0][1]!;
    expect(options).toMatchObject({ method: "POST", headers: { Authorization: "Bearer synthetic-access" } });
    expect(JSON.parse(options.body as string)).toEqual({
      prompt: generationInput.prompt, aspect_ratio: "landscape",
      idempotency_key: expect.stringMatching(/^[\da-f-]{36}$/),
      asset_upload: { type: "upload", asset_name: "Campaign image - A spring campaign" },
    });

    mockCanva({ job: { status: "success", result: { image: {
      url: "https://images.example/generated.png", asset: { id: importInput.assetId },
    } } } });
    const generated = await requestApp(server, `/api/canva/generations/${created.json!.jobId}`, auth);
    expect(generated.status).toBe(200);
    expect(generated.json).toEqual({
      jobId: "generation-123", status: "success",
      imageUrl: "https://images.example/generated.png", assetId: importInput.assetId, error: null,
    });
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("https://api.canva.com/rest/v1/image-generations/generation-123");
    expect(vi.mocked(fetch).mock.calls[1][1]?.method).toBe("GET");

    mockCanva({ job: { id: "import-456", status: "in_progress" } });
    const imported = await requestApp(server, "/api/canva/imports", {
      ...auth, method: "POST", origin,
      body: { assetId: generated.json!.assetId, title: importInput.title },
    });
    expect(imported.status).toBe(202);
    expect(imported.json).toEqual({ jobId: "import-456", status: "in_progress" });
    expect(vi.mocked(fetch).mock.calls[2][0]).toBe("https://api.canva.com/rest/v1/image-to-design-imports");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[2][1]!.body as string)).toEqual({
      image: { asset_id: importInput.assetId }, title: importInput.title,
    });

    mockCanva({ job: { status: "success", result: { design: { urls: {
      edit_url: "https://www.canva.com/design/edit-me/edit",
      view_url: "https://www.canva.com/design/edit-me/view",
    } } } } });
    const design = await requestApp(server, `/api/canva/imports/${imported.json!.jobId}`, auth);
    expect(design.json).toEqual({
      jobId: "import-456", status: "success",
      designUrl: "https://www.canva.com/design/edit-me/edit", error: null,
    });
    expect(vi.mocked(fetch).mock.calls[3][0]).toBe("https://api.canva.com/rest/v1/image-to-design-imports/import-456");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("accepts Canva's alternate asset_id field", async () => {
    const session = await connectedSession();
    mockCanva({ job: { status: "success", result: { image: { asset: { asset_id: "alternate" } } } } });
    const response = await requestApp(server, "/api/canva/generations/job", { cookie: cookie(session.sessionId) });
    expect(response.json?.assetId).toBe("alternate");
  });

  it("maps the view URL when no editable URL was returned", async () => {
    const session = await connectedSession();
    mockCanva({ job: { status: "success", result: { design: { urls: { view_url: "https://canva.example/view" } } } } });
    const response = await requestApp(server, "/api/canva/imports/job", { cookie: cookie(session.sessionId) });
    expect(response.json?.designUrl).toBe("https://canva.example/view");
  });

  it.each(["generations", "imports"])("maps pending and failed %s jobs without inventing results", async resource => {
    const session = await connectedSession();
    const auth = { cookie: cookie(session.sessionId) };
    for (const status of ["in_progress", "failed"]) {
      mockCanva({ job: { status, ...(status === "failed" ? { error: { message: "AI allowance exhausted" } } : {}) } });
      const response = await requestApp(server, `/api/canva/${resource}/job`, auth);
      expect(response.status).toBe(200);
      expect(response.json).toEqual({
        jobId: "job", status,
        ...(resource === "generations" ? { assetId: null, imageUrl: null } : { designUrl: null }),
        error: status === "failed" ? "AI allowance exhausted" : null,
      });
    }
  });

  it("refreshes an expired connection before image creation", async () => {
    const session = await connectedSession();
    session.row.accessTokenExpiresAt = new Date(Date.now() - 1);
    mockCanva({ ...tokenPayload, access_token: "refreshed-access", refresh_token: "refreshed-refresh" });
    mockCanva({ job: { id: "job", status: "in_progress" } });
    const response = await requestApp(server, "/api/canva/generations", {
      method: "POST", origin, cookie: cookie(session.sessionId), body: generationInput,
    });
    expect(response.status).toBe(202);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.canva.com/rest/v1/oauth/token");
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toMatchObject({ Authorization: "Bearer refreshed-access" });
  });

  it.each(["generations", "imports", "generations/job", "imports/job"])("requires reconnect after refresh rejection on %s without starting a provider job", async resource => {
    const session = await connectedSession();
    session.row.accessTokenExpiresAt = new Date(Date.now() - 1);
    mockCanva({ error: "invalid_grant", error_description: "Refresh token revoked" }, 400);
    const options = {
      method: resource.includes("/") ? "GET" : "POST", origin, cookie: cookie(session.sessionId),
      ...(!resource.includes("/") ? { body: resource === "generations" ? generationInput : importInput } : {}),
    };
    const response = await requestApp(server, `/api/canva/${resource}`, options);
    expect(response.status).toBe(401);
    expect(response.json).toEqual({
      code: "canva_reconnect_required",
      error: "Your Canva connection is no longer valid. Reconnect Canva to continue.",
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
    const status = await requestApp(server, "/api/canva/auth/status", { cookie: cookie(session.sessionId) });
    expect(status.json).toEqual({ connected: false, expiresAt: null });
    expect(status.headers["cache-control"]).toBe("no-store");
    const retry = await requestApp(server, `/api/canva/${resource}`, options);
    expect(retry.status).toBe(401);
    expect(retry.json?.code).toBe("canva_auth_required");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.canva.com/rest/v1/oauth/token");
  });

  it.each([429, 503, "network", "timeout", "non-JSON"])("keeps connection usable after transient refresh failure %s", async failure => {
    const session = await connectedSession();
    session.row.accessTokenExpiresAt = new Date(Date.now() - 1);
    const original = { ...session.row };
    if (typeof failure === "number") mockCanva({ error: "temporarily_unavailable" }, failure);
    else if (failure === "non-JSON") vi.mocked(fetch).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    else vi.mocked(fetch).mockRejectedValueOnce(
      failure === "timeout" ? new DOMException("Timeout", "TimeoutError") : new Error("Network failed"),
    );
    const options = { method: "POST", origin, cookie: cookie(session.sessionId), body: generationInput };
    const failed = await requestApp(server, "/api/canva/generations", options);
    expect(failed.status).toBe(failure === 429 ? 429 : 502);
    expect(failed.json?.code).not.toBe("canva_reconnect_required");
    expect(rows.get(session.row.sessionHash)).toEqual(original);
    const status = await requestApp(server, "/api/canva/auth/status", { cookie: cookie(session.sessionId) });
    expect(status.json?.connected).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    mockCanva(tokenPayload);
    mockCanva({ job: { id: "retried-job", status: "in_progress" } });
    const retried = await requestApp(server, "/api/canva/generations", options);
    expect(retried.status).toBe(202);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("API validation and provider errors", () => {
  it.each([
    ["/api/canva/generations", generationInput],
    ["/api/canva/imports", importInput],
    ["/api/canva/auth/disconnect", {}],
  ])("blocks missing or foreign origins on %s", async (path, body) => {
    for (const suppliedOrigin of [undefined, "https://attacker.example"]) {
      const response = await requestApp(server, path as string, { method: "POST", origin: suppliedOrigin, body });
      expect(response.status).toBe(403);
      expect(response.json?.code).toBe("origin_not_allowed");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["generations", { ...generationInput, prompt: "" }, "invalid_generation_request"],
    ["generations", { ...generationInput, aspectRatio: "invalid" }, "invalid_generation_request"],
    ["generations", { ...generationInput, prompt: "x".repeat(2001) }, "invalid_generation_request"],
    ["imports", { ...importInput, assetId: "" }, "invalid_import_request"],
    ["imports", { ...importInput, title: "x".repeat(256) }, "invalid_import_request"],
  ])("rejects invalid %s input before provider calls: %j", async (resource, body, code) => {
    const response = await requestApp(server, `/api/canva/${resource}`, { method: "POST", origin, body });
    expect(response.status).toBe(400);
    expect(response.json?.code).toBe(code);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["generations", "imports"])("rejects anonymous %s requests without using Canva", async resource => {
    const response = await requestApp(server, `/api/canva/${resource}`, {
      method: "POST", origin, body: resource === "generations" ? generationInput : importInput,
    });
    expect(response.status).toBe(401);
    expect(response.json?.code).toBe("canva_auth_required");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["generations", "POST", {}],
    ["generations", "POST", { job: { status: "in_progress" } }],
    ["imports", "POST", { job: { id: "job", status: "unknown" } }],
    ["generations/job", "GET", { job: { status: "unknown" } }],
    ["imports/job", "GET", { job: {} }],
  ])("rejects malformed provider response for %s", async (resource, method, payload) => {
    const session = await connectedSession();
    mockCanva(payload);
    const response = await requestApp(server, `/api/canva/${resource}`, {
      method, origin, cookie: cookie(session.sessionId),
      ...(method === "POST" ? { body: resource === "generations" ? generationInput : importInput } : {}),
    });
    expect(response.status).toBe(502);
    expect(response.json?.code).toBe("invalid_canva_response");
  });

  it.each([
    [429, { error: { code: "rate_limited", message: "Try later" } }, 429, "rate_limited", "Try later"],
    [403, { code: "forbidden", message: "Missing permission" }, 403, "forbidden", "Missing permission"],
    [503, { message: "Service down" }, 502, null, "Service down"],
  ])("maps Canva HTTP %s to safe API errors", async (status, payload, expectedStatus, code, error) => {
    const session = await connectedSession();
    mockCanva(payload, status as number);
    const response = await requestApp(server, "/api/canva/imports/job", { cookie: cookie(session.sessionId) });
    expect(response.status).toBe(expectedStatus);
    expect(response.json).toEqual({ code, error });
  });

  it("handles non-JSON success and network failures explicitly", async () => {
    const session = await connectedSession();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not-json"));
    const invalid = await requestApp(server, "/api/canva/generations/job", { cookie: cookie(session.sessionId) });
    expect(invalid.status).toBe(502);
    expect(invalid.json?.code).toBe("invalid_canva_response");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("synthetic transport failure"));
    const unavailable = await requestApp(server, "/api/canva/generations/job", { cookie: cookie(session.sessionId) });
    expect(unavailable.status).toBe(502);
    expect(unavailable.json?.code).toBe("canva_unavailable");
    expect(unavailable.text).not.toContain("synthetic transport failure");
  });
});
