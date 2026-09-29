import { generateImage, generateShotList, shotToInput } from "@/lib/canva/generate-image";
import { MAX_SHOTS } from "@/lib/product-shots";
import { PRODUCT_ASPECTS, type ProductShot } from "@/lib/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isShot(value: unknown): value is ProductShot {
  if (!value || typeof value !== "object") return false;
  const shot = value as ProductShot;
  return (
    typeof shot.product === "string" &&
    typeof shot.shot === "string" &&
    typeof shot.brief === "string" &&
    (PRODUCT_ASPECTS as readonly string[]).includes(shot.aspect)
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      shots?: ProductShot[];
      shotId?: string;
    };
    const shots = body.shots ?? [];
    if (!shots.length) {
      return NextResponse.json({ error: "Add at least one shot." }, { status: 400 });
    }
    if (shots.length > MAX_SHOTS) {
      return NextResponse.json(
        { error: `Keep the list to ${MAX_SHOTS} shots.` },
        { status: 400 },
      );
    }
    if (!shots.every(isShot)) {
      return NextResponse.json(
        { error: "Each shot needs a product, a shot type, and an aspect ratio." },
        { status: 400 },
      );
    }

    if (body.shotId) {
      const shot = shots.find((item) => item.id === body.shotId);
      if (!shot) {
        return NextResponse.json({ error: "That shot is not on the list." }, { status: 400 });
      }
      const results = [await generateImage(shotToInput(shot))];
      return NextResponse.json({ results });
    }

    const results = await generateShotList(shots);
    return NextResponse.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Couldn’t generate images.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
