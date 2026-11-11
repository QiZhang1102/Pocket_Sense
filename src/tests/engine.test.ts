import { describe, it, expect } from "vitest";
import {
  hex,
  parseHex,
  lab,
  deltaE,
  linear,
  encoded,
  cylindrical,
  type RGB,
  type Vec3,
} from "../lib/color";
import {
  statistics,
  calibrate,
  correct,
  corrected,
  palette,
  quality,
  bounds,
  type Pixels,
} from "../lib/image";
import {
  demoProfile,
  matchPH,
  validateProfile,
  validationMetrics,
  type Profile,
} from "../lib/ph";
import { measurement, csv } from "../lib/data";
import testData from "./ciede2000testdata.txt?raw";
function solid(rgb: RGB, w = 20, h = 20): Pixels {
  return {
    width: w,
    height: h,
    data: new Uint8ClampedArray(
      Array.from({ length: w * h }, () => [...rgb, 255]).flat(),
    ),
  };
}
describe("sRGB and D65 CIELAB", () => {
  it("converts HEX in both directions and rejects invalid input", () => {
    expect(hex([0, 128, 255])).toBe("#0080FF");
    expect(parseHex("#0080ff")).toEqual([0, 128, 255]);
    expect(() => parseHex("#xyz")).toThrow();
    expect(() => parseHex("#fff")).toThrow();
  });
  it("matches reference colors, including D65 white and sRGB red", () => {
    expect(lab([0, 0, 0])).toEqual([0, 0, 0]);
    const white = lab([255, 255, 255]);
    expect(white[0]).toBeCloseTo(100, 3);
    expect(Math.abs(white[1])).toBeLessThan(0.001);
    const red = lab([255, 0, 0]);
    [53.2408, 80.0925, 67.2032].forEach((v, i) =>
      expect(red[i]).toBeCloseTo(v, 3),
    );
  });
  it("round trips gamma at the transfer breakpoint", () => {
    for (const v of [0, 1, 10, 11, 64, 128, 255])
      expect(encoded(linear(v))).toBeCloseTo(v, 9);
  });
  it("handles achromatic and primary HSL/HSV", () => {
    expect(cylindrical([255, 0, 0]).hsl).toEqual([0, 100, 50]);
    expect(cylindrical([0, 0, 0]).hsv).toEqual([0, 0, 0]);
    expect(cylindrical([255, 255, 255]).hsl).toEqual([0, 0, 100]);
  });
});
describe("CIEDE2000: all 34 Sharma/Wu/Dalal published reference pairs", () => {
  const pairs = testData
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/).map(Number));
  expect(pairs).toHaveLength(34);
  pairs.forEach((v, i) =>
    it(`reference pair ${i + 1}`, () => {
      const a = v.slice(0, 3) as Vec3,
        b = v.slice(3, 6) as Vec3;
      expect(deltaE(a, b)).toBeCloseTo(v[6], 4);
      expect(deltaE(a, b)).toBeCloseTo(deltaE(b, a), 10);
    }),
  );
});
describe("region sampling and image QC", () => {
  it("samples only the selected pixels, including bounds at image edges", () => {
    const p = solid([100, 120, 140]);
    p.data.set([200, 100, 50, 255], 0);
    expect(statistics(p, { x: 0, y: 0, w: 1, h: 1 })?.robust).toEqual([
      200, 100, 50,
    ]);
    expect(bounds(p, { x: 999, y: -50, w: 999, h: 0 })).toEqual({
      x: 19,
      y: 0,
      w: 1,
      h: 1,
    });
  });
  it("trims isolated artifacts and reports variability", () => {
    const p = solid([100, 120, 140]);
    p.data.set([255, 255, 255, 255], 0);
    const s = statistics(p)!;
    expect(s.robust).toEqual([100, 120, 140]);
    expect(s.mean[0]).toBeGreaterThan(100);
    expect(s.std[0]).toBeGreaterThan(0);
  });
  it("excludes transparent pixels and handles empty samples", () => {
    const p = solid([100, 100, 100], 1, 1);
    p.data[3] = 0;
    expect(statistics(p)).toBeNull();
    expect(palette(p, 5)).toEqual([]);
  });
  it("flags exposure and small samples", () => {
    expect(quality(statistics(solid([0, 0, 0]))!)).toContain(
      "The image is dark. Add even lighting or adjust exposure.",
    );
    expect(quality(statistics(solid([255, 255, 255]))!)[0]).toMatch(
      /overexposed/,
    );
    expect(
      quality(statistics(solid([100, 100, 100], 1, 1))!, true).join(),
    ).toMatch(/few pixels/);
  });
});
describe("neutral reference correction", () => {
  it("preserves native ImageData dimensions exposed as prototype getters", () => {
    class NativeLike {
      get width() {
        return 2;
      }
      get height() {
        return 2;
      }
      get data() {
        return solid([120, 130, 140], 2, 2).data;
      }
    }
    const p = corrected(new NativeLike(), [1, 1, 1]);
    expect(p.width).toBe(2);
    expect(p.height).toBe(2);
    expect(p.data).toHaveLength(16);
  });
  it("equalizes a mildly tinted reference in linear RGB", () => {
    const s = statistics(solid([180, 170, 160]))!,
      c = calibrate(s);
    expect(c.gains).not.toBeNull();
    const fixed = correct(s.robust, c.gains!);
    expect(fixed[0]).toBeCloseTo(fixed[1], 8);
    expect(fixed[1]).toBeCloseTo(fixed[2], 8);
    const transformed = corrected(solid([180, 170, 160]), c.gains!);
    expect(statistics(transformed)?.std).toEqual([0, 0, 0]);
  });
  it("rejects dark, clipped, tiny and strongly tinted references", () => {
    for (const rgb of [
      [10, 10, 10],
      [255, 255, 255],
      [240, 70, 70],
    ] as RGB[])
      expect(calibrate(statistics(solid(rgb))!).gains).toBeNull();
    expect(
      calibrate(statistics(solid([150, 150, 150], 2, 2))!).gains,
    ).toBeNull();
  });
});
describe("deterministic palette extraction", () => {
  it("recovers actual colors without inventing additional clusters", () => {
    const p = solid([200, 80, 40]);
    for (let i = 0; i < p.data.length / 2; i += 4)
      p.data.set([40, 80, 200, 255], i);
    const a = palette(p, 5);
    expect(a).toHaveLength(2);
    expect(a.map((x) => hex(x.rgb)).sort()).toEqual(["#2850C8", "#C85028"]);
    expect(a.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 8);
    expect(palette(p, 5)).toEqual(a);
  });
});
describe("pH reference matching", () => {
  it("matches an exact reference", () => {
    const m = matchPH(parseHex("#94B889"), demoProfile);
    expect(m.estimate).toBe(7);
    expect(m.delta).toBeCloseTo(0);
    expect(m.method).toBe("nearest");
  });
  it("retains fractional reference labels", () => {
    const p = {
      ...demoProfile,
      patches: [
        { ph: 6.5, hex: "#94B889" },
        { ph: 7.5, hex: "#688FAD" },
      ],
    };
    expect(matchPH(parseHex("#94B889"), p).estimate).toBe(6.5);
  });
  it("rejects missing, duplicate, invalid and out-of-range profiles", () => {
    for (const p of [
      null,
      {},
      { ...demoProfile, patches: [] },
      {
        ...demoProfile,
        patches: [
          { ph: 0, hex: "#GGGGGG" },
          { ph: 1, hex: "#FFFFFF" },
        ],
      },
      {
        ...demoProfile,
        patches: [
          { ph: -1, hex: "#000000" },
          { ph: 2, hex: "#FFFFFF" },
        ],
      },
      {
        ...demoProfile,
        patches: [
          { ph: 1, hex: "#000000" },
          { ph: 1, hex: "#FFFFFF" },
        ],
      },
      {
        ...demoProfile,
        patches: [
          { ph: 1, hex: "#000000" },
          { ph: 2, hex: "#000000" },
        ],
      },
    ])
      expect(() => validateProfile(p)).toThrow();
  });
  it("refuses a very distant sample", () => {
    const m = matchPH([0, 0, 0], demoProfile, true);
    expect(m.estimate).toBeNull();
    expect(m.warnings.join()).toMatch(/reliable pH/);
  });
  it("can interpolate only inside a suitable neighboring segment", () => {
    const p: Profile = {
      id: "test",
      name: "test",
      synthetic: false,
      basis: "standard",
      patches: [
        { ph: 6, hex: "#8CAA80" },
        { ph: 7, hex: "#A0BE94" },
      ],
    };
    const m = matchPH([150, 180, 138], p, true);
    expect(m.method).toBe("interpolated");
    expect(m.estimate).toBeGreaterThan(6);
    expect(m.estimate).toBeLessThan(7);
    expect(m.interval).toEqual([6, 7]);
  });
  it("never extrapolates or interpolates wide reference gaps", () => {
    const p = {
      ...demoProfile,
      patches: [
        { ph: 1, hex: "#8CAA80" },
        { ph: 10, hex: "#A0BE94" },
      ],
    };
    expect(matchPH([150, 180, 138], p, true).method).toBe("nearest");
    expect(matchPH([140, 170, 128], p, true).estimate).toBe(1);
  });
  it("applies correction to both sample and same-photo references", () => {
    const gains: Vec3 = [1.1, 0.9, 1.05],
      rgb = correct(parseHex("#94B889"), gains);
    expect(matchPH(rgb, demoProfile, false, gains).delta).toBeCloseTo(0, 8);
  });
});
describe("traceable exports and real validation metrics", () => {
  it("exports all relevant calculation context with no photograph", () => {
    const r = measurement({
      name: "sample",
      demo: false,
      rgb: [148, 184, 137],
      raw: [148, 184, 137],
      roi: { x: 0, y: 0, w: 20, h: 20 },
      size: [20, 20],
      match: matchPH([148, 184, 137], demoProfile),
      profile: demoProfile,
      gains: null,
      referenceRegion: null,
      referencePH: 7.1,
      qc: ["example"],
    });
    expect(r.estimate).toBe(7);
    expect(r.schema).toBe("pocketsense.measurement.v1");
    expect(r.profile?.synthetic).toBe(true);
    expect(r.hex).toBe("#94B889");
    expect(r.calibration.mode).toBe("none");
    expect(r).not.toHaveProperty("pixels");
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
  it("escapes CSV quotes, multiline values, and spreadsheet formulas", () => {
    const output = csv([
      { name: "=SUM(1,2)", note: 'one\n"two"', estimate: -0.2 },
    ]);
    expect(output).toContain("'=SUM(1,2)");
    expect(output).toContain('"one\n""two"""');
    expect(output).toContain('"-0.2"');
  });
  it("returns no metrics without observations and correct errors otherwise", () => {
    expect(validationMetrics([])).toBeNull();
    const m = validationMetrics([
      { estimate: 7, reference: 6 },
      { estimate: 6, reference: 8 },
    ])!;
    expect(m.n).toBe(2);
    expect(m.mae).toBe(1.5);
    expect(m.bias).toBe(-0.5);
    expect(m.rmse).toBeCloseTo(Math.sqrt(2.5));
  });
});
