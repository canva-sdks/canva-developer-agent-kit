import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db, canvaOAuthSessionsTable } from "@workspace/db";

const TOKEN_ENDPOINT = "https://api.canva.com/rest/v1/oauth/token";
const refreshJobs = new Map<string, Promise<string>>();

export const CANVA_SESSION_COOKIE = "canva_session";

export class CanvaAuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
    readonly code = "canva_auth_required",
  ) {
    super(message);
    this.name = "CanvaAuthError";
  }
}

export class CanvaRemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "CanvaRemoteError";
  }
}

function getConfig() {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  const redirectUri = process.env.CANVA_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new CanvaAuthError(
      "Canva OAuth is not configured. Add the client ID, client secret, and registered redirect URL.",
      503,
      "canva_not_configured",
    );
  }

  let parsedRedirectUri: URL;
  try {
    parsedRedirectUri = new URL(redirectUri);
  } catch {
    throw new CanvaAuthError(
      "The configured Canva redirect URL is invalid.",
      503,
      "canva_not_configured",
    );
  }
  if (parsedRedirectUri.protocol !== "https:") {
    throw new CanvaAuthError(
      "The Canva redirect URL must use HTTPS.",
      503,
      "canva_not_configured",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

function encryptionKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new CanvaAuthError(
      "Server-side token encryption is not configured.",
      503,
      "canva_not_configured",
    );
  }
  return createHash("sha256")
    .update(`campaign-image-studio-canva:${sessionSecret}`)
    .digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decrypt(value: string): string {
  const [encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (!encodedIv || !encodedTag || !encodedCiphertext) {
    throw new CanvaAuthError(
      "Stored Canva session data could not be read. Please reconnect Canva.",
      401,
      "canva_session_invalid",
    );
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CanvaAuthError(
      "Stored Canva session data could not be decrypted. Please reconnect Canva.",
      401,
      "canva_session_invalid",
    );
  }
}

export function hashOpaqueValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createCanvaOAuthChallenge() {
  const sessionId = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { sessionId, state, verifier, challenge };
}

export async function storeCanvaOAuthAttempt(
  sessionId: string,
  state: string,
  verifier: string,
): Promise<void> {
  await db
    .insert(canvaOAuthSessionsTable)
    .values({
      sessionHash: hashOpaqueValue(sessionId),
      stateHash: hashOpaqueValue(state),
      encryptedCodeVerifier: encrypt(verifier),
      stateExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      accessTokenExpiresAt: null,
    })
    .onConflictDoUpdate({
      target: canvaOAuthSessionsTable.sessionHash,
      set: {
        stateHash: hashOpaqueValue(state),
        encryptedCodeVerifier: encrypt(verifier),
        stateExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = getObject(body);
  if (response.ok && record) return record;

  const nestedError = getObject(record?.error);
  const code = getString(nestedError?.code) ?? getString(record?.code) ?? getString(record?.error);
  const message =
    getString(nestedError?.message) ??
    getString(record?.message) ??
    getString(record?.error_description) ??
    `Canva returned HTTP ${response.status}.`;
  throw new CanvaRemoteError(
    message,
    response.status >= 400 && response.status < 500 ? response.status : 502,
    code,
  );
}

function getExpiresAt(body: Record<string, unknown>): Date {
  const seconds = body.expires_in;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    throw new CanvaRemoteError(
      "Canva returned an invalid token expiry.",
      502,
      "invalid_token_response",
    );
  }
  return new Date(Date.now() + seconds * 1000);
}

async function requestToken(body: URLSearchParams): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}> {
  const { clientId, clientSecret } = getConfig();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await readJson(response);
  const accessToken = getString(payload.access_token);
  if (!accessToken) {
    throw new CanvaRemoteError(
      "Canva did not return an access token.",
      502,
      "invalid_token_response",
    );
  }
  return {
    accessToken,
    refreshToken: getString(payload.refresh_token),
    expiresAt: getExpiresAt(payload),
  };
}

export async function completeCanvaOAuth(
  sessionId: string,
  state: string,
  code: string,
): Promise<void> {
  const sessionHash = hashOpaqueValue(sessionId);
  const [session] = await db
    .select()
    .from(canvaOAuthSessionsTable)
    .where(eq(canvaOAuthSessionsTable.sessionHash, sessionHash))
    .limit(1);

  const expectedHash = session?.stateHash;
  const providedHash = hashOpaqueValue(state);
  const matches =
    expectedHash !== null &&
    expectedHash !== undefined &&
    timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(providedHash, "hex"));
  if (
    !session ||
    !matches ||
    !session.stateExpiresAt ||
    session.stateExpiresAt.getTime() <= Date.now() ||
    !session.encryptedCodeVerifier
  ) {
    throw new CanvaAuthError(
      "The Canva authorization expired or could not be verified. Please try again.",
      400,
      "canva_oauth_state_invalid",
    );
  }

  const { redirectUri } = getConfig();
  const verifier = decrypt(session.encryptedCodeVerifier);
  // Claim the state before contacting Canva. The conditional update prevents
  // overlapping callbacks (including across server instances) from reusing it.
  const [claimed] = await db
    .update(canvaOAuthSessionsTable)
    .set({
      stateHash: null,
      encryptedCodeVerifier: null,
      stateExpiresAt: null,
    })
    .where(
      and(
        eq(canvaOAuthSessionsTable.sessionHash, sessionHash),
        eq(canvaOAuthSessionsTable.stateHash, providedHash),
        eq(canvaOAuthSessionsTable.encryptedCodeVerifier, session.encryptedCodeVerifier),
        gt(canvaOAuthSessionsTable.stateExpiresAt, new Date(Date.now())),
      ),
    )
    .returning({ sessionHash: canvaOAuthSessionsTable.sessionHash });
  if (!claimed) {
    throw new CanvaAuthError(
      "The Canva authorization expired or could not be verified. Please try again.",
      400,
      "canva_oauth_state_invalid",
    );
  }

  const token = await requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  );

  if (!token.refreshToken) {
    throw new CanvaRemoteError(
      "Canva did not return a refresh token.",
      502,
      "invalid_token_response",
    );
  }

  await db
    .update(canvaOAuthSessionsTable)
    .set({
      stateHash: null,
      encryptedCodeVerifier: null,
      stateExpiresAt: null,
      encryptedAccessToken: encrypt(token.accessToken),
      encryptedRefreshToken: encrypt(token.refreshToken),
      accessTokenExpiresAt: token.expiresAt,
    })
    .where(eq(canvaOAuthSessionsTable.sessionHash, sessionHash));
}

async function refreshCanvaAccessToken(
  sessionHash: string,
): Promise<string> {
  const [session] = await db
    .select()
    .from(canvaOAuthSessionsTable)
    .where(eq(canvaOAuthSessionsTable.sessionHash, sessionHash))
    .limit(1);
  if (!session?.encryptedRefreshToken) {
    throw new CanvaAuthError("Connect Canva to continue.");
  }

  const encryptedRefreshToken = session.encryptedRefreshToken;
  const oldRefreshToken = decrypt(encryptedRefreshToken);
  const token = await (async () => {
    try {
      return await requestToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: oldRefreshToken,
        }),
      );
    } catch (error) {
      // Only a definitive credential rejection invalidates the connection.
      // Rate limits, provider outages, transport errors and invalid_client do not.
      if (
        error instanceof CanvaRemoteError &&
        (error.status === 400 || error.status === 401) &&
        error.code === "invalid_grant"
      ) {
        await db
          .update(canvaOAuthSessionsTable)
          .set({
            encryptedAccessToken: null,
            encryptedRefreshToken: null,
            accessTokenExpiresAt: null,
          })
          .where(and(
            eq(canvaOAuthSessionsTable.sessionHash, sessionHash),
            eq(canvaOAuthSessionsTable.encryptedRefreshToken, encryptedRefreshToken),
          ));
        throw new CanvaAuthError(
          "Your Canva connection is no longer valid. Reconnect Canva to continue.",
          401,
          "canva_reconnect_required",
        );
      }
      throw error;
    }
  })();
  const refreshToken = token.refreshToken ?? oldRefreshToken;
  await db
    .update(canvaOAuthSessionsTable)
    .set({
      encryptedAccessToken: encrypt(token.accessToken),
      encryptedRefreshToken: encrypt(refreshToken),
      accessTokenExpiresAt: token.expiresAt,
    })
    .where(eq(canvaOAuthSessionsTable.sessionHash, sessionHash));
  return token.accessToken;
}

export async function getCanvaAccessToken(
  sessionId: string | undefined,
): Promise<string> {
  if (!sessionId) {
    throw new CanvaAuthError("Connect Canva to continue.");
  }
  const sessionHash = hashOpaqueValue(sessionId);
  const [session] = await db
    .select()
    .from(canvaOAuthSessionsTable)
    .where(eq(canvaOAuthSessionsTable.sessionHash, sessionHash))
    .limit(1);
  if (!session?.encryptedRefreshToken) {
    throw new CanvaAuthError("Connect Canva to continue.");
  }

  const tokenIsFresh =
    session.encryptedAccessToken &&
    session.accessTokenExpiresAt &&
    session.accessTokenExpiresAt.getTime() > Date.now() + 60_000;
  if (tokenIsFresh && session.encryptedAccessToken) {
    return decrypt(session.encryptedAccessToken);
  }

  const existingRefresh = refreshJobs.get(sessionHash);
  if (existingRefresh) return existingRefresh;

  const refreshJob = refreshCanvaAccessToken(sessionHash).finally(() => {
    refreshJobs.delete(sessionHash);
  });
  refreshJobs.set(sessionHash, refreshJob);
  return refreshJob;
}

export async function getCanvaSessionStatus(sessionId: string | undefined) {
  if (!sessionId) return { connected: false, expiresAt: null };

  const [session] = await db
    .select({
      hasRefreshToken: canvaOAuthSessionsTable.encryptedRefreshToken,
      accessTokenExpiresAt: canvaOAuthSessionsTable.accessTokenExpiresAt,
    })
    .from(canvaOAuthSessionsTable)
    .where(
      eq(canvaOAuthSessionsTable.sessionHash, hashOpaqueValue(sessionId)),
    )
    .limit(1);

  return {
    connected: Boolean(session?.hasRefreshToken),
    expiresAt: session?.accessTokenExpiresAt?.toISOString() ?? null,
  };
}

export async function deleteCanvaSession(
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) return;
  const sessionHash = hashOpaqueValue(sessionId);
  const [session] = await db
    .select({
      encryptedRefreshToken: canvaOAuthSessionsTable.encryptedRefreshToken,
    })
    .from(canvaOAuthSessionsTable)
    .where(eq(canvaOAuthSessionsTable.sessionHash, sessionHash))
    .limit(1);

  if (session?.encryptedRefreshToken) {
    const { clientId, clientSecret } = getConfig();
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const response = await fetch("https://api.canva.com/rest/v1/oauth/revoke", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token: decrypt(session.encryptedRefreshToken),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      let code: string | null = null;
      try {
        const body: unknown = await response.json();
        const record =
          body !== null && typeof body === "object"
            ? (body as Record<string, unknown>)
            : null;
        code = getString(record?.code);
      } catch {
        // Keep the error message generic; the response can contain provider details.
      }
      throw new CanvaRemoteError(
        "Canva could not revoke this connection. Please try again.",
        response.status >= 500 ? 502 : response.status,
        code ?? "canva_revoke_failed",
      );
    }
  }

  await db
    .delete(canvaOAuthSessionsTable)
    .where(eq(canvaOAuthSessionsTable.sessionHash, sessionHash));
  refreshJobs.delete(sessionHash);
}

export function getCanvaOAuthConfig() {
  return getConfig();
}
