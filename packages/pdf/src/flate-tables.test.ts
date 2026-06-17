import { describe, it, expect } from "vitest";
import {
  buildCanonicalCodes,
  FIXED_LITLEN_LENGTHS,
  FIXED_DIST_LENGTHS,
  LENGTH_BASE,
  LENGTH_EXTRA,
  DIST_BASE,
  DIST_EXTRA,
} from "./flate-tables";

describe("buildCanonicalCodes (RFC 1951 §3.2.2)", () => {
  it("matches the spec's worked example", () => {
    // RFC 1951 §3.2.2 example: lengths [3,3,3,3,3,2,4,4] → codes
    // [010,011,100,101,110,00,1110,1111].
    const codes = buildCanonicalCodes([3, 3, 3, 3, 3, 2, 4, 4]);
    expect(codes).toEqual([0b010, 0b011, 0b100, 0b101, 0b110, 0b00, 0b1110, 0b1111]);
  });
  it("assigns code 0 to a zero-length (absent) symbol", () => {
    expect(buildCanonicalCodes([0, 1, 1])).toEqual([0, 0b0, 0b1]);
  });
});

describe("fixed-Huffman tables (RFC 1951 §3.2.6)", () => {
  it("literal/length lengths: 0–143→8, 144–255→9, 256–279→7, 280–287→8", () => {
    expect(FIXED_LITLEN_LENGTHS.length).toBe(288);
    expect(FIXED_LITLEN_LENGTHS[0]).toBe(8);
    expect(FIXED_LITLEN_LENGTHS[143]).toBe(8);
    expect(FIXED_LITLEN_LENGTHS[144]).toBe(9);
    expect(FIXED_LITLEN_LENGTHS[255]).toBe(9);
    expect(FIXED_LITLEN_LENGTHS[256]).toBe(7);
    expect(FIXED_LITLEN_LENGTHS[279]).toBe(7);
    expect(FIXED_LITLEN_LENGTHS[280]).toBe(8);
    expect(FIXED_LITLEN_LENGTHS[287]).toBe(8);
    // The canonical fixed code for literal 0 is 0x30 (00110000), 8 bits.
    expect(buildCanonicalCodes(FIXED_LITLEN_LENGTHS)[0]).toBe(0x30);
    // literal 65 ('A') → 0x30 + 65 = 0x71.
    expect(buildCanonicalCodes(FIXED_LITLEN_LENGTHS)[65]).toBe(0x71);
    // end-of-block code 256 → 0 (7 bits).
    expect(buildCanonicalCodes(FIXED_LITLEN_LENGTHS)[256]).toBe(0);
  });
  it("distance lengths: all 30 codes are 5 bits", () => {
    expect(FIXED_DIST_LENGTHS.length).toBe(30);
    expect(FIXED_DIST_LENGTHS.every((l) => l === 5)).toBe(true);
  });
});

describe("length/distance base+extra tables (RFC 1951 §3.2.5)", () => {
  it("length code 257 → base 3 / 0 extra; 285 → base 258 / 0 extra; 265 → base 11 / 1 extra", () => {
    expect(LENGTH_BASE[0]).toBe(3); // code 257
    expect(LENGTH_EXTRA[0]).toBe(0);
    expect(LENGTH_BASE[28]).toBe(258); // code 285
    expect(LENGTH_EXTRA[28]).toBe(0);
    expect(LENGTH_BASE[8]).toBe(11); // code 265
    expect(LENGTH_EXTRA[8]).toBe(1);
    expect(LENGTH_BASE.length).toBe(29);
  });
  it("distance code 0 → base 1 / 0 extra; 29 → base 24577 / 13 extra", () => {
    expect(DIST_BASE[0]).toBe(1);
    expect(DIST_EXTRA[0]).toBe(0);
    expect(DIST_BASE[29]).toBe(24577);
    expect(DIST_EXTRA[29]).toBe(13);
    expect(DIST_BASE.length).toBe(30);
  });
});
