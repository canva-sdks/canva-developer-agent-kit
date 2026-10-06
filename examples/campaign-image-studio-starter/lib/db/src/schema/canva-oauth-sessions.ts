import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const canvaOAuthSessionsTable = pgTable("canva_oauth_sessions", {
  sessionHash: text("session_hash").primaryKey(),
  stateHash: text("state_hash"),
  encryptedCodeVerifier: text("encrypted_code_verifier"),
  stateExpiresAt: timestamp("state_expires_at", { withTimezone: true }),
  encryptedAccessToken: text("encrypted_access_token"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCanvaOAuthSessionSchema = createInsertSchema(
  canvaOAuthSessionsTable,
).omit({ createdAt: true, updatedAt: true });

export type InsertCanvaOAuthSession = z.infer<
  typeof insertCanvaOAuthSessionSchema
>;
export type CanvaOAuthSession = typeof canvaOAuthSessionsTable.$inferSelect;
