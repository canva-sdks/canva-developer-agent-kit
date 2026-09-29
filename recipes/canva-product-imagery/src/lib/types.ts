export const PRODUCT_ASPECTS = [
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "4:3",
  "3:2",
  "16:9",
  "9:16",
] as const;

export type ProductAspect = (typeof PRODUCT_ASPECTS)[number];

/** One frame on a product-photography call sheet. */
export type ProductShot = {
  id: string;
  product: string;
  sku: string;
  shot: string;
  background: string;
  aspect: ProductAspect;
  brief: string;
};

export const IMAGE_MODEL = "z_image_turbo" as const;

/** Named ratios the image API accepts. `square` is the confirmed 1:1 value. */
export type ImageAspectRatio = "square" | "portrait" | "landscape";

/** Body for one Canva image-generation request. */
export type GenerateImageInput = {
  prompt: string;
  aspect_ratio: ImageAspectRatio;
  count: number;
  model: typeof IMAGE_MODEL;
  idempotency_key: string;
};

export type GenerateImageResult =
  | {
      status: "not_implemented";
      message: string;
      input: GenerateImageInput;
    }
  | {
      status: "ok";
      imageUrl: string;
      width?: number;
      height?: number;
    };
