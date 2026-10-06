"use client";

import { ImagePayloadDialog } from "@/components/ImagePayloadDialog";
import {
  SAMPLE_CSV,
  SAMPLE_SHOTS,
  blankShot,
  parseShotList,
} from "@/lib/product-shots";
import {
  PRODUCT_ASPECTS,
  type GenerateImageResult,
  type ProductAspect,
  type ProductShot,
} from "@/lib/types";
import { FormEvent, useRef, useState } from "react";

const PLACEHOLDER = `Stoneware mug | Hero | White seamless | 1:1 | Three-quarter, soft north light
Stoneware mug | Lifestyle | Oak table | 4:5 | Morning coffee, linen, window light

Or a CSV with columns: product, sku, shot, background, aspect, brief`;

export function ProductImageryStudio() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [shots, setShots] = useState<ProductShot[]>(SAMPLE_SHOTS);
  const [sourceLabel, setSourceLabel] = useState("Hearth & Kiln sample");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState<GenerateImageResult[] | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});

  function applyList(text: string, label: string) {
    const parsed = parseShotList(text);
    if (parsed.error || !parsed.shots.length) {
      setError(parsed.error ?? "No shots in that list.");
      return;
    }
    setError(null);
    setShots(parsed.shots);
    setImages({});
    setSourceLabel(label);
    setDraft(text.trim());
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    applyList(draft, "Typed list");
  }

  async function readFile(file: File) {
    const text = await file.text();
    applyList(text, file.name);
  }

  function updateShot(id: string, patch: Partial<ProductShot>) {
    setShots((current) =>
      current.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
    );
  }

  async function generate(shotId?: string) {
    const ready = shotId ? shots.filter((shot) => shot.id === shotId) : shots;
    if (ready.some((shot) => !shot.product.trim())) {
      setError("Every shot needs a product name before it can be generated.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/canva/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shots, shotId }),
      });
      const data = (await response.json()) as {
        error?: string;
        results?: GenerateImageResult[];
      };
      if (!response.ok || !data.results) {
        throw new Error(data.error || "Couldn’t call Canva image generation.");
      }
      setResults(data.results);
      setImages((current) => {
        const next = { ...current };
        ready.forEach((shot, index) => {
          const result = data.results?.[index];
          if (result?.status === "ok") next[shot.id] = result.imageUrl;
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setCreating(false);
    }
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hearth-kiln-shot-list.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <p className="font-display text-xl tracking-tight">Product Imagery</p>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-20 sm:px-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#1a1410]/45">
          Image generation
        </p>
        <h1 className="mt-2 max-w-3xl font-display text-4xl leading-[0.95] tracking-[-0.03em] sm:text-6xl">
          The shot list,
          <br />
          then the pictures.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#1a1410]/65">
          Paste a CSV or type one line per frame. Generating the list creates
          one image job per row, then polls until each picture is ready.
        </p>

        <form
          onSubmit={onSubmit}
          className="mt-8 rounded-2xl bg-white/55 p-4 ring-1 ring-[#1a1410]/10 sm:p-5"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) void readFile(file);
          }}
        >
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#1a1410]/45">
              Shot list
            </span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={PLACEHOLDER}
              rows={6}
              className="mt-2 w-full resize-y rounded-xl border border-[#1a1410]/12 bg-white px-4 py-3 font-mono text-sm leading-relaxed outline-none placeholder:text-[#1a1410]/35 focus:ring-2 focus:ring-[#1a1410]/20"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="h-10 rounded-full bg-[#1a1410] px-5 text-sm font-medium text-[#f7f1e6]"
            >
              Use this list
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-10 rounded-full border border-[#1a1410]/15 bg-white px-4 text-sm"
            >
              Upload CSV
            </button>
            <button
              type="button"
              onClick={() => applyList(SAMPLE_CSV, "Hearth & Kiln sample")}
              className="h-10 rounded-full px-3 text-sm text-[#1a1410]/70 hover:text-[#1a1410]"
            >
              Load sample
            </button>
            <button
              type="button"
              onClick={downloadSample}
              className="h-10 rounded-full px-3 text-sm text-[#1a1410]/70 hover:text-[#1a1410]"
            >
              Download sample CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
                event.target.value = "";
              }}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[#1a1410]/50">
            Typed rows:{" "}
            <span className="font-mono">
              product | shot | background | aspect | brief
            </span>
            . CSV headers can be product, sku, shot, background, aspect, brief.
            Drop a file on the box to replace the list.
          </p>
        </form>

        {error ? <p className="mt-4 text-sm text-[#9b2c1a]">{error}</p> : null}

        <div className="mt-10 flex flex-wrap items-end justify-between gap-4 border-b border-[#1a1410]/10 pb-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#1a1410]/45">
              {sourceLabel}
            </p>
            <h2 className="mt-1 font-display text-3xl tracking-tight">
              {shots.length} {shots.length === 1 ? "image" : "images"}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShots((current) => [...current, blankShot()])}
              className="h-10 rounded-full border border-[#1a1410]/15 bg-white px-4 text-sm"
            >
              Add a shot
            </button>
            <button
              type="button"
              disabled={creating || shots.length === 0}
              onClick={() => void generate()}
              className="h-10 rounded-full bg-[#1a1410] px-5 text-sm font-medium text-[#f7f1e6] disabled:opacity-60"
            >
              {creating ? "Calling Canva…" : `Generate all ${shots.length}`}
            </button>
          </div>
        </div>

        {shots.length === 0 ? (
          <p className="mt-8 text-sm text-[#1a1410]/60">
            The call sheet is empty. Paste a list or add a shot.
          </p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shots.map((shot, index) => (
              <li
                key={shot.id}
                className="flex flex-col rounded-2xl bg-white/70 p-3 ring-1 ring-[#1a1410]/10"
              >
                <div className="relative h-48 overflow-hidden rounded-xl bg-[#e4ddd0]">
                  {images[shot.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={images[shot.id]}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <>
                      <div className="absolute inset-3 border border-dashed border-[#1a1410]/25" />
                      <p className="absolute bottom-5 left-5 right-5 font-display text-2xl tracking-tight">
                        {shot.shot || "Shot"}
                      </p>
                    </>
                  )}
                  <p className="absolute left-5 top-5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#1a1410]/70">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <p className="absolute right-5 top-5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#1a1410]/70">
                    {shot.aspect}
                  </p>
                </div>

                <label className="mt-3 block">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[#1a1410]/45">
                    Product
                  </span>
                  <input
                    value={shot.product}
                    onChange={(event) =>
                      updateShot(shot.id, { product: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-[#1a1410]/12 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a1410]/20"
                  />
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-[#1a1410]/45">
                      SKU
                    </span>
                    <input
                      value={shot.sku}
                      onChange={(event) =>
                        updateShot(shot.id, { sku: event.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-[#1a1410]/12 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a1410]/20"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-[#1a1410]/45">
                      Shot
                    </span>
                    <input
                      value={shot.shot}
                      onChange={(event) =>
                        updateShot(shot.id, { shot: event.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-[#1a1410]/12 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a1410]/20"
                    />
                  </label>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-[#1a1410]/45">
                      Background
                    </span>
                    <input
                      value={shot.background}
                      onChange={(event) =>
                        updateShot(shot.id, { background: event.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-[#1a1410]/12 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a1410]/20"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-[#1a1410]/45">
                      Aspect
                    </span>
                    <select
                      value={shot.aspect}
                      onChange={(event) =>
                        updateShot(shot.id, {
                          aspect: event.target.value as ProductAspect,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-[#1a1410]/12 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a1410]/20"
                    >
                      {PRODUCT_ASPECTS.map((aspect) => (
                        <option key={aspect} value={aspect}>
                          {aspect}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="mt-2 block">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[#1a1410]/45">
                    Brief
                  </span>
                  <textarea
                    value={shot.brief}
                    onChange={(event) =>
                      updateShot(shot.id, { brief: event.target.value })
                    }
                    rows={3}
                    className="mt-1 w-full resize-none rounded-lg border border-[#1a1410]/12 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a1410]/20"
                  />
                </label>
                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => void generate(shot.id)}
                    className="text-xs font-medium underline decoration-[#1a1410]/25 underline-offset-4 hover:decoration-[#1a1410] disabled:opacity-50"
                  >
                    Generate this shot
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setShots((current) =>
                        current.filter((item) => item.id !== shot.id),
                      )
                    }
                    className="text-xs text-[#1a1410]/45 hover:text-[#9b2c1a]"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {results ? (
        <ImagePayloadDialog results={results} onClose={() => setResults(null)} />
      ) : null}
    </div>
  );
}
