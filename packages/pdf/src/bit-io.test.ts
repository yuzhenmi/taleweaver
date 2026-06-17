import { describe, it, expect } from "vitest";
import { BitWriter, BitReader } from "./bit-io";

describe("BitWriter / BitReader", () => {
  it("round-trips mixed-width LSB-first bit fields", () => {
    const w = new BitWriter();
    w.writeBits(0b1, 1);
    w.writeBits(0b01, 2);     // value 1 in 2 bits
    w.writeBits(0b1011, 4);
    w.writeBits(0x1ff, 9);
    const bytes = w.finish();
    const r = new BitReader(bytes);
    expect(r.readBits(1)).toBe(0b1);
    expect(r.readBits(2)).toBe(0b01);
    expect(r.readBits(4)).toBe(0b1011);
    expect(r.readBits(9)).toBe(0x1ff);
  });

  it("writeHuffman packs the code MSB-first (the DEFLATE Huffman bit order)", () => {
    // A 3-bit code 0b110 must be emitted high-bit-first: bits 1,1,0 into the
    // LSB-first stream → readBit() yields 1, then 1, then 0.
    const w = new BitWriter();
    w.writeHuffman(0b110, 3);
    const r = new BitReader(w.finish());
    expect(r.readBit()).toBe(1);
    expect(r.readBit()).toBe(1);
    expect(r.readBit()).toBe(0);
  });

  it("alignToByte + takeBytes copies byte-aligned raw bytes (stored-block path)", () => {
    const w = new BitWriter();
    w.writeBits(0b101, 3);  // a partial byte
    w.alignToByte();        // pad to the byte boundary
    const out = w.finish();
    // Append two raw bytes after the aligned partial byte for the reader test.
    const buf = new Uint8Array([...out, 0xAB, 0xCD]);
    const r = new BitReader(buf);
    expect(r.readBits(3)).toBe(0b101);
    r.alignToByte();
    expect([...r.takeBytes(2)]).toEqual([0xAB, 0xCD]);
  });

  it("BitReader throws on a read past the end of input (truncation)", () => {
    const r = new BitReader(Uint8Array.of(0x00));
    r.readBits(8);
    expect(() => r.readBits(1)).toThrow(/past the end|truncat/i);
  });
});
