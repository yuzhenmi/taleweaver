import { describe, it, expect } from "vitest";
import { buildTestOtf } from "./test-support/sfnt-builder";
import { parseCff, parseTopDict, readCffIndex } from "./cff-parser";
import { Reader, parseSfnt } from "./truetype-parser";

function locateTable(bytes: Uint8Array, tag: string): { offset: number; length: number } {
  const r = new Reader(bytes);
  const n = r.u16(4);
  for (let i = 0; i < n; i++) {
    const e = 12 + i * 16;
    if (r.tag(e) === tag) return { offset: r.u32(e + 8), length: r.u32(e + 12) };
  }
  throw new Error(`table ${tag} not found`);
}

describe("buildTestOtf fixture", () => {
  it("non-CID-keyed OTF: OTTO version, a `CFF ` table, parseCff says not CID-keyed", () => {
    const otf = buildTestOtf({ numGlyphs: 3, cidKeyed: false });
    expect(new Reader(otf).u32(0)).toBe(0x4f54544f); // OTTO
    const cff = locateTable(otf, "CFF ");
    const info = parseCff(otf, cff.offset, cff.length, 3);
    expect(info.isCidKeyed).toBe(false);
  });
  it("CID-keyed OTF: parseCff builds gidToCid (GID1→CID5…) + ROS", () => {
    const otf = buildTestOtf({ numGlyphs: 3, cidKeyed: true, cidBase: 5, registry: "Adobe", ordering: "Identity" });
    const cff = locateTable(otf, "CFF ");
    const info = parseCff(otf, cff.offset, cff.length, 3);
    expect(info.isCidKeyed).toBe(true);
    expect(info.gidToCid?.get(1)).toBe(5);
    expect(info.gidToCid?.get(2)).toBe(6);
    expect(info.ros).toEqual({ registry: "Adobe", ordering: "Identity", supplement: 0 });
  });
  it("emits an empty Global Subr INDEX immediately after the String INDEX (CFF spec)", () => {
    const otf = buildTestOtf({ numGlyphs: 3, cidKeyed: false });
    const parsed = parseSfnt(otf);
    const cffRec = parsed.tables.get("CFF ");
    if (cffRec === undefined) throw new Error("no CFF table");
    const cff = otf.subarray(cffRec.offset, cffRec.offset + cffRec.length);
    const r = new Reader(cff);
    const hdrSize = r.u8(2);
    const nameIndex = readCffIndex(r, hdrSize);
    const topDictIndex = readCffIndex(r, nameIndex.end);
    const stringIndex = readCffIndex(r, topDictIndex.end);
    const globalSubrIndex = readCffIndex(r, stringIndex.end);
    expect(globalSubrIndex.items.length).toBe(0); // present (2 bytes) but empty
    // It must occupy exactly the 2 bytes between the String INDEX and the
    // Top-DICT-declared charset — i.e. the charset begins right after the Global
    // Subr INDEX, not 2 bytes early (which is what omitting it would cause).
    const top = topDictIndex.items[0];
    if (top === undefined) throw new Error("empty Top DICT INDEX");
    const td = parseTopDict(r, top.offset, top.offset + top.length);
    expect(globalSubrIndex.end).toBe(td.charsetOffset);
  });
});
