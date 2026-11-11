export type Vec3 = [number, number, number];
export type RGB = Vec3;
export const clamp = (n: number, lo = 0, hi = 255) =>
  Math.min(hi, Math.max(lo, n));
export const hex = (rgb: RGB) =>
  "#" +
  rgb
    .map((v) => Math.round(clamp(v)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
export function parseHex(value: string): RGB {
  if (!/^#[0-9a-f]{6}$/i.test(value))
    throw new Error("Enter a six-digit HEX color, such as #A6B77D.");
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as RGB;
}
export const linear = (v: number) =>
  v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
export const encoded = (v: number) =>
  clamp(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
// CIELAB with D65 white, not CSS lab() (which uses D50).
export function lab(rgb: RGB): Vec3 {
  const [r, g, b] = rgb.map(linear);
  const xyz = [
    (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047,
    r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883,
  ];
  const [x, y, z] = xyz.map((t) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116,
  );
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function cylindrical(rgb: RGB) {
  const [r, g, b] = rgb.map((v) => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2;
  let h = !d
    ? 0
    : max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return {
    hsl: [h, d ? (d / (1 - Math.abs(2 * l - 1))) * 100 : 0, l * 100],
    hsv: [h, max ? (d / max) * 100 : 0, max * 100],
  };
}
// Sharma, Wu & Dalal (2005). kL = kC = kH = 1.
export function deltaE(a: Vec3, b: Vec3): number {
  const rad = Math.PI / 180,
    sin = (v: number) => Math.sin(v * rad),
    cos = (v: number) => Math.cos(v * rad);
  const c1 = Math.hypot(a[1], a[2]),
    c2 = Math.hypot(b[1], b[2]),
    cbar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cbar ** 7 / (cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a[1],
    ap2 = (1 + g) * b[1];
  const cp1 = Math.hypot(ap1, a[2]),
    cp2 = Math.hypot(ap2, b[2]);
  const hue = (x: number, y: number) =>
    x === 0 && y === 0 ? 0 : (Math.atan2(y, x) / rad + 360) % 360;
  const h1 = hue(ap1, a[2]),
    h2 = hue(ap2, b[2]);
  const dl = b[0] - a[0],
    dc = cp2 - cp1;
  let dh = cp1 * cp2 === 0 ? 0 : h2 - h1;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * sin(dh / 2),
    L = (a[0] + b[0]) / 2,
    C = (cp1 + cp2) / 2;
  let H = h1 + h2;
  if (cp1 * cp2 !== 0)
    H =
      Math.abs(h1 - h2) <= 180
        ? H / 2
        : H < 360
          ? (H + 360) / 2
          : (H - 360) / 2;
  const t =
    1 -
    0.17 * cos(H - 30) +
    0.24 * cos(2 * H) +
    0.32 * cos(3 * H + 6) -
    0.2 * cos(4 * H - 63);
  const sl = 1 + (0.015 * (L - 50) ** 2) / Math.sqrt(20 + (L - 50) ** 2),
    sc = 1 + 0.045 * C,
    sh = 1 + 0.015 * C * t;
  const rt =
    -2 *
    Math.sqrt(C ** 7 / (C ** 7 + 25 ** 7)) *
    sin(60 * Math.exp(-(((H - 275) / 25) ** 2)));
  return Math.sqrt(
    (dl / sl) ** 2 +
      (dc / sc) ** 2 +
      (dH / sh) ** 2 +
      rt * (dc / sc) * (dH / sh),
  );
}
