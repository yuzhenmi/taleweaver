import { describe, it, expect } from "vitest";
import { parsePng } from "./png-parser";
import { MalformedImageError } from "./image-errors";
import { buildPng } from "./test-support/png-fixtures";

// A 2x1 8-bit RGB image, two None-filtered rows... actually 2x1 = one row of 2 px.
// rowBytes = ceil(24*2/8) = 6. One row: filter byte 0 + 6 bytes.
const RGB_2x1 = buildPng({
  width: 2, height: 1, bitDepth: 8, colorType: 2,
  scanlines: Uint8Array.of(0, 10, 20, 30, 40, 50, 60),
});

describe("parsePng — IHDR + chunks", () => {
  it("parses width/height/bitDepth/colorType + concatenated IDAT", () => {
    const c = parsePng(RGB_2x1);
    expect(c.width).toBe(2);
    expect(c.height).toBe(1);
    expect(c.bitDepth).toBe(8);
    expect(c.colorType).toBe(2);
    expect(c.interlace).toBe(0);
    expect(c.palette).toBeNull();
    expect(c.trns).toBeNull();
    expect(c.idat.length).toBeGreaterThan(0);
  });

  it("collects PLTE + tRNS for a palette image", () => {
    const png = buildPng({
      width: 1, height: 1, bitDepth: 8, colorType: 3,
      palette: Uint8Array.of(255, 0, 0, 0, 255, 0), // 2 entries
      trns: Uint8Array.of(128),
      scanlines: Uint8Array.of(0, 1), // filter 0 + index byte (entry 1)
    });
    const c = parsePng(png);
    expect(c.colorType).toBe(3);
    expect(c.palette).not.toBeNull();
    expect([...(c.palette ?? new Uint8Array())]).toEqual([255, 0, 0, 0, 255, 0]);
    expect([...(c.trns ?? new Uint8Array())]).toEqual([128]);
  });

  it("concatenates the data of 2 consecutive IDAT chunks byte-for-byte into one stream", () => {
    // Same scanlines as RGB_2x1, but the zlib stream is split across 2 IDAT chunks.
    // The parser must reassemble the identical bytes the single-IDAT build produced.
    const single = parsePng(RGB_2x1).idat;
    const split = parsePng(
      buildPng({
        width: 2, height: 1, bitDepth: 8, colorType: 2,
        scanlines: Uint8Array.of(0, 10, 20, 30, 40, 50, 60),
        splitIdatInto: 2,
      }),
    ).idat;
    expect(single.length).toBeGreaterThan(8); // the stream actually spanned 2 non-trivial chunks
    expect([...split]).toEqual([...single]); // concatenation is byte-identical
  });
});

describe("parsePng — loud rejects (MalformedImageError)", () => {
  it("throws on a bad signature", () => {
    const bad = RGB_2x1.slice();
    bad[1] = 0x00; // corrupt the signature
    expect(() => parsePng(bad)).toThrow(MalformedImageError);
  });

  it("throws on 16-bit depth", () => {
    const png = buildPng({
      width: 1, height: 1, bitDepth: 16, colorType: 0,
      scanlines: Uint8Array.of(0, 0, 0), // filter 0 + 2 bytes (16-bit gray)
    });
    expect(() => parsePng(png)).toThrow(/16-bit/i);
    expect(() => parsePng(png)).toThrow(MalformedImageError);
  });

  it("throws on interlace=1 (Adam7)", () => {
    const png = buildPng({
      width: 1, height: 1, bitDepth: 8, colorType: 0, interlace: 1,
      scanlines: Uint8Array.of(0, 0),
    });
    expect(() => parsePng(png)).toThrow(/interlac/i);
    expect(() => parsePng(png)).toThrow(MalformedImageError);
  });

  it("throws on tRNS present for colorType 6 (RGBA)", () => {
    const png = buildPng({
      width: 1, height: 1, bitDepth: 8, colorType: 6,
      trns: Uint8Array.of(0, 0, 0, 0, 0, 0),
      scanlines: Uint8Array.of(0, 0, 0, 0, 0), // filter 0 + RGBA
    });
    expect(() => parsePng(png)).toThrow(/tRNS/i);
    expect(() => parsePng(png)).toThrow(MalformedImageError);
  });

  it("throws on a colorType/bitDepth combo not in the table (colorType 2 @ 4-bit)", () => {
    const png = buildPng({
      width: 1, height: 1, bitDepth: 4, colorType: 2,
      scanlines: Uint8Array.of(0, 0, 0),
    });
    expect(() => parsePng(png)).toThrow(MalformedImageError);
  });

  it("throws on missing PLTE for colorType 3", () => {
    const png = buildPng({
      width: 1, height: 1, bitDepth: 8, colorType: 3,
      scanlines: Uint8Array.of(0, 0),
    });
    expect(() => parsePng(png)).toThrow(/PLTE|palette/i);
    expect(() => parsePng(png)).toThrow(MalformedImageError);
  });

  it("throws on a chunk whose declared length runs past the end", () => {
    // Inflate the IDAT chunk's length field (u32 BE at bytes 33..36, value 15)
    // to a value far larger than the buffer → dataEnd+4 > bytes.length fires the
    // "chunk … runs past end (truncated)" guard. Fixture-size-independent.
    const bad = RGB_2x1.slice();
    bad[34] = 0xff; // length becomes 0x00FF000F ≫ buffer size
    expect(() => parsePng(bad)).toThrow(/past end|truncat/i);
    expect(() => parsePng(bad)).toThrow(MalformedImageError);
  });

  it("throws when there is no IDAT data (exercises the `no IDAT data` guard)", () => {
    // Corrupt the IDAT chunk TYPE to "aDAT" (a private ancillary chunk, which the
    // parser skips). IEND is still seen, so this hits the `idatParts.length === 0
    // → "png: no IDAT data"` guard (NOT the `!sawIend && length===0` truncated
    // guard). The IDAT type's 4 bytes start at offset 37: 8 (sig) + 4 (IHDR len)
    // + 4 (IHDR type) + 13 (IHDR data) + 4 (IHDR crc) + 4 (next-chunk len) = 37.
    const bad = RGB_2x1.slice();
    bad[37] = 0x61; // 'I' (0x49) → 'a' (0x61): "IDAT" becomes "aDAT"
    expect(() => parsePng(bad)).toThrow(/IDAT/i);
    expect(() => parsePng(bad)).toThrow(MalformedImageError);
  });
});
