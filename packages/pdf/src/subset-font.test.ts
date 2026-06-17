import { describe, it, expect } from "vitest";
import { subsetFont, subsetTag } from "./subset-font";
import { parseSfnt } from "./truetype-parser";
import { parseCff } from "./cff-parser";
import {
  buildTestOtf,
  buildTestSfnt,
  buildSimpleGlyph,
  buildGlyfAndLoca,
  type BuildTestSfntOpts,
} from "./test-support/sfnt-builder";

describe("subsetTag", () => {
  it("is a deterministic 6-uppercase-letter tag for a given used-GID set", () => {
    const a = subsetTag(new Set([0, 1, 5]));
    const b = subsetTag(new Set([5, 1, 0])); // order-independent
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Z]{6}$/);
  });

  it("differs for different used-GID sets (very likely)", () => {
    expect(subsetTag(new Set([0, 1]))).not.toBe(subsetTag(new Set([0, 2])));
  });
});

describe("subsetFont", () => {
  it("dispatches CFF fonts to subsetCff (rebuilt CFF re-parses, smaller)", () => {
    const otf = buildTestOtf({ numGlyphs: 4, cidKeyed: false });
    const parsed = parseSfnt(otf);
    const out = subsetFont(parsed, new Set([0, 1]));
    // CFF path returns the BARE CFF bytes; re-parse them directly.
    const info = parseCff(out, 0, out.length, 4);
    expect(info.isCidKeyed).toBe(false);
    expect(out.length).toBeLessThan(parsed.cff?.programBytes.length ?? Infinity);
  });

  it("dispatches glyf fonts to subsetGlyf (rebuilt sfnt re-parses, numbering preserved)", () => {
    const { glyf, loca } = buildGlyfAndLoca([buildSimpleGlyph(), buildSimpleGlyph(), buildSimpleGlyph()], false);
    const opts: BuildTestSfntOpts = {
      unitsPerEm: 1000, numGlyphs: 3,
      hMetrics: [{ advanceWidth: 500, lsb: 0 }], numberOfHMetrics: 1,
      ascender: 800, descender: -200, xMin: 0, yMin: -200, xMax: 500, yMax: 800, macStyle: 0,
      indexToLocFormat: 0,
      extraTables: [{ tag: "loca", body: loca }, { tag: "glyf", body: glyf }],
    };
    const parsed = parseSfnt(buildTestSfnt(opts));
    const out = subsetFont(parsed, new Set([1]));
    expect(parseSfnt(out).numGlyphs).toBe(3);
  });
});
