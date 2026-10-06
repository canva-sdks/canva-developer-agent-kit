import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateCanvaGenerationBody,
  CreateCanvaGenerationResponse,
  CreateCanvaImageImportBody,
  CreateCanvaImageImportResponse,
  GetCanvaAuthStatusResponse,
  GetCanvaGenerationParams,
  GetCanvaGenerationResponse,
  GetCanvaImageImportParams,
  GetCanvaImageImportResponse,
} from "@workspace/api-zod";
import {
  CanvaAuthError,
  CanvaRemoteError,
  CANVA_SESSION_COOKIE,
  completeCanvaOAuth,
  createCanvaOAuthChallenge,
  deleteCanvaSession,
  getCanvaAccessToken,
  getCanvaOAuthConfig,
  getCanvaSessionStatus,
  storeCanvaOAuthAttempt,
} from "../lib/canva-oauth";

const router: IRouter = Router();
const CANVA_API = "https://api.canva.com/rest/v1";
const APP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};
const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

function getSessionId(req: Request): string | undefined {
  const value = req.cookies?.[CANVA_SESSION_COOKIE];
  return typeof value === "string" && value.length >= 40 ? value : undefined;
}

function appRedirectUrl(redirectUri: string, status: string): string {
  const target = new URL("/", redirectUri);
  target.searchParams.set("canva", status);
  return target.toString();
}

function requireSameOrigin(req: Request, res: Response): boolean {
  let appOrigin: string;
  try {
    appOrigin = new URL(process.env.CANVA_REDIRECT_URI ?? "").origin;
  } catch {
    res.status(503).json({
      error: "Canva OAuth is not configured.",
      code: "canva_not_configured",
    });
    return false;
  }
  if (req.get("origin") !== appOrigin) {
    res.status(403).json({
      error: "This request did not come from the Campaign Image Studio app.",
      code: "origin_not_allowed",
    });
    return false;
  }
  return true;
}

function sendError(req: Request, res: Response, error: unknown): void {
  if (error instanceof CanvaAuthError || error instanceof CanvaRemoteError) {
    if (error instanceof CanvaAuthError && error.code === "canva_reconnect_required") {
      // The rejected credentials have already been cleared server-side.
      // Keep the cookie so an in-progress authorization can still complete.
      res.setHeader("Cache-Control", "no-store");
    }
    if (error.status >= 500) {
      req.log.warn({ code: error.code, status: error.status }, error.message);
    }
    res
      .status(error.status)
      .json({ error: error.message, code: error.code });
    return;
  }

  req.log.error({ err: error }, "Canva request failed");
  res.status(502).json({
    error: "Canva is temporarily unavailable. Please try again.",
    code: "canva_unavailable",
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeStatus(
  value: unknown,
): "in_progress" | "success" | "failed" | null {
  return value === "in_progress" || value === "success" || value === "failed"
    ? value
    : null;
}

async function readCanvaJson(response: globalThis.Response): Promise<{
  body: Record<string, unknown> | null;
  error: CanvaRemoteError | null;
}> {
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const body = asRecord(parsed);
  if (response.ok) return { body, error: null };

  const nested = asRecord(body?.error);
  const message =
    asString(nested?.message) ??
    asString(body?.message) ??
    `Canva returned HTTP ${response.status}.`;
  const code = asString(nested?.code) ?? asString(body?.code);
  const status =
    response.status >= 400 && response.status < 500
      ? response.status
      : 502;
  return { body, error: new CanvaRemoteError(message, status, code) };
}

async function callCanva(
  token: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${CANVA_API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await readCanvaJson(response);
  if (result.error) throw result.error;
  if (!result.body) {
    throw new CanvaRemoteError(
      "Canva returned an empty response.",
      502,
      "invalid_canva_response",
    );
  }
  return result.body;
}

router.get("/canva/oauth/start", async (req, res): Promise<void> => {
  try {
    const { clientId, redirectUri } = getCanvaOAuthConfig();
    const { sessionId, state, verifier, challenge } =
      createCanvaOAuthChallenge();
    await storeCanvaOAuthAttempt(sessionId, state, verifier);
    res.cookie(CANVA_SESSION_COOKIE, sessionId, APP_COOKIE_OPTIONS);

    const authorizationUrl = new URL(
      "https://www.canva.com/api/oauth/authorize",
    );
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set(
      "scope",
      "asset:write design:content:write",
    );
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "s256");
    res.redirect(302, authorizationUrl.toString());
  } catch (error) {
    if (error instanceof CanvaAuthError || error instanceof CanvaRemoteError) {
      res
        .status(error.status)
        .json({ error: error.message, code: error.code });
      return;
    }
    req.log.error({ err: error }, "Could not start Canva OAuth");
    res.status(500).json({
      error: "Could not start the Canva connection.",
      code: "canva_oauth_start_failed",
    });
  }
});

router.get("/canva/oauth/callback", async (req, res): Promise<void> => {
  let redirectUri: string;
  try {
    redirectUri = getCanvaOAuthConfig().redirectUri;
  } catch (error) {
    req.log.error({ err: error }, "Canva OAuth callback is not configured");
    res.status(503).send("Canva OAuth is not configured.");
    return;
  }

  const providerError = asString(req.query.error);
  if (providerError) {
    res.redirect(302, appRedirectUrl(redirectUri, "cancelled"));
    return;
  }

  const sessionId = getSessionId(req);
  const code = asString(req.query.code);
  const state = asString(req.query.state);
  if (!sessionId || !code || !state) {
    res.redirect(302, appRedirectUrl(redirectUri, "error"));
    return;
  }

  try {
    await completeCanvaOAuth(sessionId, state, code);
    res.redirect(302, appRedirectUrl(redirectUri, "connected"));
  } catch (error) {
    req.log.warn(
      {
        code:
          error instanceof CanvaAuthError || error instanceof CanvaRemoteError
            ? error.code
            : "canva_oauth_callback_failed",
      },
      "Canva OAuth callback failed",
    );
    res.redirect(302, appRedirectUrl(redirectUri, "error"));
  }
});

router.get("/canva/auth/status", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const data = GetCanvaAuthStatusResponse.parse(
      await getCanvaSessionStatus(getSessionId(req)),
    );
    res.json(data);
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/canva/auth/disconnect", async (req, res): Promise<void> => {
  if (!requireSameOrigin(req, res)) return;
  try {
    await deleteCanvaSession(getSessionId(req));
    res.clearCookie(CANVA_SESSION_COOKIE, CLEAR_COOKIE_OPTIONS);
    res.json(
      GetCanvaAuthStatusResponse.parse({ connected: false, expiresAt: null }),
    );
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/canva/generations", async (req, res): Promise<void> => {
  if (!requireSameOrigin(req, res)) return;
  const input = CreateCanvaGenerationBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({
      error: input.error.message,
      code: "invalid_generation_request",
    });
    return;
  }

  try {
    const token = await getCanvaAccessToken(getSessionId(req));
    const result = await callCanva(token, "/image-generations", {
      prompt: input.data.prompt,
      aspect_ratio: input.data.aspectRatio,
      idempotency_key: randomUUID(),
      asset_upload: {
        type: "upload",
        asset_name: `Campaign image - ${input.data.prompt.trim().slice(0, 220)}`,
      },
    });
    const job = asRecord(result.job);
    const jobId = asString(job?.id);
    const status = normalizeStatus(job?.status);
    if (!jobId || !status) {
      throw new CanvaRemoteError(
        "Canva returned an invalid generation job.",
        502,
        "invalid_canva_response",
      );
    }
    res
      .status(202)
      .json(CreateCanvaGenerationResponse.parse({ jobId, status }));
  } catch (error) {
    sendError(req, res, error);
  }
});

router.get("/canva/generations/:jobId", async (req, res): Promise<void> => {
  const params = GetCanvaGenerationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      error: params.error.message,
      code: "invalid_job_id",
    });
    return;
  }

  try {
    const token = await getCanvaAccessToken(getSessionId(req));
    const result = await callCanva(
      token,
      `/image-generations/${encodeURIComponent(params.data.jobId)}`,
    );
    const job = asRecord(result.job);
    const status = normalizeStatus(job?.status);
    if (!status) {
      throw new CanvaRemoteError(
        "Canva returned an invalid generation status.",
        502,
        "invalid_canva_response",
      );
    }
    const jobResult = asRecord(job?.result);
    const image = asRecord(jobResult?.image);
    const asset = asRecord(image?.asset);
    const jobError = asRecord(job?.error);
    const data = GetCanvaGenerationResponse.parse({
      jobId: params.data.jobId,
      status,
      imageUrl: asString(image?.url),
      assetId: asString(asset?.id) ?? asString(asset?.asset_id),
      error: asString(jobError?.message),
    });
    res.json(data);
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/canva/imports", async (req, res): Promise<void> => {
  if (!requireSameOrigin(req, res)) return;
  const input = CreateCanvaImageImportBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({
      error: input.error.message,
      code: "invalid_import_request",
    });
    return;
  }

  try {
    const token = await getCanvaAccessToken(getSessionId(req));
    const result = await callCanva(token, "/image-to-design-imports", {
      image: { asset_id: input.data.assetId },
      title: input.data.title,
    });
    const job = asRecord(result.job);
    const jobId = asString(job?.id);
    const status = normalizeStatus(job?.status);
    if (!jobId || !status) {
      throw new CanvaRemoteError(
        "Canva returned an invalid image import job.",
        502,
        "invalid_canva_response",
      );
    }
    res
      .status(202)
      .json(CreateCanvaImageImportResponse.parse({ jobId, status }));
  } catch (error) {
    sendError(req, res, error);
  }
});

router.get("/canva/imports/:jobId", async (req, res): Promise<void> => {
  const params = GetCanvaImageImportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      error: params.error.message,
      code: "invalid_job_id",
    });
    return;
  }

  try {
    const token = await getCanvaAccessToken(getSessionId(req));
    const result = await callCanva(
      token,
      `/image-to-design-imports/${encodeURIComponent(params.data.jobId)}`,
    );
    const job = asRecord(result.job);
    const status = normalizeStatus(job?.status);
    if (!status) {
      throw new CanvaRemoteError(
        "Canva returned an invalid image import status.",
        502,
        "invalid_canva_response",
      );
    }
    const jobResult = asRecord(job?.result);
    const design = asRecord(jobResult?.design);
    const urls = asRecord(design?.urls);
    const jobError = asRecord(job?.error);
    const data = GetCanvaImageImportResponse.parse({
      jobId: params.data.jobId,
      status,
      designUrl: asString(urls?.edit_url) ?? asString(urls?.view_url),
      error: asString(jobError?.message),
    });
    res.json(data);
  } catch (error) {
    sendError(req, res, error);
  }
});

export default router;
