import { describe, it, expect } from "vitest";
import { subsetGlyf } from "./subset-glyf";
import { parseSfnt } from "./truetype-parser";
import {
  buildTestSfnt,
  buildSimpleGlyph,
  buildCompositeGlyph,
  buildTruncatedComposite,
  buildGlyfAndLoca,
  type BuildTestSfntOpts,
} from "./test-support/sfnt-builder";

/** Build a glyf-flavoured sfnt carrying `glyphs` (index = GID) + matching loca. */
function sfntWithGlyphs(glyphs: readonly Uint8Array[], longLoca: boolean): Uint8Array {
  const { glyf, loca } = buildGlyfAndLoca(glyphs, longLoca);
  const opts: BuildTestSfntOpts = {
    unitsPerEm: 1000,
    numGlyphs: glyphs.length,
    hMetrics: [{ advanceWidth: 500, lsb: 0 }],
    numberOfHMetrics: 1,
    ascender: 800,
    descender: -200,
    xMin: 0,
    yMin: -200,
    xMax: 500,
    yMax: 800,
    macStyle: 0,
    indexToLocFormat: longLoca ? 1 : 0,
    extraTables: [
      { tag: "loca", body: loca },
      { tag: "glyf", body: glyf },
    ],
  };
  return buildTestSfnt(opts);
}

/** Read per-GID glyph byte length from a subset sfnt's loca (0 = zeroed outline). */
function glyphLengths(sfnt: Uint8Array): number[] {
  const parsed = parseSfnt(sfnt);
  const loca = parsed.tables.get("loca");
  if (loca === undefined) throw new Error("no loca");
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const long = parsed.indexToLocFormat === 1;
  const n = parsed.numGlyphs;
  const off = (i: number): number =>
    long ? view.getUint32(loca.offset + i * 4) : view.getUint16(loca.offset + i * 2) * 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(off(i + 1) - off(i));
  return out;
}

/** Read a single GID's glyph bytes from a sfnt's glyf table via its loca extent. */
function glyphBytes(sfnt: Uint8Array, gid: number): Uint8Array {
  const parsed = parseSfnt(sfnt);
  const loca = parsed.tables.get("loca");
  const glyf = parsed.tables.get("glyf");
  if (loca === undefined || glyf === undefined) throw new Error("no glyf/loca");
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const long = parsed.indexToLocFormat === 1;
  const off = (i: number): number =>
    long ? view.getUint32(loca.offset + i * 4) : view.getUint16(loca.offset + i * 2) * 2;
  return sfnt.subarray(glyf.offset + off(gid), glyf.offset + off(gid + 1));
}

describe("subsetGlyf", () => {
  it("keeps used glyph outlines and zeroes unused ones (short loca)", () => {
    const glyphs = [buildSimpleGlyph(), buildSimpleGlyph(), buildSimpleGlyph(), buildSimpleGlyph()];
    const sfnt = sfntWithGlyphs(glyphs, false);
    const parsed = parseSfnt(sfnt);
    const out = subsetGlyf(sfnt, parsed.tables, parsed.indexToLocFormat, parsed.numGlyphs, new Set([1, 2]));
    const lens = glyphLengths(out);
    expect(lens[0]).toBe(0);
    expect(lens[1]).toBeGreaterThan(0);
    expect(lens[2]).toBeGreaterThan(0);
    expect(lens[3]).toBe(0);
    expect(parseSfnt(out).numGlyphs).toBe(4);
    expect(out.length).toBeLessThan(sfnt.length);
    // Kept glyph BODY bytes survive byte-identically (not just the right length).
    expect([...glyphBytes(out, 1)]).toEqual([...glyphBytes(sfnt, 1)]);
    expect([...glyphBytes(out, 2)]).toEqual([...glyphBytes(sfnt, 2)]);
  });

  it.each([false, true])("composite closure (one level) keeps a referenced component (longLoca=%s)", (longLoca) => {
    const glyphs = [
      buildSimpleGlyph(), buildSimpleGlyph(), buildCompositeGlyph(5),
      buildSimpleGlyph(), buildSimpleGlyph(), buildSimpleGlyph(),
    ];
    const sfnt = sfntWithGlyphs(glyphs, longLoca);
    const parsed = parseSfnt(sfnt);
    const out = subsetGlyf(sfnt, parsed.tables, parsed.indexToLocFormat, parsed.numGlyphs, new Set([2]));
    const lens = glyphLengths(out);
    expect(lens[2]).toBeGreaterThan(0);
    expect(lens[5]).toBeGreaterThan(0);
    expect(lens[1]).toBe(0);
  });

  it("composite closure (transitive depth-2): A→B→C all kept", () => {
    const glyphs = [
      buildSimpleGlyph(), buildCompositeGlyph(2), buildCompositeGlyph(3), buildSimpleGlyph(),
    ];
    const sfnt = sfntWithGlyphs(glyphs, false);
    const parsed = parseSfnt(sfnt);
    const out = subsetGlyf(sfnt, parsed.tables, parsed.indexToLocFormat, parsed.numGlyphs, new Set([1]));
    const lens = glyphLengths(out);
    expect(lens[1]).toBeGreaterThan(0);
    expect(lens[2]).toBeGreaterThan(0);
    expect(lens[3]).toBeGreaterThan(0);
  });

  it("throws on a glyf-format sfnt missing loca/glyf", () => {
    const sfnt = buildTestSfnt({
      unitsPerEm: 1000, numGlyphs: 2,
      hMetrics: [{ advanceWidth: 500, lsb: 0 }], numberOfHMetrics: 1,
      ascender: 800, descender: -200, xMin: 0, yMin: 0, xMax: 500, yMax: 800, macStyle: 0,
    });
    const parsed = parseSfnt(sfnt);
    expect(() =>
      subsetGlyf(sfnt, parsed.tables, parsed.indexToLocFormat, parsed.numGlyphs, new Set([0])),
    ).toThrow(/loca|glyf/);
  });

  it("throws on a malformed composite whose component record overruns its loca extent", () => {
    const glyphs = [buildSimpleGlyph(), buildTruncatedComposite(0)];
    const sfnt = sfntWithGlyphs(glyphs, false);
    const parsed = parseSfnt(sfnt);
    expect(() =>
      subsetGlyf(sfnt, parsed.tables, parsed.indexToLocFormat, parsed.numGlyphs, new Set([1])),
    ).toThrow(/overruns/);
  });

  it("long-loca path round-trips and zeroes unused outlines", () => {
    const glyphs = [buildSimpleGlyph(), buildSimpleGlyph(), buildSimpleGlyph()];
    const sfnt = sfntWithGlyphs(glyphs, true);
    const parsed = parseSfnt(sfnt);
    expect(parsed.indexToLocFormat).toBe(1);
    const out = subsetGlyf(sfnt, parsed.tables, parsed.indexToLocFormat, parsed.numGlyphs, new Set([1]));
    const lens = glyphLengths(out);
    expect(lens[1]).toBeGreaterThan(0);
    expect(lens[0]).toBe(0);
    expect(lens[2]).toBe(0);
  });
});
