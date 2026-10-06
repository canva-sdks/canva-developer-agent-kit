# Campaign Image Studio — example app

Generate square, landscape, or portrait campaign images from a brief, keep prompt history in the browser, and import generated images into editable Canva designs.

This is a source-only starter. It includes no real Canva credentials, connected sessions, database contents, browser history, Git history, or original deployment configuration. The OAuth implementation uses Authorization Code with PKCE. Each recipient must use their own Canva integration.

You can see an example of this app running at [https://campaign-image-studio.replit.app/](https://campaign-image-studio.replit.app/).

## Before you start

- Node.js 24 and pnpm 10.
- A new PostgreSQL database.
- A Canva developer integration with OAuth configured.
- Access to Canva's **preview** image-generation and image-to-design import APIs. OAuth access alone does not guarantee access to these endpoints. Check Canva's current eligibility and preview restrictions before relying on them for a publicly reviewed integration. Generation uses the connected user's Canva AI allowance.
- An HTTPS app URL. OAuth cookies are Secure; ordinary HTTP localhost is not a complete OAuth testing environment.

## Set up on Replit

1. Extract this archive and import its contents into a **new** Replit app, or upload the contents to a new GitHub repository and import that repository. Keep `package.json` and `pnpm-workspace.yaml` at the project root.
2. Ask Replit Agent to register the existing artifacts using their included manifests: `artifacts/campaign-image-studio` at `/` and `artifacts/api-server` at `/api`. Do not scaffold over or replace the existing source.
3. Provision a **new, empty** PostgreSQL database. Use its `DATABASE_URL`; do not connect this example to someone else's database.
4. Add the configuration below through Replit's environment and Secrets tools. Never paste credentials into the source, a README, or a chat.
5. Install dependencies and initialize the new database:

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @workspace/db push
   ```

   Review the schema changes before accepting them. This command is intended for the new database, not an existing production database.

6. Start the existing API and web services. The manifests supply the ports and web base path:

   ```sh
   # API service
   PORT=8080 pnpm --filter @workspace/api-server dev

   # Web service, in a separate workflow
   PORT=25870 BASE_PATH=/ pnpm --filter @workspace/campaign-image-studio dev
   ```

   Route `/api` to the API and `/` to the web service on the same public origin; the included manifests describe that routing. Do not expose these as unrelated public origins.

7. Register the exact development callback in [Canva's Developer Portal](), then open **Connect Canva**. Authorization must open in a separate browser tab, not inside Replit's embedded preview. Make sure the scopes selected match the ones used in this app. Scopes used are `asset:write`, `asset:read`, `design:content:write`, `design:content:read`, `design:meta:read`.


### Required configuration

| Variable | Storage | Value |
| --- | --- | --- |
| `CANVA_CLIENT_ID` | Environment variable or Secret | Your own integration's client ID. |
| `CANVA_CLIENT_SECRET` | Secret, server only | Your own integration's client secret. |
| `SESSION_SECRET` | Secret, server only | A fresh random value used to encrypt stored tokens. |
| `CANVA_REDIRECT_URI` | Environment variable | `https://YOUR-APP-HOST/api/canva/oauth/callback` |
| `DATABASE_URL` | Database-managed variable or Secret | Your new PostgreSQL database connection. |

Generate a fresh `SESSION_SECRET` locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put that output directly into Secrets. Do not commit it. Changing it later makes existing encrypted Canva tokens unreadable; users will need to reconnect.

`.env.example` lists empty configuration fields for reference. This app does **not** automatically load a `.env` file; inject variables through the environment or your hosting provider's secrets system.

### Development versus production callbacks

Use separate development and production `CANVA_REDIRECT_URI` values, and register both exact URLs in Canva. Do not set a conflicting shared value. The origin also protects write requests, so the configured callback's origin must match the app you are using.

The starter's API manifest intentionally contains **no** hardcoded OAuth callback. Before publishing, configure your own production callback. After publishing, verify the actual OAuth authorization request's `redirect_uri`; saved settings alone are not proof that the running process uses them. Never share authorization codes, OAuth state, or token-bearing URLs.

## API flow

The browser calls this app's backend, which keeps OAuth tokens server-side:

| App route | Canva endpoint |
| --- | --- |
| `POST /api/canva/generations` | `POST https://api.canva.com/rest/v1/image-generations` |
| `GET /api/canva/generations/:jobId` | `GET https://api.canva.com/rest/v1/image-generations/{jobId}` |
| `POST /api/canva/imports` | `POST https://api.canva.com/rest/v1/image-to-design-imports` |
| `GET /api/canva/imports/:jobId` | `GET https://api.canva.com/rest/v1/image-to-design-imports/{jobId}` |

Implementation: `artifacts/api-server/src/routes/canva.ts` and `artifacts/api-server/src/lib/canva-oauth.ts`.

Prompt history is stored in the current browser's local storage, not bundled with this source. OAuth sessions and encrypted tokens live in the database.

## Verify

```sh
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server test:typecheck
pnpm run typecheck
```

The included regression tests use synthetic credentials, mocked Canva responses, and an in-memory database adapter. They do not require real secrets and do not prove live Canva access or multi-server database behavior.

## Share your own copy safely

- Share a separate starter app, not your connected working app.
- Leave credentials unset in the starter. Recipients provide their own values.
- Keep database data copying disabled; never include OAuth session rows.
- Start a new Git repository. Do not attach the original repository or history.
- Do not commit `.env` files, database dumps, logs, screenshots of credentials, or personal project notes.
- Review future commits before sharing. Ignore rules do not remove already tracked files.
- If a real client secret was previously committed or shared, revoke/rotate it in Canva; removing the file does not undo exposure.

See `SANITIZATION.md` for the scope of this export.
