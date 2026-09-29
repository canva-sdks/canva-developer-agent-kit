import {
  PRODUCT_ASPECTS,
  type ProductAspect,
  type ProductShot,
} from "./types";

export const MAX_SHOTS = 48;

const HEADER_ALIASES: Record<string, keyof ProductShot | "ignore"> = {
  product: "product",
  product_name: "product",
  name: "product",
  item: "product",
  sku: "sku",
  id: "sku",
  product_id: "sku",
  shot: "shot",
  shot_type: "shot",
  type: "shot",
  angle: "shot",
  view: "shot",
  background: "background",
  backdrop: "background",
  setting: "background",
  scene: "background",
  aspect: "aspect",
  aspect_ratio: "aspect",
  ratio: "aspect",
  size: "aspect",
  format: "aspect",
  brief: "brief",
  prompt: "brief",
  notes: "brief",
  description: "brief",
  direction: "brief",
};

const ASPECT_WORDS: Record<string, ProductAspect> = {
  "1:1": "1:1",
  "1x1": "1:1",
  square: "1:1",
  "4:5": "4:5",
  "4x5": "4:5",
  feed: "4:5",
  portrait: "4:5",
  "3:4": "3:4",
  "3x4": "3:4",
  "2:3": "2:3",
  "2x3": "2:3",
  "4:3": "4:3",
  "4x3": "4:3",
  "3:2": "3:2",
  "3x2": "3:2",
  "16:9": "16:9",
  "16x9": "16:9",
  banner: "16:9",
  landscape: "16:9",
  "9:16": "9:16",
  "9x16": "9:16",
  story: "9:16",
};

export const SAMPLE_SHOTS: ProductShot[] = [
  {
    id: "hk-mug-hero",
    product: "Stoneware mug",
    sku: "HK-204",
    shot: "Hero",
    background: "White seamless",
    aspect: "1:1",
    brief: "Three-quarter view, handle to the right, soft north light, no props.",
  },
  {
    id: "hk-mug-life",
    product: "Stoneware mug",
    sku: "HK-204",
    shot: "Lifestyle",
    background: "Oak table",
    aspect: "4:5",
    brief: "Morning coffee, linen napkin, window light. Hands out of frame.",
  },
  {
    id: "hk-mug-detail",
    product: "Stoneware mug",
    sku: "HK-204",
    shot: "Detail",
    background: "Warm gray",
    aspect: "1:1",
    brief: "Close crop on the glaze break at the rim. No text.",
  },
  {
    id: "hk-pour-hero",
    product: "Pour-over carafe",
    sku: "HK-118",
    shot: "Hero",
    background: "White seamless",
    aspect: "3:4",
    brief: "Full height, slight angle, cork collar visible, no liquid.",
  },
  {
    id: "hk-pour-use",
    product: "Pour-over carafe",
    sku: "HK-118",
    shot: "In use",
    background: "Kitchen counter",
    aspect: "16:9",
    brief: "Mid-pour into the stoneware mug. Steam, no faces.",
  },
  {
    id: "hk-set-story",
    product: "Breakfast set",
    sku: "HK-310",
    shot: "Flat lay",
    background: "Linen",
    aspect: "9:16",
    brief: "Mug, carafe, and spoon from above. Even spacing, no packaging.",
  },
];

export const SAMPLE_CSV = `product,sku,shot,background,aspect,brief
Stoneware mug,HK-204,Hero,White seamless,1:1,"Three-quarter view, handle to the right, soft north light, no props."
Stoneware mug,HK-204,Lifestyle,Oak table,4:5,"Morning coffee, linen napkin, window light. Hands out of frame."
Stoneware mug,HK-204,Detail,Warm gray,1:1,Close crop on the glaze break at the rim. No text.
Pour-over carafe,HK-118,Hero,White seamless,3:4,"Full height, slight angle, cork collar visible, no liquid."
Pour-over carafe,HK-118,In use,Kitchen counter,16:9,"Mid-pour into the stoneware mug. Steam, no faces."
Breakfast set,HK-310,Flat lay,Linen,9:16,"Mug, carafe, and spoon from above. Even spacing, no packaging."
`;

export function normalizeAspect(value: string): ProductAspect {
  const key = value.trim().toLowerCase().replace(/\s+/g, "");
  if (ASPECT_WORDS[key]) return ASPECT_WORDS[key];
  const match = key.match(/^(\d{1,2})[:x](\d{1,2})$/);
  if (match) {
    const candidate = `${match[1]}:${match[2]}` as ProductAspect;
    if ((PRODUCT_ASPECTS as readonly string[]).includes(candidate)) {
      return candidate;
    }
  }
  return "1:1";
}

function headerKey(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function isHeaderRow(cells: string[]): boolean {
  return cells.some((cell) => headerKey(cell) in HEADER_ALIASES);
}

/** RFC-style CSV: commas, quotes, and newlines inside quoted cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function nextId(index: number): string {
  return `shot-${index + 1}-${Math.random().toString(36).slice(2, 8)}`;
}

function shotFromFields(
  fields: Partial<Record<keyof ProductShot, string>>,
  index: number,
): ProductShot | null {
  const product = (fields.product ?? "").replace(/\s+/g, " ").trim();
  const brief = (fields.brief ?? "").replace(/\s+/g, " ").trim();
  if (!product && !brief) return null;
  return {
    id: nextId(index),
    product: product || brief.slice(0, 48),
    sku: (fields.sku ?? "").trim(),
    shot: (fields.shot ?? "").trim() || "Hero",
    background: (fields.background ?? "").trim(),
    aspect: normalizeAspect(fields.aspect ?? ""),
    brief: brief || `${product}, studio product photograph.`,
  };
}

function shotsFromCsv(text: string): ProductShot[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];

  const header = isHeaderRow(rows[0]);
  const keys = header
    ? rows[0].map((cell) => HEADER_ALIASES[headerKey(cell)] ?? "ignore")
    : null;
  const body = header ? rows.slice(1) : rows;

  return body
    .map((cells, index) => {
      const fields: Partial<Record<keyof ProductShot, string>> = {};
      if (keys) {
        cells.forEach((value, cellIndex) => {
          const key = keys[cellIndex];
          if (key && key !== "ignore") fields[key] = value;
        });
      } else if (cells.length >= 6) {
        fields.product = cells[0];
        fields.sku = cells[1];
        fields.shot = cells[2];
        fields.background = cells[3];
        fields.aspect = cells[4];
        fields.brief = cells.slice(5).join(", ");
      } else {
        const [product, shot, background, aspect, brief] = cells;
        fields.product = product;
        fields.shot = shot;
        fields.background = background;
        fields.aspect = aspect;
        fields.brief = brief;
      }
      return shotFromFields(fields, index);
    })
    .filter((shot): shot is ProductShot => shot !== null);
}

function shotsFromLines(text: string): ProductShot[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .map((line, index) => {
      const parts = line.split("|").map((part) => part.trim());
      const fields: Partial<Record<keyof ProductShot, string>> = {};
      if (parts.length <= 1) {
        fields.product = parts[0];
        fields.brief = parts[0];
      } else if (parts.length === 2) {
        fields.product = parts[0];
        fields.brief = parts[1];
      } else if (parts.length === 3) {
        fields.product = parts[0];
        fields.shot = parts[1];
        fields.brief = parts[2];
      } else if (parts.length === 4) {
        fields.product = parts[0];
        fields.shot = parts[1];
        fields.background = parts[2];
        fields.brief = parts[3];
      } else if (parts.length === 5) {
        fields.product = parts[0];
        fields.shot = parts[1];
        fields.background = parts[2];
        fields.aspect = parts[3];
        fields.brief = parts[4];
      } else {
        fields.product = parts[0];
        fields.sku = parts[1];
        fields.shot = parts[2];
        fields.background = parts[3];
        fields.aspect = parts[4];
        fields.brief = parts.slice(5).join(" | ");
      }
      return shotFromFields(fields, index);
    })
    .filter((shot): shot is ProductShot => shot !== null);
}

export function parseShotList(text: string): {
  shots: ProductShot[];
  error?: string;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { shots: [], error: "Paste a list or upload a CSV." };
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  const headerCells = firstLine.includes(",") ? parseCsv(firstLine)[0] ?? [] : [];
  const csvHeader = isHeaderRow(headerCells);
  const usePipes = trimmed.includes("|") && !csvHeader;
  const shots = (usePipes ? shotsFromLines(trimmed) : shotsFromCsv(trimmed)).slice(
    0,
    MAX_SHOTS,
  );

  if (!shots.length) {
    return {
      shots: [],
      error: "No shots in that list. Include a product name on each row.",
    };
  }

  return { shots };
}

export function blankShot(): ProductShot {
  return {
    id: nextId(0),
    product: "",
    sku: "",
    shot: "Hero",
    background: "White seamless",
    aspect: "1:1",
    brief: "",
  };
}
