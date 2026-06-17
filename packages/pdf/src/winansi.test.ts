import { describe, it, expect } from "vitest";
import { encodeWinAnsi } from "./winansi";

describe("encodeWinAnsi", () => {
  it("encodes ASCII 1:1", () => {
    const { bytes, dropped } = encodeWinAnsi("Hi!");
    expect(Array.from(bytes)).toEqual([0x48, 0x69, 0x21]);
    expect(dropped).toBe(0);
  });

  it("encodes a Latin-1 letter (é = 0xE9 in WinAnsi)", () => {
    const { bytes, dropped } = encodeWinAnsi("é");
    expect(Array.from(bytes)).toEqual([0xe9]);
    expect(dropped).toBe(0);
  });

  it("maps an out-of-range codepoint to '?' and counts it", () => {
    const { bytes, dropped } = encodeWinAnsi("中");
    expect(Array.from(bytes)).toEqual([0x3f]);
    expect(dropped).toBe(1);
  });

  it("maps the 0x80-0x9F smart-punctuation block (NOT dropped)", () => {
    // U+2019 curly apostrophe → 0x92, U+2014 em dash → 0x97, U+201C/D quotes,
    // U+2026 ellipsis → 0x85, U+2022 bullet → 0x95 — all WinAnsi-native.
    const apos = encodeWinAnsi("it’s"); // it’s
    expect(Array.from(apos.bytes)).toEqual([0x69, 0x74, 0x92, 0x73]);
    expect(apos.dropped).toBe(0);

    const dash = encodeWinAnsi("a—b"); // a—b
    expect(Array.from(dash.bytes)).toEqual([0x61, 0x97, 0x62]);
    expect(dash.dropped).toBe(0);

    const mix = encodeWinAnsi("“hi”…"); // “hi”…
    expect(Array.from(mix.bytes)).toEqual([0x93, 0x68, 0x69, 0x94, 0x85]);
    expect(mix.dropped).toBe(0);
  });

  it("counts one drop per astral character (surrogate pair)", () => {
    const { bytes, dropped } = encodeWinAnsi("\u{1F389}"); // 🎉
    expect(Array.from(bytes)).toEqual([0x3f]);
    expect(dropped).toBe(1);
  });
});
