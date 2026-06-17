import { describe, it, expect } from "vitest";
import { inflate } from "./inflate";
import {
  b64ToBytes,
  LOREM,
  backrefsPlaintext,
  NATURAL,
  BACKREFS,
  SKEWED,
} from "./test-support/inflate-fixtures";
import { adler32 } from "./zlib";

const DEC = new TextDecoder();

describe("inflate — stored blocks", () => {
  it("decodes a single final stored block", () => {
    // BFINAL=1, BTYPE=00 → first byte 0x01; align; LEN=3 (u16 LE), NLEN=~3, "abc".
    const data = Uint8Array.of(0x01, 0x03, 0x00, 0xfc, 0xff, 0x61, 0x62, 0x63);
    expect(DEC.decode(inflate(data))).toBe("abc");
  });
  it("decodes multiple stored blocks (BFINAL only on the last)", () => {
    // block1: BFINAL=0 BTYPE=00 (0x00), LEN=1,NLEN=~1, "x"; block2: BFINAL=1 ... "y".
    const data = Uint8Array.of(
      0x00, 0x01, 0x00, 0xfe, 0xff, 0x78,
      0x01, 0x01, 0x00, 0xfe, 0xff, 0x79,
    );
    expect(DEC.decode(inflate(data))).toBe("xy");
  });
});

describe("inflate — loud failure", () => {
  it("throws on a stored block with a bad NLEN (≠ ~LEN)", () => {
    const data = Uint8Array.of(0x01, 0x03, 0x00, 0x00, 0x00, 0x61, 0x62, 0x63);
    expect(() => inflate(data)).toThrow(/NLEN/i);
  });
  it("throws on the reserved block type (BTYPE=11)", () => {
    expect(() => inflate(Uint8Array.of(0b111))).toThrow(/reserved|BTYPE/i);
  });
  it("throws on a truncated stream", () => {
    // A final stored block claiming LEN=10 but with no payload bytes.
    expect(() => inflate(Uint8Array.of(0x01, 0x0a, 0x00, 0xf5, 0xff))).toThrow(/past the end|truncat/i);
  });
});

const ENCC = new TextEncoder();

describe("inflate — dynamic-Huffman blocks (RFC 1951 §3.2.7)", () => {
  it("decodes a natural-text dynamic stream byte-identically (LOREM x8)", () => {
    const out = inflate(b64ToBytes(NATURAL.rawB64));
    expect(out.length).toBe(NATURAL.plainLen);
    expect([...out]).toEqual([...ENCC.encode(LOREM.repeat(8))]);
  });

  it("decodes a heavily back-referenced dynamic stream byte-identically", () => {
    const out = inflate(b64ToBytes(BACKREFS.rawB64));
    expect(out.length).toBe(BACKREFS.plainLen);
    expect([...out]).toEqual([...ENCC.encode(backrefsPlaintext())]);
  });

  it("decodes a large skewed dynamic stream (length + Adler-32 known-answer)", () => {
    // 3000 bytes over a 12-symbol alphabet → many absent litlen symbols
    // (exercises the 17/18 zero-run repeat codes) + a large table build.
    const out = inflate(b64ToBytes(SKEWED.rawB64));
    expect(out.length).toBe(SKEWED.plainLen);
    expect(adler32(out)).toBe(SKEWED.adler32);
  });
});

describe("inflate — dynamic-Huffman loud failure", () => {
  it("throws when a dynamic stream is truncated mid-DECODE (no silent garbage)", () => {
    // 10 bytes: the full header parses, then the symbol/back-ref decode runs the
    // BitReader off the end → throws. Exercises the decode-loop underflow path.
    const truncated = b64ToBytes(NATURAL.rawB64).subarray(0, 10);
    expect(() => inflate(truncated)).toThrow(/past the end|truncat|inflate/i);
  });

  it("throws when a dynamic stream is truncated mid-HEADER (no silent garbage)", () => {
    // 3 bytes = 24 bits: enough for BFINAL+BTYPE(3) + HLIT(5)+HDIST(5)+HCLEN(4)=17
    // bits, but NOT the HCLEN*3 (>=12) code-length-code-length bits that follow →
    // readDynamicTables runs the BitReader off the end → guaranteed throw. Probes
    // the dynamic-HEADER parse's loud-failure specifically (distinct from above).
    const truncated = b64ToBytes(NATURAL.rawB64).subarray(0, 3);
    expect(() => inflate(truncated)).toThrow(/past the end|truncat|inflate/i);
  });
});
