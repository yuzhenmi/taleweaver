import { describe, it, expect } from "vitest";
import { bytesToBase64, base64ToBytes } from "./base64";

describe("base64 codec (runtime-agnostic)", () => {
  it("round-trips arbitrary bytes incl. 0x00/0xFF and non-ASCII-derived bytes", () => {
    const cases = [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array([255, 254, 253, 0, 1, 2]),
      new TextEncoder().encode("héllo — 世界 🌍"),
      Uint8Array.from({ length: 600 }, (_, i) => i % 256),
    ];
    for (const bytes of cases) {
      const round = base64ToBytes(bytesToBase64(bytes));
      expect(round).not.toBeNull();
      expect(Array.from(round as Uint8Array)).toEqual(Array.from(bytes));
    }
  });
  it("produces standard base64 (length multiple of 4, only base64 alphabet)", () => {
    const s = bytesToBase64(new Uint8Array([1, 2, 3, 4, 5]));
    expect(s.length % 4).toBe(0);
    expect(/^[A-Za-z0-9+/]*={0,2}$/.test(s)).toBe(true);
  });
  it("returns null on malformed input, never throws", () => {
    expect(base64ToBytes("not valid !!!")).toBeNull();
    expect(base64ToBytes("=AAA")).toBeNull();
  });
});
