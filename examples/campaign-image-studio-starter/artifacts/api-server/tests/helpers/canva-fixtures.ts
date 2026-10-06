import { vi } from "vitest";
import {
  completeCanvaOAuth, createCanvaOAuthChallenge, hashOpaqueValue,
  storeCanvaOAuthAttempt,
} from "../../src/lib/canva-oauth";
import { rows } from "./canva-store";

export const tokenPayload = {
  access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600,
};

export function mockCanva(body: unknown, status = 200) {
  return vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

export async function pendingSession() {
  const challenge = createCanvaOAuthChallenge();
  await storeCanvaOAuthAttempt(challenge.sessionId, challenge.state, challenge.verifier);
  return { ...challenge, row: rows.get(hashOpaqueValue(challenge.sessionId))! };
}

export async function connectedSession() {
  const challenge = await pendingSession();
  mockCanva(tokenPayload);
  await completeCanvaOAuth(challenge.sessionId, challenge.state, "synthetic-code");
  vi.mocked(fetch).mockClear();
  return { ...challenge, row: rows.get(hashOpaqueValue(challenge.sessionId))! };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
