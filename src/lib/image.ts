import { type RGB, type Vec3, clamp, linear, encoded, lab } from "./color";
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };
export type Rect = { x: number; y: number; w: number; h: number };
export type Stats = {
  mean: RGB;
  median: RGB;
  robust: RGB;
  std: RGB;
  count: number;
  dark: number;
  highlights: number;
  channelClip: number;
  brightness: number;
  contrast: number;
  histogram: number[];
  spread: number;
};
export type Photo = {
  pixels: Pixels;
  name: string;
  originalWidth: number;
  originalHeight: number;
  demo: boolean;
};
export function bounds(p: Pixels, r?: Rect): Rect {
  const x = Math.floor(clamp(r?.x ?? 0, 0, p.width - 1)),
    y = Math.floor(clamp(r?.y ?? 0, 0, p.height - 1));
  return {
    x,
    y,
    w: Math.floor(clamp(r?.w ?? p.width, 1, p.width - x)),
    h: Math.floor(clamp(r?.h ?? p.height, 1, p.height - y)),
  };
}
export function colors(p: Pixels, r?: Rect, max = 40000): RGB[] {
  const { x, y, w, h } = bounds(p, r),
    step = Math.max(1, Math.ceil(Math.sqrt((w * h) / max))),
    out: RGB[] = [];
  for (let j = y; j < y + h; j += step)
    for (let i = x; i < x + w; i += step) {
      const n = (j * p.width + i) * 4;
      if (p.data[n + 3] >= 250)
        out.push([p.data[n], p.data[n + 1], p.data[n + 2]]);
    }
  return out;
}
export function statistics(p: Pixels, r?: Rect): Stats | null {
  const values = colors(p, r),
    n = values.length;
  if (!n) return null;
  const columns = [0, 1, 2].map((c) =>
    values.map((v) => v[c]).sort((a, b) => a - b),
  );
  const mean = columns.map((v) => v.reduce((a, b) => a + b, 0) / n) as RGB;
  const median = columns.map(
    (v) => (v[Math.floor((n - 1) / 2)] + v[Math.floor(n / 2)]) / 2,
  ) as RGB;
  const trim = Math.floor(n * 0.1),
    robust = columns.map(
      (v) =>
        v.slice(trim, n - trim).reduce((a, b) => a + b, 0) / (n - 2 * trim),
    ) as RGB;
  const std = columns.map((v, c) =>
    Math.sqrt(v.reduce((a, b) => a + (b - mean[c]) ** 2, 0) / n),
  ) as RGB;
  const ys = values.map(
    (v) =>
      0.2126 * linear(v[0]) + 0.7152 * linear(v[1]) + 0.0722 * linear(v[2]),
  );
  const histogram = Array(32).fill(0) as number[];
  ys.forEach((y) => histogram[Math.min(31, Math.floor(y * 32))]++);
  const brightness = ys.reduce((a, b) => a + b, 0) / n;
  const sorted = ys.slice().sort((a, b) => a - b),
    spread =
      sorted[Math.floor((n - 1) * 0.9)] - sorted[Math.floor((n - 1) * 0.1)];
  return {
    mean,
    median,
    robust,
    std,
    count: n,
    dark: values.filter((v) => Math.max(...v) <= 12).length / n,
    highlights: values.filter((v) => Math.min(...v) >= 250).length / n,
    channelClip: values.filter((v) => Math.max(...v) >= 250).length / n,
    brightness,
    contrast: Math.sqrt(ys.reduce((a, b) => a + (b - brightness) ** 2, 0) / n),
    histogram,
    spread,
  };
}
export function quality(s: Stats, region = false): string[] {
  const out: string[] = [];
  if (s.dark > 0.12 || s.brightness < 0.025)
    out.push("The image is dark. Add even lighting or adjust exposure.");
  if (s.highlights > 0.03)
    out.push(
      "Highlights may be overexposed. Lost color information cannot be recovered.",
    );
  else if (s.channelClip > 0.08)
    out.push("Channel clipping detected. Avoid glare and reduce exposure.");
  if (region && Math.max(...s.std) > 22)
    out.push(
      "The region is uneven. Select the strip center, avoiding edges, shadows and swabs.",
    );
  if (s.spread > 0.45)
    out.push(
      "Wide luminance variation may reflect shadows, glare or different objects.",
    );
  if (!region && s.contrast < 0.015)
    out.push(
      "Image contrast is low; this may also be a property of the subject.",
    );
  if (s.count < 9)
    out.push(
      "Very few pixels sampled. Select a uniform region for quantitative readings.",
    );
  return out;
}
export function calibrate(s: Stats): { gains: Vec3 | null; reason: string } {
  if (s.count < 25)
    return {
      gains: null,
      reason: "The reference region needs at least 25 valid pixels.",
    };
  if (
    Math.min(...s.robust) < 40 ||
    Math.max(...s.robust) > 245 ||
    s.channelClip > 0.01
  )
    return {
      gains: null,
      reason:
        "The reference is too dark or near clipping. Choose an unclipped neutral gray or white region.",
    };
  if (Math.max(...s.std) > 18)
    return {
      gains: null,
      reason:
        "The reference is not uniform enough. Avoid texture, edges and shadows.",
    };
  const v = s.robust.map(linear),
    target = v.reduce((a, b) => a + b, 0) / 3,
    gains = v.map((c) => target / c) as Vec3;
  if (gains.some((g) => g < 0.5 || g > 2))
    return {
      gains: null,
      reason:
        "The required correction is too strong and was rejected. Choose another neutral patch.",
    };
  return {
    gains,
    reason:
      "Reference correction is ready. It balances color cast; it does not restore clipping or measure lux.",
  };
}
export const correct = (rgb: RGB, gains: Vec3): RGB =>
  rgb.map((v, i) => encoded(linear(v) * gains[i])) as RGB;
export function corrected(p: Pixels, gains: Vec3): Pixels {
  const data = new Uint8ClampedArray(p.data),
    lookup = gains.map((g) =>
      Array.from({ length: 256 }, (_, i) => encoded(linear(i) * g)),
    );
  for (let i = 0; i < data.length; i += 4)
    for (let c = 0; c < 3; c++) data[i + c] = lookup[c][data[i + c]];
  return { width: p.width, height: p.height, data };
}
export function palette(p: Pixels, k: number): { rgb: RGB; share: number }[] {
  const rgb = colors(p, undefined, 6000);
  if (!rgb.length) return [];
  const points = rgb.map(lab),
    distance = (a: Vec3, b: Vec3) =>
      a.reduce((s, v, c) => s + (v - b[c]) ** 2, 0);
  const centers: Vec3[] = [points[Math.floor(points.length / 2)]];
  while (centers.length < k) {
    let far = 0,
      index = 0;
    points.forEach((p, i) => {
      const d = Math.min(...centers.map((c) => distance(p, c)));
      if (d > far) {
        far = d;
        index = i;
      }
    });
    if (far < 1) break;
    centers.push(points[index]);
  }
  let groups: number[][] = [];
  for (let it = 0; it < 14; it++) {
    groups = centers.map(() => []);
    points.forEach((p, i) => {
      let best = Infinity,
        at = 0;
      centers.forEach((c, j) => {
        const d = distance(p, c);
        if (d < best) {
          best = d;
          at = j;
        }
      });
      groups[at].push(i);
    });
    groups.forEach((g, j) => {
      if (g.length)
        centers[j] = [0, 1, 2].map(
          (c) => g.reduce((s, i) => s + points[i][c], 0) / g.length,
        ) as Vec3;
    });
  }
  return groups
    .filter((g) => g.length)
    .map((g) => ({
      rgb: [0, 1, 2].map((c) =>
        Math.round(g.reduce((s, i) => s + rgb[i][c], 0) / g.length),
      ) as RGB,
      share: g.length / rgb.length,
    }))
    .sort((a, b) => b.share - a.share);
}
export async function readPhoto(file: File): Promise<Photo> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error(
      "Choose a JPG, PNG or WebP image. Convert HEIC to JPG first.",
    );
  if (file.size > 30 * 1024 * 1024)
    throw new Error("The image exceeds 30 MB. Resize it and try again.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      "The image could not be decoded and may be corrupted. Export it again as JPG or PNG.",
    );
  }
  const originalWidth = bitmap.width,
    originalHeight = bitmap.height;
  if (originalWidth * originalHeight > 80e6) {
    bitmap.close();
    throw new Error(
      "The image exceeds 80 megapixels. Resize it and try again.",
    );
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
    colorSpace: "srgb",
  })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    pixels: ctx.getImageData(0, 0, canvas.width, canvas.height),
    originalWidth,
    originalHeight,
    name: file.name,
    demo: false,
  };
}
