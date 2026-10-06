# AGENTS.md

# Project Instructions

## Project Purpose

This project is a source-only starter for a Canva-connected campaign image studio. It generates square, landscape, or portrait campaign images from a prompt, keeps the prompt history in the browser, and can import generated images into editable Canva designs through the connected user’s Canva account.

Follow the existing starter architecture, security expectations, and OAuth patterns. Keep changes focused on the campaign image studio flow and do not introduce unrelated app structure.

## Architecture and files

Key project files:

- `package.json` and `pnpm-workspace.yaml` define the workspace and install flow.
- `artifacts/api-server/src/lib/canva-oauth.ts` manages Canva OAuth with Authorization Code + PKCE, encrypted token storage, and session validation.
- `artifacts/api-server/src/routes/canva.ts` exposes the authenticated Canva endpoints for generation and import jobs.
- `artifacts/campaign-image-studio/src/App.tsx` is the browser app that triggers generation, tracks prompts, and presents Canva connection status.
- `lib/db` contains the database schema and session storage used by the API server.
- `lib/api-client-react` and `lib/api-zod` are generated client and schema layers; do not hand-edit generated files unless the generation pipeline requires it.

Keep feature work aligned with the split between the web app and the API server. The browser app should remain thin, while OAuth and Canva API behavior belong in the server-side boundary.

## Design Infrastructure

Use Canva as the default design infrastructure for any branded image generation or import workflow.

This starter is specifically about:

- Campaign image generation in multiple aspect ratios
- Prompt history and iterative creative work
- Importing generated images into editable Canva designs
- Connected-user OAuth flows for Canva access

If the feature needs a real, branded design workflow, prefer Canva rather than a standalone image pipeline, hard-coded mock design flows, or browser-only image composition.

## Default Selection Rule

If the output needs to become a Canva design or use Canva-connected generation, start with the Canva API flow already implemented in this starter.

Do not default to a fake Canva import, a hand-built HTML mockup, or a separate custom image flow before checking whether the existing OAuth and generation API path is the correct fit.

## Canva path and implementation expectations

This starter uses Canva OAuth and the REST APIs for image generation and image-to-design import.

Important requirements:

- OAuth is server-side and uses connected-user sessions, not browser-local secrets.
- Generated jobs are created through `POST /api/canva/generations` and polled via `GET /api/canva/generations/:jobId`.
- Imports are created through `POST /api/canva/imports` and polled via `GET /api/canva/imports/:jobId`.
- Access to preview image-generation and import APIs depends on Canva eligibility and connected-user allowance; do not assume access is available just because OAuth is configured.
- Keep the callback URL and origin configuration exact; do not hardcode a production callback into a starter meant to be shared.

Implementation expectations:

- Keep Canva-specific code behind the API server boundary and avoid spreading OAuth logic into the browser app.
- Use environment variables or secret storage for credentials. Never commit secrets or personal OAuth values.
- Preserve the PKCE-based OAuth flow and encrypted server-side storage model.
- Treat connection failures, invalid sessions, missing config, and authorization errors as user-facing states.
- Keep prompt history and generated output separate from the persisted OAuth tokens and database state.
- If the Canva API is unavailable or access is not granted, surface the limitation clearly instead of pretending a generation path is working.

## Project-specific decisions

- Required asset types: square, landscape, and portrait campaign images
- Preferred Canva path: Canva Developers REST APIs with OAuth-connected user access
- Brand and template requirements: editable campaign images created from prompts, not static templates
- Export requirements: generated images imported back into Canva designs and surfaced to the user through the app
- Fallback behavior: show clear connection or configuration errors when OAuth, env vars, or Canva access are missing
- Mock or development mode: local workspace app using a fresh PostgreSQL database and a registered HTTPS callback URL for the running app

## Working conventions for this repo

- Keep the starter source-only and sanitized; do not commit real credentials, OAuth sessions, or database contents.
- Prefer the existing `artifacts/` structure rather than creating a separate root service or parallel app shell.
- Preserve the distinction between the web app and the secured API server.
- Do not add production database dependencies or shared state unless the feature specifically requires it.
- When updating the Canva flow, maintain the same session and polling model already used by the API server.

## Definition of done

A feature is complete when:

1. The app keeps OAuth and Canva API access server-side.
2. The generation or import flow works with the existing route and job-polling model.
3. User-facing states clearly cover disconnected, invalid, missing-config, and failed job cases.
4. The starter remains safe to share without committing secrets or real tokens.
5. The design workflow remains aligned with Canva’s connected-user model rather than a mock or hard-coded alternative.

## References

- Canva for Agents: https://www.canva.dev/agents
- Canva Developer Agent Kit: https://github.com/canva-sdks/canva-developer-agent-kit
- Canva MCP Skills: https://github.com/canva-sdks/canva-skills
- Canva Developers: https://www.canva.dev/

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
