import { describe, it, expect } from "vitest";
import { adler32, zlibCompress, zlibDecompress } from "./zlib";
import { b64ToBytes, LOREM, NATURAL } from "./test-support/inflate-fixtures";

const ENC = new TextEncoder();

describe("adler32", () => {
  it("matches known vectors (RFC 1950 §9)", () => {
    expect(adler32(new Uint8Array(0))).toBe(1); // empty → 1
    expect(adler32(ENC.encode("a"))).toBe(0x00620062);
    expect(adler32(ENC.encode("abc"))).toBe(0x024d0127);
    expect(adler32(ENC.encode("Wikipedia"))).toBe(0x11e60398);
  });

  it("handles a long input without overflow (the % 65521 reduction)", () => {
    const big = new Uint8Array(10000).fill(0xff);
    const v = adler32(big);
    expect(v).toBeGreaterThan(0);
    expect(Number.isInteger(v)).toBe(true);
    expect(v >>> 0).toBe(v); // a valid uint32
  });
});

describe("zlib wrapper (RFC 1950)", () => {
  it("round-trips through zlibCompress / zlibDecompress", () => {
    const x = ENC.encode("ABAB".repeat(500));
    const z = zlibCompress(x);
    expect([...zlibDecompress(z)]).toEqual([...x]);
  });
  it("emits the standard 2-byte header (0x78 0x9c)", () => {
    const z = zlibCompress(ENC.encode("hello"));
    expect(z[0]).toBe(0x78);
    expect(z[1]).toBe(0x9c);
  });
  it("throws on a corrupted Adler-32 trailer", () => {
    const z = zlibCompress(ENC.encode("hello"));
    const last = z.length - 1;
    z[last] = (z[last] ?? 0) ^ 0xff; // corrupt the last checksum byte
    expect(() => zlibDecompress(z)).toThrow(/adler|checksum/i);
  });
  it("throws on a bad zlib header (CM ≠ 8)", () => {
    const z = zlibCompress(ENC.encode("hello"));
    z[0] = 0x70; // CM = 0 (not deflate)
    expect(() => zlibDecompress(z)).toThrow(/header|method/i);
  });
});

describe("zlibDecompress — real dynamic-Huffman zlib stream", () => {
  it("decompresses a standard-compressor zlib stream (RFC 1950 wrapper + dynamic DEFLATE)", () => {
    // NATURAL.zlibB64 is Node zlib's output (0x78 0x9c header + dynamic-Huffman
    // body + Adler-32) — proves the package can now read any standard zlib
    // stream end-to-end (header check + dynamic inflate + Adler-32 verify).
    const out = zlibDecompress(b64ToBytes(NATURAL.zlibB64));
    expect(out.length).toBe(NATURAL.plainLen);
    expect([...out]).toEqual([...new TextEncoder().encode(LOREM.repeat(8))]);
  });
});
