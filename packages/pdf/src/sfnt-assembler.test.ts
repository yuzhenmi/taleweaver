import { describe, it, expect } from "vitest";
import { assembleSfnt } from "./sfnt-assembler";
import { parseSfnt } from "./truetype-parser";
import { buildTestSfnt } from "./test-support/sfnt-builder";

describe("assembleSfnt", () => {
  it("produces a parseable sfnt: directory offsets/lengths address 4-byte-aligned bodies", () => {
    const src = buildTestSfnt({
      unitsPerEm: 1000,
      numGlyphs: 3,
      hMetrics: [{ advanceWidth: 500, lsb: 0 }],
      numberOfHMetrics: 1,
      ascender: 800,
      descender: -200,
      xMin: 0,
      yMin: -200,
      xMax: 500,
      yMax: 800,
      macStyle: 0,
    });
    const srcParsed = parseSfnt(src);
    const tables = [...srcParsed.tables.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([tag, rec]) => ({ tag, body: src.subarray(rec.offset, rec.offset + rec.length) }));

    const out = assembleSfnt(0x00010000, tables);
    const parsed = parseSfnt(out);
    expect(parsed.numGlyphs).toBe(3);
    expect(parsed.unitsPerEm).toBe(1000);
    expect(parsed.advanceOf(0)).toBe(500);
  });

  it("pads an odd-length body to a 4-byte boundary without corrupting the next table", () => {
    const odd = Uint8Array.of(1, 2, 3); // length 3 → must pad to 4
    const next = Uint8Array.of(9, 9, 9, 9);
    const out = assembleSfnt(0x00010000, [
      { tag: "AAAA", body: odd },
      { tag: "BBBB", body: next },
    ]);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const numTables = view.getUint16(4);
    expect(numTables).toBe(2);
    let bOffset = -1;
    let bLength = -1;
    for (let i = 0; i < numTables; i++) {
      const entry = 12 + i * 16;
      const tag = String.fromCharCode(
        view.getUint8(entry),
        view.getUint8(entry + 1),
        view.getUint8(entry + 2),
        view.getUint8(entry + 3),
      );
      if (tag === "BBBB") {
        bOffset = view.getUint32(entry + 8);
        bLength = view.getUint32(entry + 12);
      }
    }
    expect(bOffset % 4).toBe(0);
    expect(bLength).toBe(4);
    expect([...out.subarray(bOffset, bOffset + 4)]).toEqual([9, 9, 9, 9]);
  });
});
