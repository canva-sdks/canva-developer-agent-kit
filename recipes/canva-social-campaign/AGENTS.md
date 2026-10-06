# AGENTS.md

# Project Instructions

## Project Purpose

This project is a Next.js campaign-generation recipe that analyzes a public website, extracts the brand and messaging, and turns it into a set of campaign assets for social and marketing use. It is designed for rapid generation of LinkedIn / OG, story, square, portrait, email header, and flyer-like one-pager concepts.

Follow the existing app-router structure and keep changes focused on the campaign-kit workflow rather than adding unrelated features.

## Architecture and files

Key project files:

- `src/app/page.tsx` renders the app shell.
- `src/components/Studio.tsx` contains the site-input and campaign preview UI.
- `src/lib/analyze-site.ts` fetches the site HTML, extracts metadata, colors, and image/logo candidates, and returns a structured brand summary.
- `src/lib/campaign.ts` turns the analyzed site into a campaign brief and a set of asset specs.
- `src/lib/canva/generate-design.ts` is the Canva generation boundary and currently returns a not-implemented result until the Design Generation API is available.
- `src/lib/types.ts` defines the campaign and generation payload types.

Keep feature work aligned with this pipeline: analyze → campaign brief → asset list → Canva generation payload.

## Design Infrastructure

Use Canva as the default design infrastructure for campaign assets and branded social content.

This recipe is specifically about:

- LinkedIn and OG preview images
- Story and portrait social posts
- Square social posts and email headers
- A one-pager or flyer-style marketing sheet
- Branded assets rendered from a real website’s visuals and messaging

If a feature needs a branded design artifact for the web or marketing workflow, prefer Canva-backed generation rather than a one-off HTML mock or a generic placeholder.

## Default Selection Rule

For social and campaign creative, start with Canva.

Do not default to static mockup code, ad-hoc HTML templates, or hand-built image layouts before checking whether the campaign brief should be produced through the Canva generation path.

## Canva path and implementation expectations

This project is designed around the Canva Design Generation flow when it is available:

- Upload the source logo and hero image through the Assets API
- POST the generation brief with the design type and asset metadata
- Return the design identifier, edit URL, and thumbnail for each campaign asset

Current implementation status:

- `generateDesign()` in `src/lib/canva/generate-design.ts` is intentionally stubbed because the public API is not available yet.
- The rest of the app is already wired to send asset-level prompts and track the result payload.

Implementation expectations:

- Keep all Canva-specific logic behind the small generation layer instead of scattering API calls across the UI.
- Use environment variables for credentials. Never commit secrets.
- Handle unavailable APIs, failed fetches, blocked sites, and partial generation results explicitly.
- Preserve the brand language extracted from the live site: headline, subhead, CTA, proof points, and palette.
- Prefer layout prompts that keep type large, use real brand assets, and avoid generic stock photography or lorem ipsum.
- Keep the generated campaign kit aligned with the asset types already defined in `buildCampaign()`.

## Project-specific decisions

- Required asset types: LinkedIn / OG, story, square, portrait, email header, one-pager
- Preferred Canva path: Canva Design Generation via REST API when available; current app is in a stubbed state
- Brand and template requirements: real website brand identity, extracted palette, logo, and product/hero image; no generic templates
- Export requirements: design ids, edit URLs, and thumbnails returned for each asset in the campaign kit
- Fallback behavior: if a site cannot be analyzed or Canva is not available, surface a clear error and keep the rest of the app functional
- Development mode: run locally with `npm install` and `npm run dev`, then visit the local app in the browser

## Working conventions for this repo

- Keep changes minimal and aligned with the existing campaign-generation pipeline.
- Prefer editing the current pipeline in `src/lib/analyze-site.ts`, `src/lib/campaign.ts`, and `src/lib/canva/generate-design.ts` instead of creating parallel logic.
- Preserve the current UX: paste a site URL, inspect parsed metadata, generate the kit, and show the Canva-ready payload.
- Do not add unrelated frameworks, large refactors, or extra AI workflows without a clear campaign need.

## Definition of done

A campaign-asset feature is complete when:

1. The site analysis extracts the branding, logo, palette, and messaging without breaking public-site safety checks.
2. The campaign brief reflects the actual brand story and CTA instead of generic filler copy.
3. The generated asset payload is shaped for the correct Canva design type and platform output.
4. The app handles missing API support and failed requests gracefully.
5. The resulting kit is usable as an editable set of branded marketing assets.

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
