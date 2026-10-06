import { beforeEach, afterEach, vi } from "vitest";
import { rows } from "./helpers/canva-store";

vi.mock("@workspace/db", async () => {
  const schema = await import("../../../lib/db/src/schema/canva-oauth-sessions");
  const { memoryDb } = await import("./helpers/canva-store");
  return { ...schema, db: memoryDb };
});

beforeEach(() => {
  rows.clear();
  // Only synthetic values. Never load credentials or connect to a real database.
  vi.stubEnv("CANVA_CLIENT_ID", "test-client");
  vi.stubEnv("CANVA_CLIENT_SECRET", "synthetic-client-secret");
  vi.stubEnv("CANVA_REDIRECT_URI", "https://studio.example/api/canva/oauth/callback");
  vi.stubEnv("SESSION_SECRET", "synthetic-encryption-secret");
  vi.stubEnv("DATABASE_URL", "");
  vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 0, 1));
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Network disabled: configure a mocked Canva response in this test.");
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
