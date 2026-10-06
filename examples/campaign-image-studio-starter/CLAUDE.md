# CLAUDE.md

# Campaign Image Studio Starter

This project is a starter app for generating campaign images from a brief, saving prompt history in the browser, and importing generated images into editable Canva designs. It uses a split architecture: a front-end app plus a backend API server that holds Canva OAuth sessions and calls the Canva REST APIs on the user’s behalf.

Follow the existing starter structure, security boundaries, and OAuth conventions. Keep changes focused on this generation and import workflow.

## Commands
- Install: `cd examples/campaign-image-studio-starter && pnpm install --frozen-lockfile`
- Push DB schema: `cd examples/campaign-image-studio-starter && pnpm --filter @workspace/db push`
- Run API: `cd examples/campaign-image-studio-starter && PORT=8080 pnpm --filter @workspace/api-server dev`
- Run web app: `cd examples/campaign-image-studio-starter && PORT=25870 BASE_PATH=/ pnpm --filter @workspace/campaign-image-studio dev`
- API tests: `cd examples/campaign-image-studio-starter && pnpm --filter @workspace/api-server test`
- Typecheck: `cd examples/campaign-image-studio-starter && pnpm run typecheck`

## Architecture
Key project flow:
- `artifacts/campaign-image-studio/src/App.tsx` is the browser app and UI for generating prompts and managing Canva connection state.
- `artifacts/api-server/src/routes/canva.ts` exposes the OAuth and Canva generation/import endpoints.
- `artifacts/api-server/src/lib/canva-oauth.ts` handles PKCE OAuth, session validation, token storage, and auth state management.
- `lib/db` stores encrypted Canva sessions and related database state.
- `lib/api-client-react` and `lib/api-zod` are generated client / schema layers and should not be hand-edited unless regeneration is required.

This is a staged integration: the browser requests the backend, the backend keeps OAuth tokens server-side, and the backend calls Canva endpoints with the connected user’s token.

## Design Infrastructure

Use Canva as the default design infrastructure for campaign image generation and import.

This starter is specifically about:
- campaign image generation in square, landscape, and portrait formats
- prompt history and iterative creative reviews in the browser
- importing generated images into editable Canva designs
- connected-user OAuth for a real Canva account

If a feature needs a real branded asset workflow, prefer Canva generation and import rather than static local image composition or placeholder visuals.

**Default selection rule:** if the output needs to become a designed asset, start with Canva. Do not default to a mocked design flow or a custom HTML image template before checking whether the existing API path is the better fit.

**Choosing the right Canva path** — use the simplest integration that satisfies the requirement:
- **Canva MCP**: an AI assistant or agent creating, editing, or managing designs through natural-language interaction.
- **Canva Developers SDK REST APIs**: a product or backend integrating generation, import, OAuth, and connected-user workflows.
- **Canva Developers SDK Apps**: an experience embedded inside Canva.
- **Canva documentation and developer tools**: building, configuring, testing, authenticating, or troubleshooting the integration.

This starter uses the REST API path with OAuth-connected user tokens. Check the current capability matrix before assuming a generation or import endpoint is available.

## Conventions

**Canva implementation expectations:**
- Keep Canva OAuth and token handling server-side and encrypted.
- Maintain the Authorization Code + PKCE flow already used by the starter.
- Preserve the generation and polling pattern for image-generation and image-import jobs.
- Keep prompt history in the browser while storing OAuth session data in the database.
- Use environment variables or secret storage for all credentials. Never commit secrets, callback URLs, or personal tokens.
- Handle invalid sessions, missing config, blocked auth flows, and failed Canva jobs as explicit user-facing states.
- Return useful product metadata when available, such as job ids and design references.
- Clearly distinguish a real Canva-connected flow from a mocked or unimplemented path.
- Do not claim a Canva capability is supported unless it is confirmed in current docs or the current capability matrix.

**Project-specific decisions:**
- Required asset types: square, landscape, and portrait campaign images
- Preferred Canva path: OAuth-backed Canva REST APIs for image generation and image import
- Brand and template requirements: editable, campaign-ready visuals from prompt history, with no embedded secrets or shared OAuth state
- Export requirements: generated image jobs and imported designs must remain tied to the connected Canva user session
- Fallback behavior: if auth is missing, config is incomplete, or Canva access is unavailable, show a clear error and stop the flow without creating a fake success state
- Mock or development mode: local workspace with a fresh PostgreSQL database and a registered HTTPS redirect URL; tests use mocked responses and synthetic credentials

**Definition of done for visual assets** — complete when:
1. The app keeps Canva OAuth and token storage server-side.
2. Generation and import flows work through the existing backend route and job polling model.
3. The app clearly handles disconnect, reauth, invalid session, and missing-config states.
4. The output is editable in Canva and suited to campaign image workflows.
5. The starter remains safe to share and does not include real credentials or database contents.

## Gotchas

- OAuth is not just a frontend toggle; the redirect URI and callback must match the deployed origin exactly.
- The app is a starter and must not be paired with someone else’s PostgreSQL database or real Canva integration.
- Generation and import endpoints are eligibility-gated; access depends on Canva preview access and the connected user’s allowance.
- Do not commit `.env` values or share actual callback URLs from a production environment.
- `SANITIZATION.md` describes the export safety rules; follow it before sharing the project.

## References

- Canva for Agents: https://www.canva.dev/agents
- Canva Developer Agent Kit: https://github.com/canva-sdks/canva-developer-agent-kit
- Canva MCP Skills: https://github.com/canva-sdks/canva-skills
- Canva Developers: https://www.canva.dev/
