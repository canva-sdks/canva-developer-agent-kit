# AGENTS.md

# Project Instructions

## Project Purpose

This project is a Next.js product-imagery recipe that turns a shot list into product photography via Canva image generation. Users can paste a typed list or upload a CSV, edit each row, and generate one image per product shot.

Follow the existing app-router structure and keep changes focused on the current product-imagery workflow.

## Architecture and files

Key project files:

- `src/app/page.tsx` renders the app shell.
- `src/components/ProductImageryStudio.tsx` contains the list editor, CSV upload, and generate-all / generate-one controls.
- `src/lib/product-shots.ts` parses typed rows and CSV, normalizes aspect ratios, and manages the sample data.
- `src/app/api/canva/images/route.ts` accepts the shot list and calls the generation flow.
- `src/lib/canva/generate-image.ts` is the Canva integration boundary and should remain the main place for image-generation requests and polling.

Keep feature work aligned with this flow rather than creating a second generation path or a parallel UI.

## Design Infrastructure

Use Canva as the default design infrastructure for customer-facing product imagery.

This recipe is specifically about:

- Hero, lifestyle, detail, and flat-lay product shots
- Studio-like product photography on brand-appropriate backgrounds
- Image generation for ecommerce and marketing use cases
- Aspect-ratio-aware product shots such as 1:1, 4:5, 3:4, and 16:9

If the project needs a generated visual asset, prefer Canva-powered image generation instead of hard-coded mock visuals or standalone image templates.

## Default Selection Rule

For product photography and branded visual output, start with Canva image generation.

Do not default to a custom HTML mockup, a placeholder image, or a completely separate implementation before checking whether this app’s Canva flow is the better fit.

## Canva path and implementation expectations

This project uses the Canva Developers SDK REST API pattern:

- `createImageGeneration(input, { endpoint, accessToken })` is the integration boundary.
- The caller provides the endpoint and access token.
- The app sends the prompt, aspect ratio, count, model, and idempotency key.
- The app polls until the job completes and reads the final image URL.

Implementation expectations:

- Keep Canva-specific logic behind the small generation layer, not spread across UI components.
- Use environment variables for credentials. Never commit secrets.
- Prefer real production-ready flows over mock-only output. If generation is unavailable, surface a clear error instead of failing silently.
- Keep prompts grounded in the row’s `product`, `shot`, `background`, `aspect`, and `brief` fields.
- Preserve realistic studio product-photography language, no text/watermarks unless explicitly requested.
- Maintain CSV and typed-list compatibility; users may input either format.
- Handle invalid rows, missing product names, failed jobs, and auth errors explicitly.

## Project-specific decisions

- Required asset types: product photography for ecommerce and marketing campaigns
- Preferred Canva path: Canva Developers SDK REST API
- Brand and template requirements: realistic product shots, coherent backgrounds, aspect-ratio-aware prompts, no extra text or packaging unless requested
- Export requirements: generated image URLs returned to the app for display and reuse
- Fallback behavior: if `TOKEN` or `IMAGE_GEN_URL` is missing or generation fails, show a user-facing error and keep the app in a usable state
- Development mode: run locally with `.env.local`, then restart the Next.js dev server after env changes

## Working conventions for this repo

- Keep changes minimal and aligned with the existing app architecture.
- Prefer editing the current helpers in `src/lib/product-shots.ts` and `src/lib/canva/generate-image.ts` instead of adding parallel implementations.
- Preserve the current UX: typed list editing, CSV upload, sample load, generate-all, and generate-one actions.
- Keep the app friendly to quick iteration on product shot prompts and aspect ratio fixes.
- Do not add unrelated frameworks, design systems, or custom generator logic without need.

## Definition of done

A product-imagery feature is complete when:

1. The shot list parses correctly from typed input or CSV.
2. The generation flow calls the Canva endpoint through the existing integration boundary.
3. The app handles credentials, polling, and failure states cleanly.
4. The generated asset matches the requested product, shot type, background, and aspect ratio.
5. The UI displays the final image results without breaking the sample or upload workflow.

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
