import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  canvaOAuthSessionsTable,
  type CanvaOAuthSession,
  type InsertCanvaOAuthSession,
} from "../../../../lib/db/src/schema/canva-oauth-sessions";

// Mock only persistence, not the OAuth implementation, schema, or encryption.
// Evaluate the WHERE predicates so session isolation and atomic claims matter.
export const rows = new Map<string, CanvaOAuthSession>();
const dialect = new PgDialect();
const columnKeys = Object.fromEntries(
  Object.entries(canvaOAuthSessionsTable)
    .filter(([, value]) => value && typeof value === "object" && "name" in value)
    .map(([key, column]) => [(column as { name: string }).name, key]),
);

function matches(row: CanvaOAuthSession, condition: SQL): boolean {
  const query = dialect.sqlToQuery(condition);
  const comparisons = [...query.sql.matchAll(/"canva_oauth_sessions"\."(\w+)"\s*(=|>)\s*\$(\d+)/g)];
  if (comparisons.length === 0) throw new Error(`Unsupported mock predicate: ${query.sql}`);
  return comparisons.every(([, name, operator, index]) => {
    const actual = row[columnKeys[name] as keyof CanvaOAuthSession];
    const rawExpected = query.params[Number(index) - 1];
    if (operator === "=") return actual === rawExpected;
    if (!(actual instanceof Date)) return false;
    return actual.getTime() > new Date(rawExpected as string).getTime();
  });
}

type Projection = Record<string, { name: string }>;
function project(row: CanvaOAuthSession, fields?: Projection) {
  return fields
    ? Object.fromEntries(Object.entries(fields).map(([alias, column]) => [
        alias, row[columnKeys[column.name] as keyof CanvaOAuthSession],
      ]))
    : { ...row };
}

export const memoryDb = {
  insert: () => ({
    values: (values: InsertCanvaOAuthSession) => ({
      onConflictDoUpdate: async ({ set }: { set: Partial<CanvaOAuthSession> }) => {
        const existing = rows.get(values.sessionHash);
        rows.set(values.sessionHash, existing ? { ...existing, ...set } : {
          stateHash: null, encryptedCodeVerifier: null, stateExpiresAt: null,
          encryptedAccessToken: null, encryptedRefreshToken: null,
          accessTokenExpiresAt: null, createdAt: new Date(), updatedAt: new Date(),
          ...values,
        });
      },
    }),
  }),
  select: (fields?: Projection) => ({
    from: () => ({
      where: (condition: SQL) => ({
        limit: async (count: number) => [...rows.values()]
          .filter(row => matches(row, condition))
          .slice(0, count).map(row => project(row, fields)),
      }),
    }),
  }),
  update: () => ({
    set: (values: Partial<CanvaOAuthSession>) => ({
      where: (condition: SQL) => {
        const changed: CanvaOAuthSession[] = [];
        for (const [key, row] of rows) {
          if (matches(row, condition)) {
            const updated = { ...row, ...values };
            rows.set(key, updated);
            changed.push(updated);
          }
        }
        return Object.assign(Promise.resolve(changed), {
          returning: async (fields?: Projection) => changed.map(row => project(row, fields)),
        });
      },
    }),
  }),
  delete: () => ({
    where: async (condition: SQL) => {
      for (const [key, row] of rows) if (matches(row, condition)) rows.delete(key);
    },
  }),
};
