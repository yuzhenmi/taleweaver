import { describe, expect, it } from "vitest";

import type { CompositeFontDescriptor } from "./composite-font";
import { MalformedFontError, parseSfnt } from "./truetype-parser";
import {
  buildTestSfnt,
  buildTestOtf,
  buildCmapTable,
  buildCmapFormat4,
  buildCmapFormat12,
  buildOs2,
  buildPost,
  buildName,
  utf16be,
  ascii,
  type BuildTestSfntOpts,
  type Fmt4Segment,
} from "./test-support/sfnt-builder";

const BASE_OPTS: BuildTestSfntOpts = {
  unitsPerEm: 1000,
  numGlyphs: 5,
  hMetrics: [
    { advanceWidth: 600, lsb: 50 },
    { advanceWidth: 1200, lsb: 0 },
  ],
  numberOfHMetrics: 2,
  ascender: 800,
  descender: -200,
  xMin: -50,
  yMin: -200,
  xMax: 1000,
  yMax: 900,
  macStyle: 0,
};

describe("parseSfnt — core (head/hhea/maxp/hmtx)", () => {
  it("parses head/maxp scalars and exposes the head bbox", () => {
    const font = parseSfnt(buildTestSfnt(BASE_OPTS));
    expect(font.unitsPerEm).toBe(1000);
    expect(font.numGlyphs).toBe(5);
    expect(font.bbox).toEqual([-50, -200, 1000, 900]);
    expect(font.macStyle).toBe(0);
    expect(font.indexToLocFormat).toBe(0);
  });

  it("reads the hhea ascender/descender", () => {
    const font = parseSfnt(buildTestSfnt(BASE_OPTS));
    expect(font.ascender).toBe(800);
    expect(font.descender).toBe(-200);
  });

  it("reads explicit hmtx advances", () => {
    const font = parseSfnt(buildTestSfnt(BASE_OPTS));
    expect(font.advanceOf(0)).toBe(600);
    expect(font.advanceOf(1)).toBe(1200);
  });

  it("applies the hmtx tail-repeat rule for gid >= numberOfHMetrics", () => {
    const font = parseSfnt(buildTestSfnt(BASE_OPTS));
    // numberOfHMetrics is 2; gid 4 repeats the LAST explicit advance (1200).
    expect(font.advanceOf(4)).toBe(1200);
  });

  it("exposes the raw bytes and the table directory for later tasks", () => {
    const bytes = buildTestSfnt(BASE_OPTS);
    const font = parseSfnt(bytes);
    expect(font.bytes).toBe(bytes);
    expect(font.tables.has("head")).toBe(true);
    expect(font.tables.has("hmtx")).toBe(true);
    const head = font.tables.get("head");
    expect(head?.length).toBe(54);
  });

  it("throws when an OTTO (OpenType-CFF) font is missing the `CFF ` table", () => {
    // OTTO sfnt version but no `CFF ` table (buildTestSfnt emits only head/hhea/
    // maxp/hmtx) → the CFF branch's requireTable('CFF ') throws.
    const otto = buildTestSfnt({ ...BASE_OPTS, sfntVersion: 0x4f54544f });
    expect(() => parseSfnt(otto)).toThrow(/CFF/);
  });

  it("throws MalformedFontError on an unknown sfnt version", () => {
    const bad = buildTestSfnt({ ...BASE_OPTS, sfntVersion: 0xdeadbeef });
    expect(() => parseSfnt(bad)).toThrow(MalformedFontError);
  });

  it("throws MalformedFontError on a truncated font buffer", () => {
    // 30 bytes truncates mid-directory; the Reader throws on the second entry read.
    const bytes = buildTestSfnt(BASE_OPTS);
    expect(() => parseSfnt(bytes.subarray(0, 30))).toThrow(MalformedFontError);
  });

  it("throws MalformedFontError when numberOfHMetrics is 0", () => {
    // numberOfHMetrics 0 would make advanceOf index advances[-1]; guarded as malformed.
    expect(() =>
      parseSfnt(buildTestSfnt({ ...BASE_OPTS, numberOfHMetrics: 0, hMetrics: [] })),
    ).toThrow(MalformedFontError);
  });
});

describe("parseSfnt — cmap lookup", () => {
  it("(a) resolves a format-4 (3,1) subtable via the idDelta path", () => {
    // 'A'(0x41)→36 needs idDelta = 36 - 0x41 = -29; 'Z'(0x5a)→61 needs
    // idDelta = 61 - 0x5a = -29 (same delta, so one [0x41,0x5a] segment works).
    const sub = buildCmapFormat4([
      { startCode: 0x41, endCode: 0x5a, idDelta: -29, idRangeOffset: 0 },
      { startCode: 0xffff, endCode: 0xffff, idDelta: 1, idRangeOffset: 0 },
    ]);
    const cmap = buildCmapTable([{ platformID: 3, encodingID: 1, subtable: sub }]);
    const font = parseSfnt(buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "cmap", body: cmap }] }));
    expect(font.cmapLookup(0x41)).toBe(36);
    expect(font.cmapLookup(0x5a)).toBe(61);
    // 0x20 is below the first mapped segment → .notdef.
    expect(font.cmapLookup(0x20)).toBe(0);
  });

  it("(a2) resolves a format-4 segment via the idRangeOffset!=0 glyphIdArray path", () => {
    // Two real segments + terminator. Segment 0 = [0x41,0x5a] via idDelta (from (a)).
    // Segment 1 = [0x61,0x63] via glyphIdArray: 'a'→68, 'b'→69, 'c'→hole(0).
    // segCount = 3. idRangeOffset for segment 1 (index 1) addresses, in BYTES,
    // from &idRangeOffset[1]: the array starts (segCount - 1) entries past it,
    // so idRangeOffset = (segCount - 1) * 2 = 4 to land glyphIdArray[0] at 'a'.
    const segments: Fmt4Segment[] = [
      { startCode: 0x41, endCode: 0x5a, idDelta: -29, idRangeOffset: 0 },
      { startCode: 0x61, endCode: 0x63, idDelta: 0, idRangeOffset: 4 },
      { startCode: 0xffff, endCode: 0xffff, idDelta: 1, idRangeOffset: 0 },
    ];
    // glyphIdArray: [68 (a), 69 (b), 0 (c → hole)].
    const sub = buildCmapFormat4(segments, [68, 69, 0]);
    const cmap = buildCmapTable([{ platformID: 3, encodingID: 1, subtable: sub }]);
    const font = parseSfnt(buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "cmap", body: cmap }] }));
    expect(font.cmapLookup(0x61)).toBe(68);
    expect(font.cmapLookup(0x62)).toBe(69);
    // In-range but glyphIdArray entry 0 → .notdef (NOT idDelta-shifted).
    expect(font.cmapLookup(0x63)).toBe(0);
    // The idDelta segment still resolves alongside the glyphIdArray segment.
    expect(font.cmapLookup(0x41)).toBe(36);
  });

  it("(b) resolves an astral codepoint via a format-12 (3,10) subtable", () => {
    const sub = buildCmapFormat12([
      { startCharCode: 0x1f600, endCharCode: 0x1f600, startGlyphID: 200 },
    ]);
    const cmap = buildCmapTable([{ platformID: 3, encodingID: 10, subtable: sub }]);
    const font = parseSfnt(buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "cmap", body: cmap }] }));
    expect(font.cmapLookup(0x1f600)).toBe(200);
    // Outside the single group → .notdef.
    expect(font.cmapLookup(0x1f601)).toBe(0);
  });

  it("(b2) prefers the (3,10) format-12 subtable over a (3,1) format-4 subtable", () => {
    // Both subtables map 0x41, to DIFFERENT gids: fmt4 → 36, fmt12 → 999.
    // The parser must prefer fmt12, so 0x41 resolves to 999.
    const fmt4 = buildCmapFormat4([
      { startCode: 0x41, endCode: 0x41, idDelta: -29, idRangeOffset: 0 },
      { startCode: 0xffff, endCode: 0xffff, idDelta: 1, idRangeOffset: 0 },
    ]);
    const fmt12 = buildCmapFormat12([
      { startCharCode: 0x41, endCharCode: 0x41, startGlyphID: 999 },
    ]);
    const cmap = buildCmapTable([
      { platformID: 3, encodingID: 1, subtable: fmt4 },
      { platformID: 3, encodingID: 10, subtable: fmt12 },
    ]);
    const font = parseSfnt(buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "cmap", body: cmap }] }));
    expect(font.cmapLookup(0x41)).toBe(999);
  });

  it("(c) cmapLookup throws on an unsupported subtable format (e.g. 6)", () => {
    // A selectable (3,1) subtable whose format is 6 (trimmed table mapping) —
    // unsupported in c.2a. The parser defers the throw to lookup time, so
    // cmapLookup must surface the "not supported" error rather than silently 0.
    const fmt6 = new Uint8Array(10);
    new DataView(fmt6.buffer).setUint16(0, 6); // format 6 (rest unread by the parser)
    const cmap = buildCmapTable([{ platformID: 3, encodingID: 1, subtable: fmt6 }]);
    const font = parseSfnt(
      buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "cmap", body: cmap }] }),
    );
    expect(() => font.cmapLookup(0x41)).toThrow(/cmap format 6 not supported/);
  });

  it("(d) throws MalformedFontError when a subtable's arrays run past the buffer", () => {
    // A format-4 subtable whose declared segCountX2 claims far more segments
    // than the body actually contains, so the parser's array reads overrun.
    const sub = buildCmapFormat4([
      { startCode: 0x41, endCode: 0x41, idDelta: -29, idRangeOffset: 0 },
      { startCode: 0xffff, endCode: 0xffff, idDelta: 1, idRangeOffset: 0 },
    ]);
    // segCountX2 lives at offset 6 in a format-4 subtable; claim a huge count.
    new DataView(sub.buffer).setUint16(6, 0xfffe);
    const cmap = buildCmapTable([{ platformID: 3, encodingID: 1, subtable: sub }]);
    const font = parseSfnt(buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "cmap", body: cmap }] }));
    // The over-claimed endCode/start arrays read past the buffer → malformed.
    expect(() => font.cmapLookup(0x41)).toThrow(MalformedFontError);
  });
});

describe("parseSfnt — FontDescriptor derivation", () => {
  it("scales the head bbox into 1000-em space (round(u * 1000 / unitsPerEm))", () => {
    const font = parseSfnt(
      buildTestSfnt({
        ...BASE_OPTS,
        unitsPerEm: 2048,
        xMin: -100,
        yMin: -512,
        xMax: 2000,
        yMax: 1800,
      }),
    );
    // -100*1000/2048 = -48.83 → -49 ; 2000*1000/2048 = 976.56 → 977.
    expect(font.descriptor.fontBBox[0]).toBe(-49);
    expect(font.descriptor.fontBBox[2]).toBe(977);
    // -512*1000/2048 = -250 ; 1800*1000/2048 = 878.9 → 879.
    expect(font.descriptor.fontBBox[1]).toBe(-250);
    expect(font.descriptor.fontBBox[3]).toBe(879);
  });

  it("uses OS/2 sCapHeight (scaled) for capHeight when version >= 2", () => {
    const os2 = buildOs2({ version: 3, sCapHeight: 1400 });
    const font = parseSfnt(
      buildTestSfnt({
        ...BASE_OPTS,
        unitsPerEm: 2048,
        extraTables: [{ tag: "OS/2", body: os2 }],
      }),
    );
    // 1400*1000/2048 = 683.6 → 684.
    expect(font.descriptor.capHeight).toBe(684);
  });

  it("falls back capHeight to ascent when OS/2 version < 2 (no sCapHeight field)", () => {
    // v1 OS/2 body is too short to define sCapHeight; the parser must NOT read @88.
    const os2 = buildOs2({ version: 1 });
    const font = parseSfnt(
      buildTestSfnt({
        ...BASE_OPTS,
        ascender: 800,
        extraTables: [{ tag: "OS/2", body: os2 }],
      }),
    );
    // No sCapHeight → capHeight equals ascent (= scaled hhea.ascender = 800 @ 1000-em).
    expect(font.descriptor.capHeight).toBe(800);
    expect(font.descriptor.capHeight).toBe(font.descriptor.ascent);
  });

  it("honors USE_TYPO_METRICS (fsSelection 0x80) on a version-4 OS/2 → uses sTypoAscender", () => {
    const os2 = buildOs2({
      version: 4,
      fsSelection: 0x80,
      sTypoAscender: 750,
      sTypoDescender: -250,
    });
    const font = parseSfnt(
      buildTestSfnt({
        ...BASE_OPTS,
        ascender: 800,
        descender: -200,
        extraTables: [{ tag: "OS/2", body: os2 }],
      }),
    );
    // USE_TYPO_METRICS set → ascent/descent come from sTypo* (scaled, 1000-em).
    expect(font.descriptor.ascent).toBe(750);
    expect(font.descriptor.descent).toBe(-250);
  });

  it("ignores typo metrics when USE_TYPO_METRICS is clear → uses hhea ascender/descender", () => {
    const os2 = buildOs2({
      version: 4,
      fsSelection: 0,
      sTypoAscender: 750,
      sTypoDescender: -250,
    });
    const font = parseSfnt(
      buildTestSfnt({
        ...BASE_OPTS,
        ascender: 800,
        descender: -200,
        extraTables: [{ tag: "OS/2", body: os2 }],
      }),
    );
    expect(font.descriptor.ascent).toBe(800);
    expect(font.descriptor.descent).toBe(-200);
  });

  it("honors USE_TYPO_METRICS on version 2 (guard is >= 2, NOT >= 4)", () => {
    const os2 = buildOs2({
      version: 2,
      fsSelection: 0x80,
      sTypoAscender: 760,
      sTypoDescender: -240,
    });
    const font = parseSfnt(
      buildTestSfnt({
        ...BASE_OPTS,
        ascender: 800,
        descender: -200,
        extraTables: [{ tag: "OS/2", body: os2 }],
      }),
    );
    expect(font.descriptor.ascent).toBe(760);
    expect(font.descriptor.descent).toBe(-240);
  });

  it("honors USE_TYPO_METRICS on version 3 (guard is >= 2, NOT >= 4)", () => {
    const os2 = buildOs2({
      version: 3,
      fsSelection: 0x80,
      sTypoAscender: 770,
      sTypoDescender: -230,
    });
    const font = parseSfnt(
      buildTestSfnt({
        ...BASE_OPTS,
        ascender: 800,
        descender: -200,
        extraTables: [{ tag: "OS/2", body: os2 }],
      }),
    );
    expect(font.descriptor.ascent).toBe(770);
    expect(font.descriptor.descent).toBe(-230);
  });

  it("falls back to hhea metrics when USE_TYPO_METRICS is set but OS/2 version < 2", () => {
    // v1 → sTypo* not reliably meaningful; the bit is ignored.
    const os2 = buildOs2({
      version: 1,
      fsSelection: 0x80,
      sTypoAscender: 750,
      sTypoDescender: -250,
    });
    const font = parseSfnt(
      buildTestSfnt({
        ...BASE_OPTS,
        ascender: 800,
        descender: -200,
        extraTables: [{ tag: "OS/2", body: os2 }],
      }),
    );
    expect(font.descriptor.ascent).toBe(800);
    expect(font.descriptor.descent).toBe(-200);
  });

  it("sets the FixedPitch flag (0x1) when post.isFixedPitch != 0", () => {
    const post = buildPost({ isFixedPitch: 1 });
    const font = parseSfnt(
      buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "post", body: post }] }),
    );
    expect(font.descriptor.flags & 0x1).toBe(0x1);
  });

  it("sets the ForceBold flag (0x40000) when usWeightClass >= 700", () => {
    const os2 = buildOs2({ version: 4, usWeightClass: 700 });
    const font = parseSfnt(
      buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "OS/2", body: os2 }] }),
    );
    expect(font.descriptor.flags & 0x40000).toBe(0x40000);
  });

  it("always sets the Nonsymbolic flag (0x20)", () => {
    const font = parseSfnt(buildTestSfnt(BASE_OPTS));
    expect(font.descriptor.flags & 0x20).toBe(0x20);
  });

  it("sets the Italic flag (0x40) when head.macStyle italic bit (0x2) is set", () => {
    const font = parseSfnt(buildTestSfnt({ ...BASE_OPTS, macStyle: 0x2 }));
    expect(font.descriptor.flags & 0x40).toBe(0x40);
  });

  it("reads italicAngle from post (Fixed16.16 degrees)", () => {
    const post = buildPost({ italicAngle: -12 });
    const font = parseSfnt(
      buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "post", body: post }] }),
    );
    expect(font.descriptor.italicAngle).toBe(-12);
  });

  it("defaults italicAngle to 0 when post is absent", () => {
    const font = parseSfnt(buildTestSfnt(BASE_OPTS));
    expect(font.descriptor.italicAngle).toBe(0);
  });

  it("decodes the PostScript name (nameID 6) from a platform (3,1) UTF-16BE record", () => {
    const name = buildName([
      { platformID: 3, encodingID: 1, languageID: 0x409, nameID: 6, bytes: utf16be("TestFont") },
    ]);
    const font = parseSfnt(
      buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "name", body: name }] }),
    );
    expect(font.descriptor.fontName).toBe("TestFont");
  });

  it("falls back to a platform (1,0) ASCII nameID-6 record when no (3,1) record exists", () => {
    const name = buildName([
      { platformID: 1, encodingID: 0, languageID: 0, nameID: 6, bytes: ascii("MacName") },
    ]);
    const font = parseSfnt(
      buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "name", body: name }] }),
    );
    expect(font.descriptor.fontName).toBe("MacName");
  });

  it("prefers the (3,1) UTF-16BE nameID-6 record over a (1,0) ASCII one", () => {
    const name = buildName([
      { platformID: 1, encodingID: 0, languageID: 0, nameID: 6, bytes: ascii("MacName") },
      { platformID: 3, encodingID: 1, languageID: 0x409, nameID: 6, bytes: utf16be("WinName") },
    ]);
    const font = parseSfnt(
      buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "name", body: name }] }),
    );
    expect(font.descriptor.fontName).toBe("WinName");
  });

  it("synthesizes a stable fallback fontName when no name table / nameID 6 exists", () => {
    const font = parseSfnt(buildTestSfnt(BASE_OPTS));
    expect(font.descriptor.fontName).toMatch(/^Font-/);
  });

  it("produces a descriptor structurally assignable to CompositeFontDescriptor", () => {
    const font = parseSfnt(buildTestSfnt(BASE_OPTS));
    // Compile-time + runtime check: the descriptor flows into the composite-font
    // writer (writeCompositeFontObjects) without a shim.
    const cfd: CompositeFontDescriptor = font.descriptor;
    expect(cfd.fontName).toBe(font.descriptor.fontName);
    expect(cfd.fontBBox).toEqual(font.descriptor.fontBBox);
  });

  it("derives a positive stemV approximation from usWeightClass", () => {
    const os2 = buildOs2({ version: 4, usWeightClass: 700 });
    const font = parseSfnt(
      buildTestSfnt({ ...BASE_OPTS, extraTables: [{ tag: "OS/2", body: os2 }] }),
    );
    // 50 + (700 - 400) / 4 = 125.
    expect(font.descriptor.stemV).toBe(125);
    expect(font.descriptor.stemV).toBeGreaterThanOrEqual(0);
  });
});

describe("parseSfnt — OpenType-CFF", () => {
  it("parses an OTTO font to glyphFormat 'cff' with non-CID-keyed CffInfo", () => {
    const p = parseSfnt(buildTestOtf({ numGlyphs: 3, cidKeyed: false }));
    expect(p.glyphFormat).toBe("cff");
    expect(p.cff?.isCidKeyed).toBe(false);
    expect(p.numGlyphs).toBe(3);
    expect(p.descriptor.fontName.length).toBeGreaterThan(0); // metrics path reused
  });

  it("parses a CID-keyed OTTO font: gidToCid + ros present", () => {
    const p = parseSfnt(buildTestOtf({ numGlyphs: 3, cidKeyed: true, cidBase: 5 }));
    expect(p.cff?.isCidKeyed).toBe(true);
    expect(p.cff?.gidToCid?.get(1)).toBe(5);
    expect(p.cff?.ros?.ordering).toBe("Identity");
  });

  it("a glyf font still parses to glyphFormat 'glyf' with no cff", () => {
    const p = parseSfnt(buildTestSfnt(BASE_OPTS));
    expect(p.glyphFormat).toBe("glyf");
    expect(p.cff).toBeUndefined();
  });

  it("an OTTO font missing the `CFF ` table throws", () => {
    // buildTestSfnt with sfntVersion OTTO but NO `CFF ` table → requireTable('CFF ')
    // throws (buildTestSfnt emits only head/hhea/maxp/hmtx).
    expect(() =>
      parseSfnt(buildTestSfnt({ ...BASE_OPTS, sfntVersion: 0x4f54544f })),
    ).toThrow(/CFF/);
  });
});
