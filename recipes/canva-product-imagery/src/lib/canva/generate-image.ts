import {
  IMAGE_MODEL,
  type GenerateImageInput,
  type GenerateImageResult,
  type ImageAspectRatio,
  type ProductAspect,
  type ProductShot,
} from "../types";

const ASPECT_RATIO: Record<ProductAspect, ImageAspectRatio> = {
  "1:1": "square",
  "4:5": "portrait",
  "3:4": "portrait",
  "2:3": "portrait",
  "9:16": "portrait",
  "4:3": "landscape",
  "3:2": "landscape",
  "16:9": "landscape",
};

const PENDING_JOB = new Set(["in_progress", "pending", "queued", "processing"]);

function imageGenerationError(status: number, step = "request") {
  if (status === 401 || status === 403) {
    return "Canva rejected the access token. Replace TOKEN in .env.local and restart the dev server.";
  }
  return `Image generation ${step} returned ${status}.`;
}

export type ImageGenerationJob = {
  id?: string;
  status?: string;
  result?: {
    image?: {
      url?: string;
      width?: number;
      height?: number;
    };
  };
};

type ImageGenerationResponse = { job?: ImageGenerationJob };

/**
 * Create one image, then poll until the job leaves `in_progress`.
 *
 * `endpoint` is the collection URL the caller supplies. This function does
 * not know the host or the access token.
 *   1. POST `endpoint` with `prompt`, `aspect_ratio`, `count`, `model`, `idempotency_key`
 *   2. While `job.status` is in progress, GET `endpoint/{job.id}`
 *   3. Read `job.result.image.url`
 */
export async function createImageGeneration(
  input: GenerateImageInput,
  options: { endpoint: string; accessToken: string },
): Promise<{ imageUrl: string | null; job: ImageGenerationJob | undefined }> {
  const endpoint = options.endpoint.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
  };
  const created = await fetch(endpoint, {
    method: "POST",
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
    headers,
    body: JSON.stringify({
      prompt: input.prompt,
      aspect_ratio: input.aspect_ratio,
      count: input.count,
      model: input.model,
      idempotency_key: input.idempotency_key,
    }),
  });
  if (!created.ok) {
    throw new Error(imageGenerationError(created.status));
  }

  let body = (await created.json()) as ImageGenerationResponse;
  const deadline = Date.now() + 90_000;
  while (
    body.job?.id &&
    body.job.status &&
    PENDING_JOB.has(body.job.status) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const polled = await fetch(`${endpoint}/${body.job.id}`, {
      headers: { Authorization: `Bearer ${options.accessToken}` },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!polled.ok) {
      throw new Error(imageGenerationError(polled.status, "poll"));
    }
    body = (await polled.json()) as ImageGenerationResponse;
  }

  return {
    imageUrl: body.job?.result?.image?.url ?? null,
    job: body.job,
  };
}

/**
 * Shot-list entry point. Reads `TOKEN` and `IMAGE_GEN_URL` from the
 * environment, then creates the job and polls until the image URL is ready.
 */
export async function generateImage(
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const accessToken = process.env.TOKEN?.trim() ?? "";
  const endpoint = process.env.IMAGE_GEN_URL?.trim() ?? "";
  if (!accessToken || !endpoint) {
    throw new Error(
      "Set TOKEN and IMAGE_GEN_URL in .env.local, then restart the dev server.",
    );
  }

  const result = await createImageGeneration(input, { endpoint, accessToken });
  const failed =
    result.job?.status === "failed" || result.job?.status === "failure";
  if (failed || !result.imageUrl) {
    throw new Error(
      failed ? "Image generation failed." : "Image generation returned no image.",
    );
  }

  return {
    status: "ok",
    imageUrl: result.imageUrl,
    width: result.job?.result?.image?.width,
    height: result.job?.result?.image?.height,
  };
}

export function imageAspectRatio(aspect: ProductAspect): ImageAspectRatio {
  return ASPECT_RATIO[aspect];
}

export function shotToInput(shot: ProductShot): GenerateImageInput {
  const product = shot.product.trim();
  if (!product) {
    throw new Error("Each shot needs a product name.");
  }

  const prompt = [
    `photography style ${product}`,
    `${(shot.shot.trim() || "Hero").toLowerCase()} shot`,
    shot.background.trim()
      ? `${shot.background.trim()} background`
      : "neutral studio background",
    `framed ${shot.aspect}`,
    shot.brief.trim(),
    shot.sku.trim() ? `SKU ${shot.sku.trim()}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return {
    prompt,
    aspect_ratio: imageAspectRatio(shot.aspect),
    count: 1,
    model: IMAGE_MODEL,
    idempotency_key: crypto.randomUUID(),
  };
}

/** Generate every frame on the shot list. Each row calls `generateImage`. */
export async function generateShotList(
  shots: ProductShot[],
): Promise<GenerateImageResult[]> {
  const results: GenerateImageResult[] = [];
  for (const shot of shots) {
    results.push(await generateImage(shotToInput(shot)));
  }
  return results;
}
