import { type RGB, type Vec3, hex, lab } from "./color";
import { type Rect } from "./image";
import { type Match, type Profile } from "./ph";
export type Measurement = {
  schema: "pocketsense.measurement.v1";
  id: string;
  timestamp: string;
  sampleName: string;
  imageKind: "synthetic" | "photo";
  rgb: RGB;
  hex: string;
  labD65: Vec3;
  rawRGB: RGB;
  roi: Rect;
  imageSize: [number, number];
  method: string;
  estimate: number | null;
  chartBracket: [number, number] | null;
  deltaE00: number | null;
  profile: Profile | null;
  calibration: {
    mode: "none" | "neutral-reference";
    gains: Vec3 | null;
    referenceRegion: Rect | null;
  };
  referencePH: number | null;
  qc: string[];
};
export function measurement(args: {
  name: string;
  demo: boolean;
  rgb: RGB;
  raw: RGB;
  roi: Rect;
  size: [number, number];
  match: Match | null;
  profile: Profile | null;
  gains: Vec3 | null;
  referenceRegion: Rect | null;
  referencePH: number | null;
  qc: string[];
}): Measurement {
  return {
    schema: "pocketsense.measurement.v1",
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sampleName: args.name,
    imageKind: args.demo ? "synthetic" : "photo",
    rgb: args.rgb,
    hex: hex(args.rgb),
    labD65: lab(args.rgb),
    rawRGB: args.raw,
    roi: args.roi,
    imageSize: args.size,
    method: args.match?.method ?? "color-only",
    estimate: args.match?.estimate ?? null,
    chartBracket: args.match?.interval ?? null,
    deltaE00: args.match?.delta ?? null,
    profile: args.profile,
    calibration: {
      mode: args.gains ? "neutral-reference" : "none",
      gains: args.gains,
      referenceRegion: args.referenceRegion,
    },
    referencePH: args.referencePH,
    qc: args.qc,
  };
}
export function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const escape = (v: unknown) => {
    let s =
      v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      keys.map(escape).join(","),
      ...rows.map((r) => keys.map((k) => escape(r[k])).join(",")),
    ].join("\r\n")
  );
}
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}
