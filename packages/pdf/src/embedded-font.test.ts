import { describe, it, expect } from "vitest";
import type { ComputedStyle } from "@taleweaver/core";
import type { PageBox, TextRunBox } from "@taleweaver/print";
import { emitPdf } from "./emit-pdf";
import { parsePdf } from "./pdf-parse";
import { createMockEmbeddedFontProvider } from "./mock-embedded-font-provider";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function run(text: string, x: number, y: number, fontFamily: string): TextRunBox {
  const cs = {
    fontSize: 12,
    color: "#000000",
    fontFamily,
    fontWeight: 400,
    fontStyle: "normal",
  } as unknown as ComputedStyle;
  return {
    type: "text-run",
    text,
    x,
    y,
    width: text.length * 8,
    height: 16,
    clusterWidths: Array.from(text, () => 8),
    computedStyle: cs,
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

/** Find every object body that is a Type0 composite font. */
function type0Objects(pdf: ReturnType<typeof parsePdf>): { id: number; body: string }[] {
  const out: { id: number; body: string }[] = [];
  // The parse-back exposes objects only by id; probe ids 1..objectCount.
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

/**
 * Decode the page-1 content stream to a latin1 string by following the page
 * object's `/Contents N 0 R` ref to its stream object payload.
 */
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

/** Resolve the `/Fn` resource name that the page's font dict maps to `objId`. */
function fontResourceNameFor(pdf: ReturnType<typeof parsePdf>, objId: number): string | null {
  const pages = pdf.pageBodies();
  expect(pages).toHaveLength(1);
  // NOTE: [^>]* assumes no sub-dict / string-literal values inside the /Font dict —
  // safe for PdfWriter output, which only emits `/Fn N 0 R` entries here.
  const fontDict = nth(pages, 0, "page body").match(/\/Font << ([^>]*) >>/);
  if (fontDict === null) return null;
  const m = nth(fontDict, 1, "font-dict body").match(new RegExp(`(/F\\d+) ${objId} 0 R`));
  return m === null ? null : nth(m, 1, "/Fn name");
}

/** Per-cluster `Td` operands (the "<x> <y>" before each `Td`), in stream order. */
function tdOperands(content: string): string[] {
  return [...content.matchAll(/\n([\d.-]+ [\d.-]+) Td\n/g)].map((m) => nth(m, 1, "Td operands"));
}

/** Per-cluster `<hex> Tj` payloads (inner hex, uppercased), in stream order. */
function tjHex(content: string): string[] {
  return [...content.matchAll(/<([0-9a-fA-F]+)> Tj/g)].map((m) => nth(m, 1, "Tj hex").toUpperCase());
}

describe("embedded composite font object graph (mock provider)", () => {
  it("emits a Type0/CIDFontType2 graph with embedded FontFile2, /W, descriptor, ToUnicode", () => {
    const provider = createMockEmbeddedFontProvider({ embeddedFamilies: ["MockFam"] });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("AB", 10, 20, "MockFam")]),
      fontProvider: provider,
    });
    const pdf = parsePdf(bytes);

    // --- Type0 root font ---
    const t0s = type0Objects(pdf);
    expect(t0s).toHaveLength(1);
    const t0 = nth(t0s, 0, "Type0 object").body;
    expect(t0).toContain("/Type /Font");
    expect(t0).toContain("/Subtype /Type0");
    expect(t0).toContain("/Encoding /Identity-H");
    expect(t0).toMatch(/\/DescendantFonts \[\d+ 0 R\]/);
    expect(t0).toMatch(/\/ToUnicode \d+ 0 R/);

    // --- CIDFontType2 descendant ---
    const descId = refInArray(t0, "DescendantFonts");
    expect(descId).not.toBeNull();
    if (descId === null) throw new Error("unreachable");
    const desc = pdf.object(descId) ?? "";
    expect(desc).toContain("/Type /Font");
    expect(desc).toContain("/Subtype /CIDFontType2");
    expect(desc).toContain("/CIDToGIDMap /Identity");
    expect(desc).toMatch(
      /\/CIDSystemInfo << \/Registry \(Adobe\) \/Ordering \(Identity\) \/Supplement 0 >>/,
    );
    expect(desc).toMatch(/\/FontDescriptor \d+ 0 R/);
    expect(desc).toMatch(/\/DW \d+/);
    // /W array opens with `[` and contains per-cid entries (nested `[w]` brackets).
    expect(desc).toMatch(/\/W \[ /);
    // Known CID width: the mock maps 'A' (U+0041) → cid 65, width 540 (see mock).
    // The per-cid form `65 [540]` appears verbatim inside the /W array.
    expect(desc).toMatch(/\/W \[[^\n]*\b65 \[540\]/);

    // --- FontDescriptor ---
    const fdId = refIn(desc, "FontDescriptor");
    expect(fdId).not.toBeNull();
    const fd = fdId === null ? "" : pdf.object(fdId) ?? "";
    expect(fd).toContain("/Type /FontDescriptor");
    expect(fd).toMatch(/\/FontName \/\S+/);
    const flagsM = fd.match(/\/Flags (\d+)/);
    expect(flagsM).not.toBeNull();
    expect(Number(flagsM?.[1])).toBeGreaterThan(0);
    const bboxM = fd.match(/\/FontBBox \[([^\]]*)\]/);
    expect(bboxM).not.toBeNull();
    const bboxNums = (bboxM?.[1] ?? "").trim().split(/\s+/).map(Number);
    expect(bboxNums).toHaveLength(4);
    for (const n of bboxNums) expect(Number.isFinite(n)).toBe(true);
    expect(fd).toContain("/ItalicAngle 0");
    expect(fd).toMatch(/\/Ascent -?\d+/);
    expect(fd).toMatch(/\/Descent -?\d+/);
    expect(fd).toMatch(/\/CapHeight -?\d+/);
    expect(fd).toMatch(/\/StemV \d+/);
    expect(fd).toMatch(/\/FontFile2 \d+ 0 R/);

    // --- FontFile2 stream: payload byte-equals the mock's program blob ---
    const ffId = refIn(fd, "FontFile2");
    expect(ffId).not.toBeNull();
    const ff = ffId === null ? null : pdf.streamObject(ffId);
    expect(ff).not.toBeNull();
    const expectedProgram = provider.__test_programBytes("MockFam");
    // streamObject inflates transparently → payload === the original program.
    expect(ff?.payload).toEqual(expectedProgram);
    // /Length is now the (compressed) stream length — compression-dependent — so
    // assert the UNCOMPRESSED /Length1 (== program length) instead, plus the
    // round-tripped payload equality above.
    expect(ff?.dict).toContain(`/Length1 ${expectedProgram.length}`);

    // --- ToUnicode stream present + a valid CMap (codespacerange + bfchar) ---
    const tuId = refIn(t0, "ToUnicode");
    expect(tuId).not.toBeNull();
    const tu = tuId === null ? null : pdf.streamObject(tuId);
    expect(tu).not.toBeNull();
    const tuText = new TextDecoder("latin1").decode(tu?.payload ?? new Uint8Array());
    expect(tuText).toContain("begincmap");
    expect(tuText).toContain("endcmap");
    expect(tuText).toContain("begincodespacerange");
    expect(tuText).toContain("<0000> <FFFF>");
    expect(tuText).toMatch(/beginbfchar/);
    // 'A' = cid 65 (0x0041) → UTF-16BE 0041
    expect(tuText).toContain("<0041> <0041>");
    // Astral codepoint U+1F600 (mock cid 200 = 0x00C8) must emit a UTF-16BE
    // SURROGATE PAIR (D83D DE00) — NOT the 4-byte UCS-4 scalar 0001F600. This
    // exercises the surrogate-pair path end-to-end through the real emit pipeline.
    expect(tuText).toContain("<00C8> <D83DDE00>");
    expect(tuText).not.toContain("0001F600");
  });

  it("dedups embedded fonts by fontKey, NOT baseFont (collision: same baseFont, different programs)", () => {
    // Two families both resolve to baseFont "AAAAAA+MockFont" but carry distinct
    // programBytes + distinct fontKey → must emit TWO Type0 objects and TWO
    // distinct FontFile2 streams whose payloads byte-differ.
    const provider = createMockEmbeddedFontProvider({
      embeddedFamilies: ["MockA", "MockB"],
    });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("X", 10, 20, "MockA"), run("Y", 10, 40, "MockB")]),
      fontProvider: provider,
    });
    const pdf = parsePdf(bytes);

    const t0s = type0Objects(pdf);
    expect(t0s).toHaveLength(2);
    // Both share the same BaseFont string.
    for (const { body } of t0s) {
      expect(body).toContain("/BaseFont /AAAAAA+MockFont");
    }

    // Collect each Type0's FontFile2 payload by walking Type0 → descendant → fd → ff.
    const payloads: Uint8Array[] = [];
    for (const { body } of t0s) {
      const descId = refInArray(body, "DescendantFonts");
      expect(descId).not.toBeNull();
      if (descId === null) throw new Error("unreachable");
      const desc = pdf.object(descId) ?? "";
      const fdId = refIn(desc, "FontDescriptor");
      expect(fdId).not.toBeNull();
      if (fdId === null) throw new Error("unreachable");
      const fd = pdf.object(fdId) ?? "";
      const ffId = refIn(fd, "FontFile2");
      expect(ffId).not.toBeNull();
      if (ffId === null) throw new Error("unreachable");
      const ff = pdf.streamObject(ffId);
      expect(ff).not.toBeNull();
      if (ff !== null) payloads.push(ff.payload);
    }
    expect(payloads).toHaveLength(2);
    // The two embedded programs differ byte-wise (dedup keyed on fontKey).
    expect(payloads[0]).not.toEqual(payloads[1]);
    // Sanity: they equal the mock's per-family blobs.
    expect(payloads).toContainEqual(provider.__test_programBytes("MockA"));
    expect(payloads).toContainEqual(provider.__test_programBytes("MockB"));
  });

  it("coexists with standard-14: a delegated (non-embedded) run still emits a Type1 font", () => {
    const provider = createMockEmbeddedFontProvider({ embeddedFamilies: ["MockFam"] });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("E", 10, 20, "MockFam"), run("S", 10, 40, "Arial")]),
      fontProvider: provider,
    });
    const pdf = parsePdf(bytes);
    const raw = pdf.raw;
    // One embedded Type0 + one delegated standard-14 Type1.
    expect(type0Objects(pdf)).toHaveLength(1);
    expect(raw).toMatch(/\/Subtype \/Type1 \/BaseFont \/Helvetica /);
  });

  it("emits the mock's 2-byte CIDs verbatim into the page content stream", () => {
    // 'A' → cid 65 (0x0041), 'B' → cid 66 (0x0042). Each display cluster is its
    // own `Td … <hex> Tj`; the hex is the big-endian 2-byte CID. This locks the
    // end-to-end wiring: encodeRun bytes → showTextAt → content-stream hex.
    const provider = createMockEmbeddedFontProvider({ embeddedFamilies: ["MockFam"] });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("AB", 10, 20, "MockFam")]),
      fontProvider: provider,
    });
    const pdf = parsePdf(bytes);
    const content = pageContentText(pdf);

    // Two per-cluster CID payloads, big-endian 2-byte.
    expect(tjHex(content)).toEqual(["0041", "0042"]);

    // The `Tf` resource name must be the embedded Type0 font's `/Fn` (resolved
    // from the page /Resources /Font dict, NOT assumed to be /F0).
    const t0s = type0Objects(pdf);
    expect(t0s).toHaveLength(1);
    const fn = fontResourceNameFor(pdf, nth(t0s, 0, "Type0 object").id);
    expect(fn).not.toBeNull();
    if (fn === null) throw new Error("unreachable");
    expect(content).toContain(`${fn} 12 Tf`);
    // The CID `Tj` must be shown under that font (a `Tf … <0041> Tj` sequence).
    expect(content).toMatch(new RegExp(`${fn} 12 Tf\\n[^\\n]+ Td\\n<0041> Tj`));
  });

  it("embedding changes glyph SELECTION, never geometry (Td operands identical to std-14)", () => {
    // Same text + identical layout geometry (same run() fixture) emitted once with
    // an embedded family and once with a std-14 family. The per-cluster `Td`
    // operands — derived purely from layout geometry — must be byte-identical;
    // only the `<..> Tj` bytes (glyph selection) differ.
    const provider = createMockEmbeddedFontProvider({ embeddedFamilies: ["MockFam"] });
    const embeddedPdf = parsePdf(
      emitPdf({
        pageCount: 1,
        getPage: () => page([run("AB", 10, 20, "MockFam")]),
        fontProvider: provider,
      }),
    );
    const std14Pdf = parsePdf(
      emitPdf({
        pageCount: 1,
        getPage: () => page([run("AB", 10, 20, "Arial")]),
        fontProvider: provider,
      }),
    );
    const embeddedContent = pageContentText(embeddedPdf);
    const std14Content = pageContentText(std14Pdf);

    // Geometry (Td) byte-identical across the two — embedding ≠ reposition.
    expect(tdOperands(embeddedContent)).toEqual(tdOperands(std14Content));

    // Glyph selection differs: embedded = 2-byte CID hex, std-14 = WinAnsi 1-byte.
    expect(tjHex(embeddedContent)).toEqual(["0041", "0042"]);
    expect(tjHex(std14Content)).toEqual(["41", "42"]);
  });

  it("std-14 + embedded coexist at the content-stream level (two /Fn, byte-width discrimination)", () => {
    const provider = createMockEmbeddedFontProvider({ embeddedFamilies: ["MockFam"] });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("A", 10, 20, "MockFam"), run("S", 10, 40, "Arial")]),
      fontProvider: provider,
    });
    const pdf = parsePdf(bytes);
    const content = pageContentText(pdf);

    // The page font dict carries TWO distinct /Fn names.
    const names = [...nth(pdf.pageBodies(), 0, "page body").matchAll(/(\/F\d+) \d+ 0 R/g)].map(
      (m) => nth(m, 1, "/Fn name"),
    );
    expect(new Set(names).size).toBe(2);

    // Resolve each /Fn: the embedded Type0 and the delegated Type1 (Helvetica).
    const t0s = type0Objects(pdf);
    expect(t0s).toHaveLength(1);
    const embeddedFn = fontResourceNameFor(pdf, nth(t0s, 0, "Type0 object").id);
    expect(embeddedFn).not.toBeNull();
    if (embeddedFn === null) throw new Error("unreachable");

    // The content stream switches `Tf` between the two fonts.
    const tfNames = [...content.matchAll(/(\/F\d+) 12 Tf/g)].map((m) => nth(m, 1, "/Fn name"));
    expect(new Set(tfNames).size).toBe(2);

    // Embedded 'A' → 2-byte CID hex <0041>, shown under the embedded /Fn.
    expect(content).toMatch(new RegExp(`${embeddedFn} 12 Tf\\n[^\\n]+ Td\\n<0041> Tj`));
    // Std-14 'S' (U+0053) → WinAnsi single-byte hex <53>, shown under a different /Fn.
    const std14Fn = tfNames.find((n) => n !== embeddedFn);
    expect(std14Fn).toBeDefined();
    if (std14Fn === undefined) throw new Error("unreachable");
    expect(content).toMatch(new RegExp(`${std14Fn} 12 Tf\\n[^\\n]+ Td\\n<53> Tj`));
  });
});
