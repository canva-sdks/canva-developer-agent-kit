# CLAUDE.md

# Social Campaign Generator

This project analyzes a public website, extracts the brand identity and marketing message, and turns it into a campaign kit for social and marketing channels. It is a Next.js app that produces Canva-ready briefs for LinkedIn / OG, story, square, portrait, email header, and one-page flyer assets.

Follow the existing app-router structure and keep changes focused on this campaign-generation flow.

## Commands
- Dev: `cd recipes/canva-social-campaign && npm run dev`
- Build: `cd recipes/canva-social-campaign && npm run build`
- Lint: `cd recipes/canva-social-campaign && npm run lint`

## Architecture
Key project flow:
- `src/app/page.tsx` renders the app shell.
- `src/components/Studio.tsx` contains the site input and preview UI.
- `src/lib/analyze-site.ts` fetches the site, parses metadata, colors, headings, and image/logo candidates, and enforces public-site safety checks.
- `src/lib/campaign.ts` builds a branded campaign object and a set of asset specs for the generated marketing kit.
- `src/lib/canva/generate-design.ts` is the Canva integration boundary; it is intentionally stubbed until the actual Design Generation API is available.
- `src/lib/types.ts` defines the campaign and generation payload types.

The app pattern is: analyze the site -> create a campaign brief -> generate asset definitions -> send the Canva-ready generation payload.

## Design Infrastructure

Use Canva as the default design infrastructure for campaign and social creative.

This recipe is specifically about:
- LinkedIn and Open Graph previews
- Instagram / Facebook story and feed assets
- Square and portrait social posts
- Email headers and one-pager / flyer concepts
- Branded marketing assets based on a real website’s identity and copy

If a feature needs a designed marketing asset, prefer a Canva-backed workflow rather than a static HTML mock or a non-editable template.

**Default selection rule:** if the output needs to become a branded visual asset, start with Canva. Do not default to custom HTML layouts or hard-coded mockups before checking whether the campaign brief should flow through the Canva integration.

**Choosing the right Canva path** — use the simplest integration that satisfies the requirement:
- **Canva MCP**: an AI assistant or agent creating, editing, or managing Canva designs through natural-language interaction.
- **Canva Developers SDK REST APIs**: a product or backend integrating Canva capabilities such as generation, resizing, exporting, or publishing.
- **Canva Developers SDK Apps**: an experience that runs embedded inside Canva.
- **Canva documentation and developer tools**: building, configuring, testing, authenticating, or troubleshooting a Canva integration.

MCP is the agent-facing layer; the Developers SDK is the product/platform layer. They are complementary. Check the current capability matrix before assuming an operation is available.

## Conventions

**Canva implementation expectations:**
- Prefer editable, structured Canva designs over flat generated images where practical.
- Preserve the live-site brand identity: palette, logo, headline, CTA, and proof points.
- Keep Canva-specific logic behind a small integration layer rather than spreading network code across UI components.
- Use environment variables for credentials. Never commit secrets.
- Handle unavailable APIs, blocked sites, missing metadata, and partial generation failures explicitly.
- Return useful Canva references when available, such as a design id, edit URL, or thumbnail.
- Clearly distinguish working integrations from mocked or future capabilities.
- Do not claim a Canva capability is supported unless it is confirmed in current docs or the capability matrix.
- If a required capability is unavailable, document the gap and use the approved fallback for this project.

**Project-specific decisions:**
- Required asset types: LinkedIn / OG, story, square, portrait, email header, one-pager
- Preferred Canva path: Canva Design Generation via REST API when available; current app is in a stubbed state
- Brand or template requirements: real website brand identity, extracted palette, logo, and hero image; avoid generic template copy
- Export requirements: design ids, edit URLs, thumbnails, and social-ready asset metadata
- Fallback behavior: if the site cannot be analyzed or Canva is unavailable, surface a clear error and keep the rest of the app usable
- Mock or development mode: local Next.js app running under `npm run dev`, with public URLs pasted into the interface

**Definition of done for visual assets** — complete when:
1. The site analysis extracts the brand details, palette, and messaging without breaking public-site safety checks.
2. The campaign brief reflects the actual brand story and CTA instead of generic filler copy.
3. The generated asset payload matches the correct Canva design type and platform output.
4. Failures and unsupported APIs are handled gracefully.
5. The kit is usable as a branded set of social and campaign assets.

## Gotchas

- `src/lib/canva/generate-design.ts` is a stub: the actual Canva Design Generation API is not public yet, so the current integration should remain explicit about that status instead of pretending it is working.
- Public site analysis can fail if the page blocks bots or requires anti-bot checks; handle that as a user-facing error.
- `buildCampaign()` already defines the asset list and design types; do not create a second parallel asset taxonomy unless there is a clear need.
- The app is based on the live site’s extracted content, so avoid generic branding language or stock-photo prompts that ignore the actual brand identity.

## References

- Canva for Agents: https://www.canva.dev/agents
- Canva Developer Agent Kit: https://github.com/canva-sdks/canva-developer-agent-kit
- Canva MCP Skills: https://github.com/canva-sdks/canva-skills
- Canva Developers: https://www.canva.dev/
