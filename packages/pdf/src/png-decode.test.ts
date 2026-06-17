import { describe, it, expect } from "vitest";
import { decodePng } from "./png-decode";
import { buildPng } from "./test-support/png-fixtures";

/** Build a single-color-type PNG from RAW (unfiltered) pixel rows + a per-row
 *  filter type, by prepending the filter byte to each already-built filtered row.
 *  For filter 0 (None) the filtered bytes equal the raw bytes. */
function pngFromFilteredRows(params: {
  width: number; height: number; bitDepth: number; colorType: number;
  rows: readonly (readonly number[])[]; // each row = [filterType, ...filteredBytes]
  palette?: number[]; trns?: number[];
}) {
  const flat: number[] = [];
  for (const r of params.rows) flat.push(...r);
  return buildPng({
    width: params.width, height: params.height, bitDepth: params.bitDepth, colorType: params.colorType,
    scanlines: Uint8Array.from(flat),
    palette: params.palette ? Uint8Array.from(params.palette) : undefined,
    trns: params.trns ? Uint8Array.from(params.trns) : undefined,
  });
}

describe("decodePng — color types @ 8-bit", () => {
  it("grayscale (colorType 0)", () => {
    // 2x2, filter 0. raw = [10,20 / 30,40].
    const png = pngFromFilteredRows({
      width: 2, height: 2, bitDepth: 8, colorType: 0,
      rows: [[0, 10, 20], [0, 30, 40]],
    });
    const dec = decodePng(png);
    expect(dec.width).toBe(2);
    expect(dec.height).toBe(2);
    expect(dec.colorSpace).toEqual({ kind: "DeviceGray" });
    expect(dec.bitsPerComponent).toBe(8);
    expect([...dec.samples]).toEqual([10, 20, 30, 40]);
    expect(dec.smask).toBeNull();
    expect(dec.colorKeyMask).toBeNull();
  });

  it("RGB (colorType 2)", () => {
    const png = pngFromFilteredRows({
      width: 1, height: 2, bitDepth: 8, colorType: 2,
      rows: [[0, 10, 20, 30], [0, 40, 50, 60]],
    });
    const dec = decodePng(png);
    expect(dec.colorSpace).toEqual({ kind: "DeviceRGB" });
    expect([...dec.samples]).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("palette (colorType 3) → Indexed colorspace, index samples", () => {
    const png = pngFromFilteredRows({
      width: 2, height: 1, bitDepth: 8, colorType: 3,
      palette: [255, 0, 0, 0, 255, 0, 0, 0, 255], // 3 entries
      rows: [[0, 2, 0]], // indices 2,0
    });
    const dec = decodePng(png);
    expect(dec.colorSpace).toEqual({ kind: "Indexed", hival: 2, palette: Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255) });
    expect(dec.bitsPerComponent).toBe(8);
    expect([...dec.samples]).toEqual([2, 0]);
    expect(dec.smask).toBeNull();
  });

  it("grayscale+alpha (colorType 4) → DeviceGray samples + DeviceGray SMask", () => {
    // 2x1: pixels (gray,alpha) = (10,200),(20,100)
    const png = pngFromFilteredRows({
      width: 2, height: 1, bitDepth: 8, colorType: 4,
      rows: [[0, 10, 200, 20, 100]],
    });
    const dec = decodePng(png);
    expect(dec.colorSpace).toEqual({ kind: "DeviceGray" });
    expect([...dec.samples]).toEqual([10, 20]);
    expect(dec.smask).not.toBeNull();
    expect(dec.smask?.width).toBe(2);
    expect(dec.smask?.height).toBe(1);
    expect([...(dec.smask?.samples ?? new Uint8Array())]).toEqual([200, 100]);
  });

  it("RGBA (colorType 6) → DeviceRGB samples + DeviceGray SMask", () => {
    // 1x2: (r,g,b,a) = (10,20,30,40),(50,60,70,80)
    const png = pngFromFilteredRows({
      width: 1, height: 2, bitDepth: 8, colorType: 6,
      rows: [[0, 10, 20, 30, 40], [0, 50, 60, 70, 80]],
    });
    const dec = decodePng(png);
    expect(dec.colorSpace).toEqual({ kind: "DeviceRGB" });
    expect([...dec.samples]).toEqual([10, 20, 30, 50, 60, 70]);
    expect([...(dec.smask?.samples ?? new Uint8Array())]).toEqual([40, 80]);
  });
});

describe("decodePng — the 5 scanline filters (raw recovered exactly)", () => {
  // A 1-channel 8-bit (grayscale) image; bpp=1, rowBytes=width. Choose RAW pixels,
  // hand-encode each row with a filter, assert decode recovers RAW.
  // NOTE: all array reads go through `at()` (?? 0) — bare `number[]` indexing is
  // `number | undefined` under noUncheckedIndexedAccess and would break arithmetic.
  const at = (a: readonly number[], i: number): number => a[i] ?? 0;
  const clamp8 = (n: number): number => n & 0xff;
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };

  it("None + Sub + Up recover the raw samples", () => {
    const r0 = [10, 20, 40, 80];   // None
    const r1 = [15, 35, 70, 130];  // Sub
    const r2 = [200, 180, 30, 5];  // Up (over r1)
    const f0 = [0, ...r0];
    const f1: number[] = [1];
    for (let i = 0; i < 4; i++) f1.push(clamp8(at(r1, i) - (i > 0 ? at(r1, i - 1) : 0)));
    const f2: number[] = [2];
    for (let i = 0; i < 4; i++) f2.push(clamp8(at(r2, i) - at(r1, i)));
    const png = buildPng({
      width: 4, height: 3, bitDepth: 8, colorType: 0,
      scanlines: Uint8Array.from([...f0, ...f1, ...f2]),
    });
    expect([...decodePng(png).samples]).toEqual([...r0, ...r1, ...r2]);
  });

  it("first-row Average (b=0 boundary) recovers raw", () => {
    // Average: filtered[i] = raw[i] - floor((left + up)/2); up=0 (first row), left=0 for i=0.
    const raw = [50, 90, 130, 200];
    const filt: number[] = [3];
    for (let i = 0; i < raw.length; i++) {
      const left = i > 0 ? at(raw, i - 1) : 0;
      filt.push(clamp8(at(raw, i) - ((left + 0) >> 1)));
    }
    const png = buildPng({ width: 4, height: 1, bitDepth: 8, colorType: 0, scanlines: Uint8Array.from(filt) });
    expect([...decodePng(png).samples]).toEqual(raw);
  });

  it("first-row Paeth (b=c=0 boundary) recovers raw", () => {
    const raw = [50, 90, 130, 200];
    const filt: number[] = [4];
    for (let i = 0; i < raw.length; i++) {
      const left = i > 0 ? at(raw, i - 1) : 0;
      filt.push(clamp8(at(raw, i) - paeth(left, 0, 0)));
    }
    const png = buildPng({ width: 4, height: 1, bitDepth: 8, colorType: 0, scanlines: Uint8Array.from(filt) });
    expect([...decodePng(png).samples]).toEqual(raw);
  });

  it("multi-row Paeth (full a,b,c) recovers raw", () => {
    const r0 = [10, 20, 40, 80];
    const r1 = [15, 35, 70, 130];
    const f0 = [0, ...r0];
    const f1: number[] = [4];
    for (let i = 0; i < 4; i++) {
      const a = i > 0 ? at(r1, i - 1) : 0;
      const b = at(r0, i);
      const c = i > 0 ? at(r0, i - 1) : 0;
      f1.push(clamp8(at(r1, i) - paeth(a, b, c)));
    }
    const png = buildPng({ width: 4, height: 2, bitDepth: 8, colorType: 0, scanlines: Uint8Array.from([...f0, ...f1]) });
    expect([...decodePng(png).samples]).toEqual([...r0, ...r1]);
  });

  it("multi-row Average (b != 0 — the `up` term) recovers raw", () => {
    // The first-row Average test only exercises b=0; this covers (a+b)>>1 with a
    // REAL up value, so dropping/mis-rounding the `b` term would fail here.
    const r0 = [10, 20, 40, 80];
    const r1 = [15, 35, 70, 130];
    const f0 = [0, ...r0]; // None
    const f1: number[] = [3]; // Average over r0
    for (let i = 0; i < 4; i++) {
      const a = i > 0 ? at(r1, i - 1) : 0;
      const b = at(r0, i);
      f1.push(clamp8(at(r1, i) - ((a + b) >> 1)));
    }
    const png = buildPng({ width: 4, height: 2, bitDepth: 8, colorType: 0, scanlines: Uint8Array.from([...f0, ...f1]) });
    expect([...decodePng(png).samples]).toEqual([...r0, ...r1]);
  });

  it("multi-channel (RGB, bpp=3) Sub + Paeth exercise the i>=bpp left-stride", () => {
    // colorType 2 → bpp=3: the left predictor must reach back 3 bytes (not 1), and
    // a/c must be 0 for the FIRST pixel's 3 bytes. A `i-1` stride bug corrupts every
    // filtered RGB/RGBA PNG yet would pass all single-channel filter tests.
    const r0 = [10, 20, 30, 40, 50, 60]; // 2 px RGB
    const r1 = [15, 25, 35, 45, 55, 65];
    const bpp = 3;
    const f0: number[] = [1]; // Sub
    for (let i = 0; i < 6; i++) f0.push(clamp8(at(r0, i) - (i >= bpp ? at(r0, i - bpp) : 0)));
    const f1: number[] = [4]; // Paeth
    for (let i = 0; i < 6; i++) {
      const a = i >= bpp ? at(r1, i - bpp) : 0;
      const b = at(r0, i);
      const c = i >= bpp ? at(r0, i - bpp) : 0;
      f1.push(clamp8(at(r1, i) - paeth(a, b, c)));
    }
    const png = buildPng({ width: 2, height: 2, bitDepth: 8, colorType: 2, scanlines: Uint8Array.from([...f0, ...f1]) });
    expect([...decodePng(png).samples]).toEqual([...r0, ...r1]);
  });
});

describe("decodePng — sub-byte depth + transparency edges", () => {
  it("4-bit grayscale embeds at native BitsPerComponent (samples = packed bytes)", () => {
    // width=3 @ 4-bit → 12 bits → rowBytes=2 (one pad nibble). pixels 1,2,3 → 0x12,0x30.
    const png = buildPng({
      width: 3, height: 1, bitDepth: 4, colorType: 0,
      scanlines: Uint8Array.of(0, 0x12, 0x30),
    });
    const dec = decodePng(png);
    expect(dec.bitsPerComponent).toBe(4);
    expect(dec.colorSpace).toEqual({ kind: "DeviceGray" });
    expect([...dec.samples]).toEqual([0x12, 0x30]); // packed, row-padded — verbatim
  });

  it("8-bit grayscale tRNS → native-space color-key /Mask [g g]", () => {
    const png = buildPng({
      width: 1, height: 1, bitDepth: 8, colorType: 0,
      trns: Uint8Array.of(0, 200), // 2-byte gray; low byte = 200
      scanlines: Uint8Array.of(0, 123),
    });
    const dec = decodePng(png);
    expect(dec.colorKeyMask).toEqual([200, 200]);
    expect(dec.smask).toBeNull();
  });

  it("4-bit grayscale tRNS → /Mask value is the NATIVE-depth sample (not 8-bit-scaled)", () => {
    const png = buildPng({
      width: 3, height: 1, bitDepth: 4, colorType: 0,
      trns: Uint8Array.of(0, 5), // native gray index 5
      scanlines: Uint8Array.of(0, 0x12, 0x30),
    });
    const dec = decodePng(png);
    expect(dec.colorKeyMask).toEqual([5, 5]); // native, NOT 5*17
  });

  it("8-bit RGB tRNS → /Mask [r r g g b b] from low bytes", () => {
    const png = buildPng({
      width: 1, height: 1, bitDepth: 8, colorType: 2,
      trns: Uint8Array.of(0, 10, 0, 20, 0, 30),
      scanlines: Uint8Array.of(0, 1, 2, 3),
    });
    expect(decodePng(png).colorKeyMask).toEqual([10, 10, 20, 20, 30, 30]);
  });

  it("palette + tRNS → 8-bit DeviceGray SMask from per-index alpha", () => {
    const png = pngFromFilteredRows({
      width: 3, height: 1, bitDepth: 8, colorType: 3,
      palette: [0, 0, 0, 50, 50, 50, 90, 90, 90],
      trns: [10, 20, 30], // alpha per palette entry
      rows: [[0, 0, 1, 2]], // indices 0,1,2
    });
    const dec = decodePng(png);
    expect([...(dec.smask?.samples ?? new Uint8Array())]).toEqual([10, 20, 30]);
    expect(dec.smask?.width).toBe(3);
  });

  it("palette + tRNS SHORTER than PLTE → trailing indices default to opaque (255)", () => {
    const png = pngFromFilteredRows({
      width: 4, height: 1, bitDepth: 8, colorType: 3,
      palette: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3], // 4 entries
      trns: [10, 20], // only 2 alphas; indices 2,3 → opaque
      rows: [[0, 0, 1, 2, 3]],
    });
    expect([...(decodePng(png).smask?.samples ?? new Uint8Array())]).toEqual([10, 20, 255, 255]);
  });

  it("4-bit palette + tRNS with width*bitDepth % 8 != 0 → per-row pad-bit skip in SMask", () => {
    // width=3 @ 4-bit → rowBytes=2 (4 pad bits/row). Two rows of indices.
    // row0 packed: idx 0,1,2 → 0x01,0x20 ; row1 packed: idx 3,0,1 → 0x30,0x10
    const png = buildPng({
      width: 3, height: 2, bitDepth: 4, colorType: 3,
      palette: Uint8Array.of(0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3),
      trns: Uint8Array.of(100, 110, 120, 130), // alpha per index 0..3
      scanlines: Uint8Array.of(0, 0x01, 0x20, 0, 0x30, 0x10),
    });
    const dec = decodePng(png);
    // Expected per-pixel alpha (no drift): row0 idx[0,1,2]→[100,110,120]; row1 idx[3,0,1]→[130,100,110]
    expect([...(dec.smask?.samples ?? new Uint8Array())]).toEqual([100, 110, 120, 130, 100, 110]);
    expect(dec.smask?.width).toBe(3);
    expect(dec.smask?.height).toBe(2);
  });
});

describe("decodePng — length invariant", () => {
  it("throws when inflated length != height*(1+rowBytes) (over-run / under-run)", () => {
    // Build a valid 1x1 grayscale, then re-wrap an IDAT with an EXTRA byte by
    // constructing scanlines too long for the IHDR dims.
    const tooLong = buildPng({
      width: 1, height: 1, bitDepth: 8, colorType: 0,
      scanlines: Uint8Array.of(0, 5, 99), // 1 extra byte beyond (1 filter + 1 sample)
    });
    expect(() => decodePng(tooLong)).toThrow(/length|scanline|invariant/i);
  });
});
