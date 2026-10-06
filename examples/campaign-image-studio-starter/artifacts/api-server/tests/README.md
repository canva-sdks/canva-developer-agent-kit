# Canva regression tests

Run from the workspace root:

```sh
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server test:typecheck
```

The tests execute the real OAuth code, real session schema, response validators,
and Express router. Persistence uses an in-memory adapter that evaluates
Drizzle equality/expiry predicates. HTTP route tests use a temporary loopback
server. Every Canva request uses a mocked global `fetch`; any unconfigured
request throws. All credentials and tokens are synthetic, and the database
module is mocked before it can initialize a connection pool.

Coverage includes PKCE and secure cookies, expired/mismatched/replayed states,
overlapping callback claims, authenticated token encryption, refresh rotation
and shared failures, generation-to-import response mapping, request validation,
origin checks, and provider errors.

The persistence adapter does not prove PostgreSQL transaction or deployment
behavior. Refresh serialization is currently process-local; these tests verify
simultaneous callers within one API process, not multiple deployed instances.
