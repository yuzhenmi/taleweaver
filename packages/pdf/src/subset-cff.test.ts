import { describe, it, expect } from "vitest";
import { Reader, parseSfnt } from "./truetype-parser";
import { readCffIndex, parseCff } from "./cff-parser";
import {
  decodeDict,
  locateCffStructures,
  charsetLength,
  encodingLength,
  fdselectLength,
  encodeCffIndex,
  rebuildCharStrings,
  subsetCff,
} from "./subset-cff";
import { buildTestOtf } from "./test-support/sfnt-builder";

/** Pull the bare `CFF ` bytes out of a built OTF. */
function cffOf(otf: Uint8Array): Uint8Array {
  const parsed = parseSfnt(otf);
  const rec = parsed.tables.get("CFF ");
  if (rec === undefined) throw new Error("no CFF");
  return otf.subarray(rec.offset, rec.offset + rec.length);
}

describe("decodeDict", () => {
  it("decodes operators with their operands (charset op 15, CharStrings op 17)", () => {
    const dict = Uint8Array.of(28, 0, 100, 15, 28, 0, 200, 17);
    const entries = decodeDict(new Reader(dict), 0, dict.length);
    expect(entries.find((e) => e.op === 15)?.operands).toEqual([100]);
    expect(entries.find((e) => e.op === 17)?.operands).toEqual([200]);
    expect([...(entries.find((e) => e.op === 15)?.operandBytes ?? [])]).toEqual([28, 0, 100]);
  });

  it("decodes escape operators as 1200 + b1 (ROS = 1230)", () => {
    const dict = Uint8Array.of(28, 1, 135, 28, 1, 136, 139, 12, 30);
    const entries = decodeDict(new Reader(dict), 0, dict.length);
    const ros = entries.find((e) => e.op === 1230);
    expect(ros?.operands).toEqual([391, 392, 0]);
  });

  it("preserves a real-number operand's raw bytes verbatim (FontMatrix-style)", () => {
    const dict = Uint8Array.of(30, 0x0a, 0x00, 0x1f, 12, 7);
    const entries = decodeDict(new Reader(dict), 0, dict.length);
    const fm = entries.find((e) => e.op === 1207);
    expect([...(fm?.operandBytes ?? [])]).toEqual([30, 0x0a, 0x00, 0x1f]);
  });
});

describe("locateCffStructures (non-CID-keyed)", () => {
  it("locates charset + CharStrings ranges in a non-CID OTF", () => {
    const cff = cffOf(buildTestOtf({ numGlyphs: 3, cidKeyed: false }));
    const loc = locateCffStructures(cff, 3);
    expect(loc.isCidKeyed).toBe(false);
    expect(loc.charStrings.items.length).toBe(3);
    expect(loc.charset?.length).toBeGreaterThan(0);
    expect(loc.fdArray).toBeUndefined();
  });
});

describe("locateCffStructures (CID-keyed without FDArray)", () => {
  it("throws on a CID-keyed CFF lacking FDArray/FDSelect (real CID fonts always have them)", () => {
    const cff = cffOf(buildTestOtf({ numGlyphs: 3, cidKeyed: true }));
    expect(() => locateCffStructures(cff, 3)).toThrow(/FDArray|FDSelect/);
  });
});

describe("CFF length helpers (byte-math)", () => {
  it("charsetLength format 0", () => {
    // format(0) + (numGlyphs-1) u16 SIDs. numGlyphs=3 → 1 + 2*2 = 5.
    const bytes = Uint8Array.of(0, 0, 1, 0, 2);
    expect(charsetLength(new Reader(bytes), 0, 3)).toBe(5);
  });
  it("charsetLength format 1 (range: first u16 + nLeft u8)", () => {
    // numGlyphs=3, one range first=1 nLeft=1 (covers gid 1,2). len = 1 + 3 = 4.
    const bytes = Uint8Array.of(1, 0, 1, 1);
    expect(charsetLength(new Reader(bytes), 0, 3)).toBe(4);
  });
  it("charsetLength format 2 (range: first u16 + nLeft u16)", () => {
    // numGlyphs=3, one range first=1 nLeft=1. len = 1 + 4 = 5.
    const bytes = Uint8Array.of(2, 0, 1, 0, 1);
    expect(charsetLength(new Reader(bytes), 0, 3)).toBe(5);
  });
  it("encodingLength format 0 (nCodes codes)", () => {
    // format(0) + nCodes(2) + 2 code bytes. len = 2 + 2 = 4.
    const bytes = Uint8Array.of(0, 2, 10, 20);
    expect(encodingLength(new Reader(bytes), 0)).toBe(4);
  });
  it("encodingLength format 1 (nRanges ranges)", () => {
    // format(1) + nRanges(1) + 1 range (2 bytes). len = 2 + 2 = 4.
    const bytes = Uint8Array.of(1, 1, 5, 3);
    expect(encodingLength(new Reader(bytes), 0)).toBe(4);
  });
  it("encodingLength with supplement bit (0x80)", () => {
    // format(0x80): base 0, nCodes=1 → 2+1=3 bytes; then nSups=1 → +1+1*3=4. Total 7.
    const bytes = Uint8Array.of(0x80, 1, 10, 1, 20, 0, 5);
    expect(encodingLength(new Reader(bytes), 0)).toBe(7);
  });
  it("fdselectLength format 0 (one FD index per glyph)", () => {
    // format(0) + numGlyphs bytes. numGlyphs=3 → 1 + 3 = 4.
    const bytes = Uint8Array.of(0, 0, 0, 0);
    expect(fdselectLength(new Reader(bytes), 0, 3)).toBe(4);
  });
  it("fdselectLength format 3 (nRanges + sentinel)", () => {
    // format(3) + nRanges(u16=1) + 1 range(3 bytes) + sentinel(u16). 1+2+3+2 = 8.
    const bytes = Uint8Array.of(3, 0, 1, 0, 0, 0, 0, 3);
    expect(fdselectLength(new Reader(bytes), 0, 3)).toBe(8);
  });
});

describe("encodeCffIndex", () => {
  it("round-trips items through readCffIndex", () => {
    const items = [Uint8Array.of(1, 2, 3), Uint8Array.of(0x0e), Uint8Array.of(9, 9)];
    const bytes = encodeCffIndex(items);
    const idx = readCffIndex(new Reader(bytes), 0);
    expect(idx.items.length).toBe(3);
    const slice = (i: number): number[] => {
      const it = idx.items[i];
      if (it === undefined) throw new Error("missing");
      return [...bytes.subarray(it.offset, it.offset + it.length)];
    };
    expect(slice(0)).toEqual([1, 2, 3]);
    expect(slice(1)).toEqual([0x0e]);
    expect(slice(2)).toEqual([9, 9]);
    expect(idx.end).toBe(bytes.length); // the INDEX occupies the whole buffer
  });

  it("encodes a zero-item INDEX as [0,0]", () => {
    expect([...encodeCffIndex([])]).toEqual([0, 0]);
  });

  it("selects an offSize large enough for the data (>255 bytes ⇒ offSize 2)", () => {
    const big = new Uint8Array(300); // forces a 2-byte offSize
    const bytes = encodeCffIndex([big]);
    const idx = readCffIndex(new Reader(bytes), 0);
    expect(idx.items.length).toBe(1);
    const it = idx.items[0];
    if (it === undefined) throw new Error("missing");
    expect(it.length).toBe(300);
  });
});

describe("rebuildCharStrings", () => {
  it("keeps used charstrings verbatim and replaces unused with a single endchar", () => {
    const cff = cffOf(buildTestOtf({ numGlyphs: 4, cidKeyed: false }));
    const loc = locateCffStructures(cff, 4);
    const items = rebuildCharStrings(cff, loc.charStrings, new Set([1]));
    expect(items.length).toBe(4);
    const unused = items[0];
    const used = items[1];
    if (unused === undefined || used === undefined) throw new Error("missing");
    expect([...unused]).toEqual([0x0e]); // GID 0 unused → endchar
    const orig = loc.charStrings.items[1];
    if (orig === undefined) throw new Error("missing orig");
    expect([...used]).toEqual([...cff.subarray(orig.offset, orig.offset + orig.length)]);
  });
});

describe("subsetCff (full canonical re-emit)", () => {
  it("non-CID: rebuilt CFF re-parses, CharStrings count preserved, unused→endchar, smaller", () => {
    const full = cffOf(buildTestOtf({ numGlyphs: 4, cidKeyed: false }));
    const sub = subsetCff(full, 4, new Set([0, 1]));
    const info = parseCff(sub, 0, sub.length, 4);
    expect(info.isCidKeyed).toBe(false);
    const loc = locateCffStructures(sub, 4);
    const cs = (gid: number): number[] => {
      const it = loc.charStrings.items[gid];
      if (it === undefined) throw new Error("missing");
      return [...sub.subarray(it.offset, it.offset + it.length)];
    };
    expect(cs(2)).toEqual([0x0e]); // unused → endchar
    expect(cs(3)).toEqual([0x0e]); // unused → endchar
    expect(loc.charStrings.items.length).toBe(4); // numbering preserved
  });

  it("CID-keyed WITHOUT FDArray: subsetCff throws (a real CID-keyed CFF always has FDArray/FDSelect)", () => {
    // The minimal cidKeyed fixture carries a ROS but no FDArray/FDSelect — a shape
    // malformed per the CFF spec (CID fonts partition glyphs via FDSelect). The
    // locator rejects it, so subsetCff does too; the valid CID path is exercised by
    // the withFdArray test below.
    const full = cffOf(buildTestOtf({ numGlyphs: 4, cidKeyed: true, cidBase: 10 }));
    expect(() => subsetCff(full, 4, new Set([0, 2]))).toThrow(/FDArray|FDSelect/);
  });

  it("CID-keyed WITH FDArray/FDSelect/Private + FontMatrix: relocates structures, preserves reals", () => {
    const full = cffOf(buildTestOtf({ numGlyphs: 4, cidKeyed: true, cidBase: 10, withFdArray: true }));
    const sub = subsetCff(full, 4, new Set([0, 2]));
    // Re-parse: ROS + charset survive the relocation.
    const info = parseCff(sub, 0, sub.length, 4);
    expect(info.isCidKeyed).toBe(true);
    expect(info.gidToCid?.get(2)).toBe(11);
    // FDArray + FDSelect + per-FD Private are present + re-locatable in the subset.
    const loc = locateCffStructures(sub, 4);
    expect(loc.fdArray?.items.length).toBe(1);
    expect(loc.fdSelect?.length).toBe(1 + 4); // format-0 FDSelect: 1 byte + 1 FD-index per glyph (numGlyphs=4)
    if (loc.fdSelect === undefined) throw new Error("fdSelect missing");
    expect(sub[loc.fdSelect.offset]).toBe(0); // format byte 0 — confirms the slot is at the rewritten offset
    expect(loc.fdPrivates?.length).toBe(1);
    // C1 LOCK: the Top-DICT FontMatrix (real operands) survives byte-for-byte —
    // decode→reencode would have corrupted the reals to integer 0.
    const subFm = loc.topDict.find((e) => e.op === 1207);
    const fullFm = locateCffStructures(full, 4).topDict.find((e) => e.op === 1207);
    expect(subFm).toBeDefined();
    expect([...(subFm?.operandBytes ?? [])]).toEqual([...(fullFm?.operandBytes ?? [])]);
  });

  it("produces a strictly smaller CFF than the full table for a sparse subset", () => {
    const full = cffOf(buildTestOtf({ numGlyphs: 8, cidKeyed: false }));
    const sub = subsetCff(full, 8, new Set([0, 1]));
    expect(sub.length).toBeLessThan(full.length);
  });

  it("non-CID WITH a top-level Private DICT: relocates the Private + rewrites op-18", () => {
    const full = cffOf(buildTestOtf({ numGlyphs: 4, cidKeyed: false, withTopPrivate: true }));
    const sub = subsetCff(full, 4, new Set([1]));
    const info = parseCff(sub, 0, sub.length, 4);
    expect(info.isCidKeyed).toBe(false);
    const loc = locateCffStructures(sub, 4);
    // The Private DICT was relocated and its op-18 offset rewritten to a decodable position.
    expect(loc.topPrivate).toBeDefined();
    expect(loc.topPrivate?.size).toBe(4);
    // numbering preserved + unused glyphs zeroed to endchar.
    expect(loc.charStrings.items.length).toBe(4);
  });
});
