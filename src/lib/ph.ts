import { type RGB, type Vec3, lab, deltaE, parseHex, hex } from "./color";
import { correct } from "./image";
export type Patch = { ph: number; hex: string };
export type Profile = {
  id: string;
  name: string;
  synthetic: boolean;
  basis: "standard" | "same-image";
  patches: Patch[];
};
export const demoProfile: Profile = {
  id: "demo-v1",
  name: "Synthetic demo chart · Not manufacturer calibration",
  synthetic: true,
  basis: "same-image",
  patches: [
    { ph: 4, hex: "#D98669" },
    { ph: 5, hex: "#E5B76B" },
    { ph: 6, hex: "#C9CB7C" },
    { ph: 7, hex: "#94B889" },
    { ph: 8, hex: "#70A79C" },
    { ph: 9, hex: "#688FAD" },
    { ph: 10, hex: "#827EAC" },
  ],
};
export function validateProfile(input: unknown): Profile {
  if (!input || typeof input !== "object")
    throw new Error("Invalid reference profile JSON.");
  const p = input as Profile;
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 80)
    throw new Error("The profile name must contain 1–80 characters.");
  if (p.basis !== "standard" && p.basis !== "same-image")
    throw new Error("Choose a reference color source.");
  if (
    !Array.isArray(p.patches) ||
    p.patches.length < 2 ||
    p.patches.length > 30
  )
    throw new Error("Provide 2–30 color patches with pH labels.");
  const patches = p.patches
    .map((q) => {
      if (
        !q ||
        typeof q.ph !== "number" ||
        !Number.isFinite(q.ph) ||
        q.ph < 0 ||
        q.ph > 14
      )
        throw new Error("pH labels must be finite numbers between 0 and 14.");
      return { ph: q.ph, hex: hex(parseHex(q.hex)) };
    })
    .sort((a, b) => a.ph - b.ph);
  if (new Set(patches.map((q) => q.ph)).size !== patches.length)
    throw new Error("pH labels must be unique.");
  if (new Set(patches.map((q) => q.hex)).size !== patches.length)
    throw new Error("Different pH labels cannot have identical colors.");
  return {
    id: typeof p.id === "string" ? p.id : crypto.randomUUID(),
    name: p.name.trim(),
    synthetic: p.synthetic === true,
    basis: p.basis,
    patches,
  };
}
export type Match = {
  estimate: number | null;
  nearest: Patch;
  referenceRGB: RGB;
  delta: number;
  interval: [number, number];
  method: "nearest" | "interpolated";
  warnings: string[];
  ranked: { ph: number; distance: number }[];
};
export function matchPH(
  rgb: RGB,
  profile: Profile,
  interpolate = false,
  gains?: Vec3,
): Match {
  const p = validateProfile(profile),
    sample = lab(rgb);
  const refs = p.patches.map((q) => {
    const raw = parseHex(q.hex),
      color = gains && p.basis === "same-image" ? correct(raw, gains) : raw;
    return { ...q, rgb: color, lab: lab(color), d: deltaE(sample, lab(color)) };
  });
  const ranked = refs
      .map((v, i) => ({ ...v, index: i }))
      .sort((a, b) => a.d - b.d),
    best = ranked[0],
    next = ranked[1];
  const warnings: string[] = [];
  const interval: [number, number] = [
    refs[Math.max(0, best.index - 1)].ph,
    refs[Math.min(refs.length - 1, best.index + 1)].ph,
  ];
  let estimate: number | null = best.ph,
    method: Match["method"] = "nearest";
  if (p.synthetic)
    warnings.push(
      "Synthetic demo data, for testing algorithms and the workflow only.",
    );
  if (best.d > 20) {
    estimate = null;
    warnings.push(
      "The sample differs too much from the chart for a reliable pH estimate. It may be out of range or captured under mismatched conditions.",
    );
  }
  if (next.d - best.d < 1 && best.d > 0.5)
    warnings.push(
      "Two reference colors match closely. Repeat the measurement or add reference points to resolve ambiguity.",
    );
  if (best.index === 0 || best.index === refs.length - 1)
    warnings.push(
      "The closest match is at the chart boundary. An out-of-range sample cannot be ruled out; no extrapolation is performed.",
    );
  if (
    interpolate &&
    estimate !== null &&
    best.d > 0.05 &&
    Math.abs(best.index - next.index) === 1 &&
    next.ph !== best.ph &&
    best.d < 12
  ) {
    const left = refs[Math.min(best.index, next.index)],
      right = refs[Math.max(best.index, next.index)];
    let residual = Infinity,
      fraction = 0;
    for (let n = 0; n <= 100; n++) {
      const t = n / 100,
        point = left.lab.map((v, c) => v + t * (right.lab[c] - v)) as Vec3,
        d = deltaE(sample, point);
      if (d < residual) {
        residual = d;
        fraction = t;
      }
    }
    if (
      residual < 5 &&
      fraction > 0 &&
      fraction < 1 &&
      right.ph - left.ph <= 2
    ) {
      estimate =
        Math.round((left.ph + fraction * (right.ph - left.ph)) * 10) / 10;
      method = "interpolated";
      interval[0] = left.ph;
      interval[1] = right.ph;
      warnings.push(
        "Interpolation between adjacent patches is a model assumption, not validated ±0.1 pH accuracy.",
      );
    } else
      warnings.push(
        "Local interpolation criteria were not met. Returning the nearest reference category.",
      );
  } else if (interpolate && best.d > 0.05)
    warnings.push(
      "Local interpolation criteria were not met. Returning the nearest reference category.",
    );
  return {
    estimate,
    nearest: { ph: best.ph, hex: best.hex },
    referenceRGB: best.rgb,
    delta: best.d,
    interval,
    method,
    warnings,
    ranked: ranked.map((v) => ({ ph: v.ph, distance: v.d })),
  };
}
export function validationMetrics(
  pairs: { estimate: number; reference: number }[],
) {
  if (!pairs.length) return null;
  const errors = pairs.map((p) => p.estimate - p.reference);
  return {
    n: errors.length,
    mae: errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length,
    bias: errors.reduce((s, e) => s + e, 0) / errors.length,
    rmse: Math.sqrt(errors.reduce((s, e) => s + e ** 2, 0) / errors.length),
  };
}
