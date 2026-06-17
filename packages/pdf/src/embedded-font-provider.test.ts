import { describe, it, expect } from "vitest";
import type { ComputedStyle } from "@taleweaver/core";
import type { PageBox, TextRunBox } from "@taleweaver/print";
import { emitPdf } from "./emit-pdf";
import { parsePdf } from "./pdf-parse";
import { PdfWriter } from "./pdf-writer";
import { createEmbeddedFontProvider } from "./embedded-font-provider";
import { parseSfnt } from "./truetype-parser";
import { parseCff } from "./cff-parser";
import {
  buildTestSfnt,
  buildTestOtf,
  buildCmapTable,
  buildCmapFormat4,
  buildCmapFormat12,
  buildName,
  buildGlyfAndLoca,
  buildSimpleGlyph,
  utf16be,
  type BuildTestSfntOpts,
  type CmapEncoding,
} from "./test-support/sfnt-builder";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * Build a synthesized `glyf` TrueType whose cmap maps `'A'` (U+0041) → gid 36
 * (advance 600) and the astral U+1F600 → gid 200 (advance 1000), unitsPerEm
 * 1000, post name "TestFam-Regular". The two real-advance gids are placed at
 * explicit hmtx indices (numberOfHMetrics 201 so gid 36 and gid 200 are both
 * explicit), the rest defaulting via tail-repeat.
 */
function buildTestFontBytes(): Uint8Array {
  // A single format-12 (3,10) UCS-4 subtable maps BOTH 'A'(0x41)→gid 36 and the
  // astral U+1F600→gid 200. (The parser PREFERS the (3,10) fmt12 subtable, so a
  // separate (3,1) fmt4 for 'A' would be shadowed — fmt12 must cover both.)
  const fmt12 = buildCmapFormat12([
    { startCharCode: 0x41, endCharCode: 0x41, startGlyphID: 36 },
    { startCharCode: 0x1f600, endCharCode: 0x1f600, startGlyphID: 200 },
  ]);
  const cmap = buildCmapTable([{ platformID: 3, encodingID: 10, subtable: fmt12 }]);
  const name = buildName([
    { platformID: 3, encodingID: 1, languageID: 0x409, nameID: 6, bytes: utf16be("TestFam-Regular") },
  ]);
  // hmtx: gid 0..200 explicit; gid 36 → advance 600, gid 200 → advance 1000,
  // others a filler advance. numberOfHMetrics = 201 so both target gids are
  // explicit (no tail-repeat ambiguity).
  const numberOfHMetrics = 201;
  const hMetrics = Array.from({ length: numberOfHMetrics }, (_, gid) => {
    if (gid === 36) return { advanceWidth: 600, lsb: 0 };
    if (gid === 200) return { advanceWidth: 1000, lsb: 0 };
    return { advanceWidth: 500, lsb: 0 };
  });
  // glyf + loca for all 201 glyphs (each a minimal SIMPLE glyph). Subsetting to
  // GIDs {0, 36, 200} zeroes the other 198 outlines → the FontFile2 program is
  // measurably smaller than the full sfnt (the subset assertions below rely on it).
  const { glyf, loca } = buildGlyfAndLoca(
    Array.from({ length: 201 }, () => buildSimpleGlyph()),
    false,
  );
  const opts: BuildTestSfntOpts = {
    unitsPerEm: 1000,
    numGlyphs: 201,
    hMetrics,
    numberOfHMetrics,
    ascender: 800,
    descender: -200,
    xMin: -50,
    yMin: -200,
    xMax: 1000,
    yMax: 900,
    macStyle: 0,
    extraTables: [
      { tag: "cmap", body: cmap },
      { tag: "name", body: name },
      { tag: "loca", body: loca },
      { tag: "glyf", body: glyf },
    ],
  };
  return buildTestSfnt(opts);
}

function cs(fontFamily: string): ComputedStyle {
  return {
    fontSize: 12,
    color: "#000000",
    fontFamily,
    fontWeight: 400,
    fontStyle: "normal",
  } as unknown as ComputedStyle;
}

function run(text: string, x: number, y: number, fontFamily: string): TextRunBox {
  return {
    type: "text-run",
    text,
    x,
    y,
    width: text.length * 8,
    height: 16,
    clusterWidths: Array.from(text, () => 8),
    computedStyle: cs(fontFamily),
  } as unknown as TextRunBox;
}

function page(children: unknown[]): PageBox {
  return {
    type: "page",
    width: 200,
    height: 100,
    children,
    headerSlot: null,
    footerSlot: null,
    footnoteSlot: null,
  } as unknown as PageBox;
}

function type0Objects(pdf: ReturnType<typeof parsePdf>): { id: number; body: string }[] {
  const out: { id: number; body: string }[] = [];
  for (let id = 1; id <= pdf.objectCount; id++) {
    const body = pdf.object(id);
    if (body !== null && /\/Subtype\s*\/Type0\b/.test(body)) {
      out.push({ id, body });
    }
  }
  return out;
}

function refIn(body: string, key: string): number | null {
  const m = body.match(new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`));
  return m === null ? null : Number(m[1]);
}

function refInArray(body: string, key: string): number | null {
  const m = body.match(new RegExp(`/${key}\\s*\\[(\\d+)\\s+0\\s+R\\]`));
  return m === null ? null : Number(m[1]);
}

function pageContentText(pdf: ReturnType<typeof parsePdf>): string {
  const pages = pdf.pageBodies();
  expect(pages).toHaveLength(1);
  const contentsId = refIn(nth(pages, 0, "page body"), "Contents");
  expect(contentsId).not.toBeNull();
  if (contentsId === null) throw new Error("unreachable");
  const stream = pdf.streamObject(contentsId);
  expect(stream).not.toBeNull();
  if (stream === null) throw new Error("unreachable");
  return new TextDecoder("latin1").decode(stream.payload);
}

function tjHex(content: string): string[] {
  return [...content.matchAll(/<([0-9a-fA-F]+)> Tj/g)].map((m) => nth(m, 1, "Tj hex").toUpperCase());
}

describe("createEmbeddedFontProvider — resolveFont + encodeRun", () => {
  it("resolves a parsed family to an embedded handle (baseFont = post name, fontKey = family)", () => {
    const ttf = buildTestFontBytes();
    const p = createEmbeddedFontProvider({ fonts: { TestFam: ttf } });
    const handle = p.resolveFont(cs("TestFam"));
    expect(handle.kind).toBe("embedded");
    expect(handle.fontKey).toBe("TestFam");
    expect(handle.baseFont).toBe("TestFam-Regular");
  });

  it("delegates an unknown family to the std-14 fallback (standard14 handle)", () => {
    const ttf = buildTestFontBytes();
    const p = createEmbeddedFontProvider({ fonts: { TestFam: ttf } });
    const handle = p.resolveFont(cs("Arial"));
    expect(handle.kind).toBe("standard14");
    expect(handle.baseFont).toBe("Helvetica");
  });

  it("encodeRun maps codepoints to 2-byte big-endian GIDs via the font cmap", () => {
    const ttf = buildTestFontBytes();
    const p = createEmbeddedFontProvider({ fonts: { TestFam: ttf } });
    const handle = p.resolveFont(cs("TestFam"));
    const enc = p.encodeRun(handle, "A");
    expect(enc.dropped).toBe(0);
    expect(enc.clusters).toHaveLength(1);
    // gid 36 → 0x0024 big-endian.
    const cluster = nth(enc.clusters, 0, "cluster");
    expect([...cluster.bytes]).toEqual([0x00, 0x24]);
    expect(cluster.unicode).toBe("A");
  });

  it("encodeRun handles an astral codepoint as a single cluster (gid 200 → 0x00C8)", () => {
    const ttf = buildTestFontBytes();
    const p = createEmbeddedFontProvider({ fonts: { TestFam: ttf } });
    const handle = p.resolveFont(cs("TestFam"));
    const astral = String.fromCodePoint(0x1f600);
    const enc = p.encodeRun(handle, astral);
    expect(enc.clusters).toHaveLength(1);
    // gid 200 → 0x00C8 big-endian.
    const cluster = nth(enc.clusters, 0, "cluster");
    expect([...cluster.bytes]).toEqual([0x00, 0xc8]);
    expect(cluster.unicode).toBe(astral);
  });

  it("encodeRun delegates a std-14 handle to the fallback (WinAnsi single-byte)", () => {
    const ttf = buildTestFontBytes();
    const p = createEmbeddedFontProvider({ fonts: { TestFam: ttf } });
    const handle = p.resolveFont(cs("Arial"));
    const enc = p.encodeRun(handle, "A");
    // WinAnsi 'A' = 0x41 single byte.
    expect([...nth(enc.clusters, 0, "cluster").bytes]).toEqual([0x41]);
  });
});

describe("createEmbeddedFontProvider — emitPdf integration", () => {
  it("emits a Type0/CIDFontType2 graph with a SUBSET FontFile2, subset-tagged /BaseFont, /W, ToUnicode", () => {
    const ttf = buildTestFontBytes();
    const p = createEmbeddedFontProvider({ fonts: { TestFam: ttf } });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("A", 10, 20, "TestFam")]),
      fontProvider: p,
    });
    const pdf = parsePdf(bytes);

    const t0s = type0Objects(pdf);
    expect(t0s).toHaveLength(1);
    const t0 = nth(t0s, 0, "Type0 object").body;
    expect(t0).toContain("/Subtype /Type0");
    expect(t0).toContain("/Encoding /Identity-H");
    // BaseFont = subset-tagged post name (PDF §9.6.4 `XXXXXX+` prefix on the post name).
    expect(t0).toMatch(/\/BaseFont \/[A-Z]{6}\+TestFam-Regular\b/);

    // CIDFontType2 descendant: /W carries cid 36 → 600 (the hmtx advance @ 1000-em).
    const descId = refInArray(t0, "DescendantFonts");
    expect(descId).not.toBeNull();
    if (descId === null) throw new Error("unreachable");
    const desc = pdf.object(descId) ?? "";
    expect(desc).toContain("/Subtype /CIDFontType2");
    expect(desc).toMatch(/\/W \[[^\n]*\b36 \[600\]/);
    // The descendant /BaseFont carries the SAME subset tag.
    expect(desc).toMatch(/\/BaseFont \/[A-Z]{6}\+TestFam-Regular\b/);

    // FontDescriptor → FontFile2 stream is the SUBSET program, not the full sfnt:
    // it re-parses (numGlyphs preserved) and is strictly smaller than the full font.
    const fdId = refIn(desc, "FontDescriptor");
    expect(fdId).not.toBeNull();
    if (fdId === null) throw new Error("unreachable");
    const fd = pdf.object(fdId) ?? "";
    // The FontDescriptor /FontName carries the subset tag too.
    expect(fd).toMatch(/\/FontName \/[A-Z]{6}\+TestFam-Regular\b/);
    const ffId = refIn(fd, "FontFile2");
    expect(ffId).not.toBeNull();
    if (ffId === null) throw new Error("unreachable");
    const ff = pdf.streamObject(ffId);
    expect(ff).not.toBeNull();
    const ffPayload = ff?.payload ?? new Uint8Array();
    expect(parseSfnt(ffPayload).numGlyphs).toBe(201);
    expect(ffPayload.length).toBeLessThan(ttf.length);

    // ToUnicode maps cid 36 (0x0024) → "A" (U+0041).
    const tuId = refIn(t0, "ToUnicode");
    expect(tuId).not.toBeNull();
    if (tuId === null) throw new Error("unreachable");
    const tu = pdf.streamObject(tuId);
    expect(tu).not.toBeNull();
    const tuText = new TextDecoder("latin1").decode(tu?.payload ?? new Uint8Array());
    expect(tuText).toContain("<0024> <0041>");
  });

  it("emits the 2-byte GID verbatim into the page content stream", () => {
    const ttf = buildTestFontBytes();
    const p = createEmbeddedFontProvider({ fonts: { TestFam: ttf } });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("A", 10, 20, "TestFam")]),
      fontProvider: p,
    });
    const pdf = parsePdf(bytes);
    const content = pageContentText(pdf);
    // 'A' → gid 36 (0x0024) big-endian.
    expect(tjHex(content)).toEqual(["0024"]);
  });

  it("coexists with std-14: a TestFam run + an Arial run → one Type0 + one Type1", () => {
    const ttf = buildTestFontBytes();
    const p = createEmbeddedFontProvider({ fonts: { TestFam: ttf } });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("A", 10, 20, "TestFam"), run("S", 10, 40, "Arial")]),
      fontProvider: p,
    });
    const pdf = parsePdf(bytes);
    expect(type0Objects(pdf)).toHaveLength(1);
    expect(pdf.raw).toMatch(/\/Subtype \/Type1 \/BaseFont \/Helvetica /);
  });

  it("only emits the USED gids in /W (not all numGlyphs)", () => {
    const ttf = buildTestFontBytes();
    const p = createEmbeddedFontProvider({ fonts: { TestFam: ttf } });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("A", 10, 20, "TestFam")]),
      fontProvider: p,
    });
    const pdf = parsePdf(bytes);
    const t0 = nth(type0Objects(pdf), 0, "Type0 object").body;
    const descId = refInArray(t0, "DescendantFonts");
    if (descId === null) throw new Error("unreachable");
    const desc = pdf.object(descId) ?? "";
    // The /W array is the last key in the CIDFont dict: `… /W [ 36 [600] ] >>`.
    // Capture its inner body up to the dict-closing ` ] >>` (the per-cid entries
    // themselves contain `[w]` brackets, so a `[^\]]*` capture would truncate).
    const wMatch = desc.match(/\/W \[ (.*) \] >>/);
    expect(wMatch).not.toBeNull();
    // Only gid 36 was encoded → a single per-cid `36 [600]` entry, no others.
    const entries = (wMatch?.[1] ?? "").match(/\d+ \[\d+\]/g) ?? [];
    expect(entries).toEqual(["36 [600]"]);
  });
});

// A (3,1) format-4 cmap mapping 'A' (U+0041) → GID 1. idDelta math:
// (0x41 + 0xFFC0) & 0xFFFF === 0x10001 & 0xFFFF === 1 ✓.
function cmapAtoGid1(): readonly CmapEncoding[] {
  return [
    {
      platformID: 3,
      encodingID: 1,
      subtable: buildCmapFormat4([
        { startCode: 0x41, endCode: 0x41, idDelta: 0xffc0, idRangeOffset: 0 },
        { endCode: 0xffff, startCode: 0xffff, idDelta: 1, idRangeOffset: 0 },
      ]),
    },
  ];
}

/**
 * Write the composite-font graph for a single handle straight through a
 * {@link PdfWriter} (bypassing emitPdf's page machinery) and return the parsed
 * PDF plus the Type0 root id, so the /W + ToUnicode legs can be read off the
 * embedded object graph. A bare /Catalog root keeps `finish` happy.
 */
function writeFontGraph(
  provider: ReturnType<typeof createEmbeddedFontProvider>,
  handle: ReturnType<ReturnType<typeof createEmbeddedFontProvider>["resolveFont"]>,
): { pdf: ReturnType<typeof parsePdf>; t0Id: number } {
  const writer = new PdfWriter();
  const ids = provider.writeFontObjects([handle], writer);
  const t0Id = ids.get(handle);
  if (t0Id === undefined) throw new Error("expected a Type0 object id for the handle");
  const rootId = writer.allocate();
  writer.writeObject(rootId, "<< /Type /Catalog >>");
  return { pdf: parsePdf(writer.finish(rootId)), t0Id };
}

describe("createEmbeddedFontProvider — OpenType-CFF embedding (the CID 3-leg invariant)", () => {
  it("CID-keyed CFF: emits the CID (not the GID); /W + ToUnicode keyed by CID", () => {
    // numGlyphs 3, CID-keyed, cidBase 5 → GID 1 maps to CID 5 via the charset.
    // withFdArray makes the CFF subsettable (FDArray/FDSelect/Private + FontMatrix)
    // WITHOUT changing the ROS / charset / CID invariant.
    const otf = buildTestOtf({ numGlyphs: 3, cidKeyed: true, cidBase: 5, cmap: cmapAtoGid1(), withFdArray: true });
    const provider = createEmbeddedFontProvider({ fonts: { Test: otf } });
    const handle = provider.resolveFont(cs("Test"));
    const enc = provider.encodeRun(handle, "A"); // 'A' → GID 1 → CID 5

    // LEG 1 (the emitted code): the 2-byte content code is the CID (5), NOT the GID (1).
    expect([...nth(enc.clusters, 0, "cluster").bytes]).toEqual([0x00, 0x05]);
    expect(nth(enc.clusters, 0, "cluster").unicode).toBe("A");

    const { pdf, t0Id } = writeFontGraph(provider, handle);
    const t0 = pdf.object(t0Id) ?? "";
    expect(t0).toContain("/Subtype /Type0");
    expect(t0).toContain("/Encoding /Identity-H");
    // /BaseFont carries the subset tag (PDF §9.6.4) prefixing the post name.
    expect(t0).toMatch(/\/BaseFont \/[A-Z]{6}\+TestCFF\b/);

    // The descendant must be a CIDFontType0 (CFF), with /W keyed by the CID (5),
    // never the GID (1). hmtx advance 500 @ unitsPerEm 1000 → 500 in 1000-em.
    const descId = refInArray(t0, "DescendantFonts");
    if (descId === null) throw new Error("unreachable: no DescendantFonts ref");
    const desc = pdf.object(descId) ?? "";
    expect(desc).toContain("/Subtype /CIDFontType0");
    // LEG 2 (the /W widths map): keyed by CID 5, and there is no GID-1 entry.
    const wMatch = desc.match(/\/W \[ (.*) \] >>/);
    const wEntries = (wMatch?.[1] ?? "").match(/\d+ \[\d+\]/g) ?? [];
    expect(wEntries).toEqual(["5 [500]"]);
    // The font's own ROS (registry/ordering) flows into /CIDSystemInfo.
    expect(desc).toMatch(/\/CIDSystemInfo << \/Registry \(Adobe\) \/Ordering \(Identity\) \/Supplement 0 >>/);

    // LEG 3 (the ToUnicode CMap): src CID 0x0005 → dst 'A' (U+0041 = 0x0041).
    const tuId = refIn(t0, "ToUnicode");
    if (tuId === null) throw new Error("unreachable: no ToUnicode ref");
    const tu = pdf.streamObject(tuId);
    expect(tu).not.toBeNull();
    const tuText = new TextDecoder("latin1").decode(tu?.payload ?? new Uint8Array());
    expect(tuText).toContain("<0005> <0041>");

    // FontDescriptor embeds the bare SUBSET CFF program via FontFile3 /CIDFontType0C.
    const fdId = refIn(desc, "FontDescriptor");
    if (fdId === null) throw new Error("unreachable: no FontDescriptor ref");
    const fd = pdf.object(fdId) ?? "";
    expect(fd).toMatch(/\/FontName \/[A-Z]{6}\+TestCFF\b/);
    const ffId = refIn(fd, "FontFile3");
    if (ffId === null) throw new Error("unreachable: no FontFile3 ref");
    const ff = pdf.streamObject(ffId);
    expect(ff?.dict).toContain("/Subtype /CIDFontType0C");
    // The FontFile3 payload is the SUBSET CFF: it re-parses as a CID-keyed CFF
    // (numbering preserved), and is strictly smaller than the full CFF program
    // (the unused GID-2 multi-byte charstring is dropped to a 1-byte endchar).
    const ffPayload = ff?.payload ?? new Uint8Array();
    const subsetCffInfo = parseCff(ffPayload, 0, ffPayload.length, 3);
    expect(subsetCffInfo.isCidKeyed).toBe(true);
    const fullCff = parseSfnt(otf).cff;
    if (fullCff === undefined) throw new Error("unreachable: full font has no CFF");
    expect(ffPayload.length).toBeLessThan(fullCff.programBytes.length);
  });

  it("non-CID-keyed CFF: CID==GID end-to-end, well-formed Type0/CIDFontType0 graph", () => {
    const otf = buildTestOtf({ numGlyphs: 3, cidKeyed: false, cmap: cmapAtoGid1() });
    const provider = createEmbeddedFontProvider({ fonts: { Test: otf } });
    const handle = provider.resolveFont(cs("Test"));
    // 'A' → GID 1; non-CID-keyed ⇒ CID == GID == 1.
    expect([...nth(provider.encodeRun(handle, "A").clusters, 0, "cluster").bytes]).toEqual([0x00, 0x01]);

    const { pdf, t0Id } = writeFontGraph(provider, handle);
    const t0 = pdf.object(t0Id) ?? "";
    const descId = refInArray(t0, "DescendantFonts");
    if (descId === null) throw new Error("unreachable: no DescendantFonts ref");
    const desc = pdf.object(descId) ?? "";
    expect(desc).toContain("/Subtype /CIDFontType0");
    // CID == GID == 1; /W keyed by 1 (advance 500 @ 1000-em).
    const wMatch = desc.match(/\/W \[ (.*) \] >>/);
    expect((wMatch?.[1] ?? "").match(/\d+ \[\d+\]/g) ?? []).toEqual(["1 [500]"]);
    // Non-CID-keyed CFF embeds under Identity ROS.
    expect(desc).toMatch(/\/CIDSystemInfo << \/Registry \(Adobe\) \/Ordering \(Identity\) \/Supplement 0 >>/);
  });

  it("glyf font still embeds via the SAME provider (Type0/CIDFontType2 regression)", () => {
    // The original glyf fixture through the renamed provider — TrueType graph intact.
    const ttf = buildTestFontBytes();
    const provider = createEmbeddedFontProvider({ fonts: { TestFam: ttf } });
    const handle = provider.resolveFont(cs("TestFam"));
    // 'A' → GID 36; glyf ⇒ CID == GID == 36.
    expect([...nth(provider.encodeRun(handle, "A").clusters, 0, "cluster").bytes]).toEqual([0x00, 0x24]);

    const { pdf, t0Id } = writeFontGraph(provider, handle);
    const t0 = pdf.object(t0Id) ?? "";
    // /BaseFont carries the subset tag (PDF §9.6.4) prefixing the post name.
    expect(t0).toMatch(/\/BaseFont \/[A-Z]{6}\+TestFam-Regular\b/);
    const descId = refInArray(t0, "DescendantFonts");
    if (descId === null) throw new Error("unreachable: no DescendantFonts ref");
    const desc = pdf.object(descId) ?? "";
    expect(desc).toContain("/Subtype /CIDFontType2");
    expect(desc).toMatch(/\/W \[ 36 \[600\] \] >>/);
    // FontFile2 stream is the SUBSET program: re-parses (numGlyphs preserved) and
    // is strictly smaller than the full sfnt (198 of 201 outlines zeroed).
    const fdId = refIn(desc, "FontDescriptor");
    if (fdId === null) throw new Error("unreachable: no FontDescriptor ref");
    const fd = pdf.object(fdId) ?? "";
    expect(fd).toMatch(/\/FontName \/[A-Z]{6}\+TestFam-Regular\b/);
    const ffId = refIn(fd, "FontFile2");
    if (ffId === null) throw new Error("unreachable: no FontFile2 ref");
    const ffPayload = pdf.streamObject(ffId)?.payload ?? new Uint8Array();
    expect(parseSfnt(ffPayload).numGlyphs).toBe(201);
    expect(ffPayload.length).toBeLessThan(ttf.length);
  });
});
