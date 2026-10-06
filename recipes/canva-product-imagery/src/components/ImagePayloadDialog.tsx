"use client";

import type { GenerateImageResult } from "@/lib/types";

export function ImagePayloadDialog({
  results,
  onClose,
}: {
  results: GenerateImageResult[];
  onClose: () => void;
}) {
  const first = results[0];
  const implemented = first?.status === "ok";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl bg-[#f7f1e6] p-6 text-[#1a1410] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#1a1410]/50">
              Canva image generation
            </p>
            <h2 className="mt-1 font-display text-2xl tracking-tight">
              {implemented ? "Images created" : "API not wired yet"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-sm text-[#1a1410]/60 hover:bg-black/5"
          >
            Close
          </button>
        </div>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-[#1a1410]/70">
          {first && first.status === "not_implemented"
            ? `${first.message} ${results.length} image${results.length === 1 ? "" : "s"} — one generation call per row on the shot list.`
            : `${results.filter((result) => result.status === "ok").length} of ${results.length} product image${results.length === 1 ? "" : "s"} generated.`}
        </p>
        <div className="mt-4 grid gap-3">
          {results.map((result) =>
            result.status === "ok" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={result.imageUrl}
                src={result.imageUrl}
                alt=""
                className="max-h-80 w-full rounded-xl bg-[#e4ddd0] object-contain"
              />
            ) : null,
          )}
        </div>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-[#1a1410] p-4 text-xs leading-relaxed text-[#f7f1e6]">
          {JSON.stringify(
            results.map((result) =>
              result.status === "not_implemented" ? result.input : result,
            ),
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  );
}
