# Product Imagery

Paste a shot list, or upload a CSV, and generate one product image per row. Typed rows use `product | shot | background | aspect | brief`. CSV headers can be `product`, `sku`, `shot`, `background`, `aspect`, and `brief`.

Parse the list, edit the rows, then Generate. `generateImage()` calls `createImageGeneration()` with `TOKEN` and `IMAGE_GEN_URL` from `.env.local`. That file is gitignored. Restart the dev server after changing it.

## Run locally

```bash
cd recipes/canva-product-imagery
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The Hearth & Kiln sample list is already on the call sheet.

## Canva hook

`createImageGeneration()` in `src/lib/canva/generate-image.ts` is the recipe. It does not contain a host or a token. The caller supplies both:

```ts
await createImageGeneration(input, { endpoint, accessToken })
```

That function:

1. POSTs `{endpoint}` with `prompt`, `aspect_ratio`, `count`, `model`, and `idempotency_key`
2. While `job.status` is `in_progress`, polls `GET {endpoint}/{job.id}`
3. Reads `job.result.image.url`

`aspect_ratio` is a name, not a pixel ratio: `1:1` maps to `square`, taller frames to `portrait`, wider frames to `landscape`. The exact ratio stays in the prompt as `framed 4:5`.

`generateShotList()` and `POST /api/canva/images` call `generateImage()`, which reads those two environment variables and returns each finished image URL.
