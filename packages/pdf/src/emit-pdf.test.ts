import { describe, it, expect } from "vitest";
import type { ComputedStyle, UsedStyle } from "@taleweaver/core";
import type { PageBox, TextRunBox, BlockBox, LayoutBox, PdfOutlineNode } from "@taleweaver/print";
import { emitPdf } from "./emit-pdf";
import { parsePdf } from "./pdf-parse";
import { decodeLatin1 } from "./pdf-writer";
import { createMockImageProvider } from "./mock-image-provider";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * Concatenated latin1 text of EVERY page's content stream, decompressed. Page
 * content streams are FlateDecode-compressed by the writer, so their operators
 * (Tf / Td / Tj / cm / Do …) do NOT appear literally in `pdf.raw`; follow each
 * page's `/Contents N 0 R` ref to the stream object (which `streamObject`
 * inflates transparently) and join the payloads.
 */
function allContentText(pdf: ReturnType<typeof parsePdf>): string {
  const parts: string[] = [];
  for (const body of pdf.pageBodies()) {
    const m = body.match(/\/Contents (\d+) 0 R/);
    if (m === null) throw new Error("page body missing /Contents ref");
    const stream = pdf.streamObject(Number(nth(m, 1, "contents ref")));
    if (stream === null) throw new Error("page content stream not found");
    parts.push(new TextDecoder("latin1").decode(stream.payload));
  }
  return parts.join("\n");
}

function run(text: string, x: number, y: number, fontWeight: number = 400): TextRunBox {
  const cs = { fontSize: 12, color: "#000000", fontFamily: "sans", fontWeight, fontStyle: "normal" } as unknown as ComputedStyle;
  return { type: "text-run", text, x, y, width: text.length * 8, height: 16, clusterWidths: Array.from(text, () => 8), computedStyle: cs } as unknown as TextRunBox;
}
// A linked text-run: identical to `run` but carries the layout `link` attr the
// page-emitter recognizes (it gates the /Link rect on `isOpenableLinkUrl`).
function linkRun(text: string, link: string, x: number, y: number): TextRunBox {
  const cs = { fontSize: 12, color: "#000000", fontFamily: "sans", fontWeight: 400, fontStyle: "normal" } as unknown as ComputedStyle;
  return { type: "text-run", text, x, y, width: text.length * 8, height: 16, clusterWidths: Array.from(text, () => 8), computedStyle: cs, link } as unknown as TextRunBox;
}
function page(children: unknown[]): PageBox {
  return { type: "page", width: 200, height: 100, children, headerSlot: null, footerSlot: null, footnoteSlot: null } as unknown as PageBox;
}
function pageH(height: number, children: unknown[]): PageBox {
  return { type: "page", width: 400, height, children, headerSlot: null, footerSlot: null, footnoteSlot: null } as unknown as PageBox;
}
// A page whose footnote slot carries `children` — exercises the footnote-body
// link path (the slot is walked exactly like page children by the emitter).
function pageWithFootnote(children: unknown[], footnoteChildren: unknown[]): PageBox {
  const footnoteSlot = { type: "block", x: 0, y: 0, width: 200, height: 40, children: footnoteChildren, computedStyle: { backgroundColor: "transparent" } as unknown as ComputedStyle, usedStyle: NO_BORDER_US, metadata: {} } as unknown as LayoutBox;
  return { type: "page", width: 200, height: 100, children, headerSlot: null, footerSlot: null, footnoteSlot } as unknown as PageBox;
}

// A `display:block` ElementBox carrying `metadata.image` — the image-box shape
// the page-emitter recognizes. Border widths are 0 / style "none" so the
// background/border passes emit nothing (only the image branch matters here).
const NO_BORDER_US = {
  writingMode: "horizontal-tb",
  direction: "ltr",
  borderBlockStartWidth: 0, borderBlockEndWidth: 0, borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none", borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black", borderInlineStartColor: "black", borderInlineEndColor: "black",
  paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
} as unknown as UsedStyle;
function imageBox(src: string, width: number, height: number, x: number, y: number): BlockBox {
  const cs = { backgroundColor: "transparent" } as unknown as ComputedStyle;
  return {
    type: "block",
    x, y, width, height,
    computedStyle: cs,
    usedStyle: NO_BORDER_US,
    children: [],
    metadata: { image: { src, width, height } },
  } as unknown as BlockBox;
}

// A cross-ref atom: an `inline-block` box carrying `targetId` (the destination
// heading id). The page-emitter (Task 4) collects it into `internalLinkRects`;
// emit-pdf resolves it via the injected `resolveInternalDestination` and writes
// a /GoTo /Link annot. Mirrors `linkRun` (#521) for the internal-link path.
function xrefAtom(targetId: string, x: number, y: number): LayoutBox {
  const cs = { backgroundColor: "transparent", color: "#000000" } as unknown as ComputedStyle;
  return {
    type: "inline-block",
    x, y, width: 24, height: 16,
    computedStyle: cs,
    usedStyle: NO_BORDER_US,
    children: [],
    targetId,
  } as unknown as LayoutBox;
}

// A multi-page doc factory whose page 0 carries `pageZeroChildren`. Each page is
// 200×100.
function pages2(pageZeroChildren: unknown[], pageOneChildren: unknown[]): PageBox[] {
  return [page(pageZeroChildren), page(pageOneChildren)];
}

// Resolve the per-page object number for `pageIndex` by walking the /Pages
// /Kids array (its order is page-index order). Returns the object id of the
// /Page dict at that index.
function pageObjIdAt(pdf: ReturnType<typeof parsePdf>, pageIndex: number): number {
  const rootId = pdf.rootId();
  if (rootId === null) throw new Error("no /Root");
  const catalog = pdf.object(rootId) ?? "";
  const pagesRef = catalog.match(/\/Pages (\d+) 0 R/);
  if (pagesRef === null) throw new Error("catalog missing /Pages");
  const pagesBody = pdf.object(Number(nth(pagesRef, 1, "pages ref"))) ?? "";
  const kidsMatch = pagesBody.match(/\/Kids \[([^\]]*)\]/);
  if (kidsMatch === null) throw new Error("pages dict missing /Kids");
  const kidIds = [...(kidsMatch[1] ?? "").matchAll(/(\d+) 0 R/g)].map((mm) => Number(nth(mm, 1, "kid ref")));
  return nth(kidIds, pageIndex, "page obj id");
}

describe("emitPdf", () => {
  it("emits a valid multi-page PDF with the right object graph", () => {
    const pages = [page([run("Hello", 10, 20)]), page([run("World", 10, 20)])];
    const bytes = emitPdf({ pageCount: 2, getPage: (i) => nth(pages, i, "page") });
    const pdf = parsePdf(bytes);

    expect(pdf.raw.startsWith("%PDF-1.7")).toBe(true);
    expect(pdf.raw.trimEnd().endsWith("%%EOF")).toBe(true);

    const rootId = pdf.rootId();
    expect(rootId).not.toBeNull();
    const catalog = rootId === null ? "" : pdf.object(rootId) ?? "";
    expect(catalog).toContain("/Type /Catalog");
    expect(catalog).toMatch(/\/Pages \d+ 0 R/);

    const pageBodies = pdf.pageBodies();
    expect(pageBodies).toHaveLength(2);
    for (const body of pageBodies) {
      expect(body).toContain("/MediaBox [0 0 150 75]"); // 200*0.75 x 100*0.75
      expect(body).toMatch(/\/Contents \d+ 0 R/);
      expect(body).toContain("/Font");
    }
  });

  it("writes one font object per distinct base font, with consistent /Fn names", () => {
    // A regular run (Helvetica) + a bold run (Helvetica-Bold) → two distinct
    // base fonts. The shared font-name map must assign /F0 and /F1, write a
    // distinct font object for each, and reference both in the resource dict and
    // the content stream — no dangling /Fn and no missing object.
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("Reg", 10, 20), run("Bold", 10, 40, 700)]),
    });
    const pdf = parsePdf(bytes);
    const raw = pdf.raw;

    // Exactly two Type1 font objects (one Helvetica, one Helvetica-Bold). The
    // trailing space pins the plain "Helvetica" match so it does NOT also count
    // the "Helvetica-Bold" object (\b would, since the hyphen is a word boundary).
    expect(raw.match(/\/BaseFont \/Helvetica /g)).toHaveLength(1);
    expect(raw.match(/\/BaseFont \/Helvetica-Bold /g)).toHaveLength(1);

    // Both /Fn names appear in the content stream's Tf operators. The content
    // stream is FlateDecode-compressed, so read it via the decompressed payload.
    const content = allContentText(pdf);
    expect(content).toMatch(/\/F0 12 Tf/);
    expect(content).toMatch(/\/F1 12 Tf/);

    // The page's font resource dict references two distinct font objects, and
    // every /Fn referenced in the dict maps to a real written object.
    const pageBody = nth(pdf.pageBodies(), 0, "page body");
    const fontDict = pageBody.match(/\/Font << ([^>]*) >>/);
    expect(fontDict).not.toBeNull();
    const dictRefs = [...(fontDict?.[1] ?? "").matchAll(/\/F\d+ (\d+) 0 R/g)].map((m) => Number(nth(m, 1, "font-dict ref")));
    expect(dictRefs).toHaveLength(2);
    for (const id of dictRefs) expect(pdf.object(id)).not.toBeNull();
  });

  it("places text at the correct PDF baseline", () => {
    const bytes = emitPdf({ pageCount: 1, getPage: () => page([run("A", 10, 20)]) });
    // baselineY = 20 + (16-12)/2 + 12 = 34; PDF y = (100-34)*0.75 = 49.5; x = 10*0.75 = 7.5
    // Assert on the decompressed content stream (the stream may be FlateDecode-compressed).
    const content = allContentText(parsePdf(bytes));
    expect(content).toContain("7.5 49.5 Td");
    expect(content).toContain("<41> Tj");
  });

  it("emits an Image XObject, references it in /Resources, and places it via q cm Do Q", () => {
    // Image 200×100 at engine (10, 20) on a 400×200 page.
    //   rectYUp(10, 20, 200, 100, 200)
    //   = [10*0.75, (200-20-100)*0.75, 200*0.75, 100*0.75] = [7.5, 60, 150, 75]
    //   cm = [wPt, 0, 0, hPt, xPt, yBottomPt] = [150, 0, 0, 75, 7.5, 60].
    const imageProvider = createMockImageProvider({ images: { "/a.png": { w: 4, h: 4 } } });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => pageH(200, [imageBox("/a.png", 200, 100, 10, 20)]),
      imageProvider,
    });
    const pdf = parsePdf(bytes);
    const raw = pdf.raw;

    // Exactly one Image XObject object exists.
    expect(raw.match(/\/Subtype \/Image/g)).toHaveLength(1);

    // The page's /Resources carries the /XObject sub-dict with /Im0.
    const pageBody = nth(pdf.pageBodies(), 0, "page body");
    const xobjDict = pageBody.match(/\/XObject << (\/Im0 (\d+) 0 R) >>/);
    expect(xobjDict).not.toBeNull();
    const imObjId = Number(xobjDict?.[2] ?? "NaN");
    expect(pdf.object(imObjId)).toContain("/Subtype /Image");

    // The content stream places the image with the exact cm operands + /Im0 Do.
    // (Content stream is FlateDecode-compressed → read the decompressed payload.)
    expect(allContentText(pdf)).toContain("q\n150 0 0 75 7.5 60 cm\n/Im0 Do\nQ");
  });

  it("draws a grey #f0f0f0 placeholder (no XObject) when the image cannot be resolved", () => {
    // No imageProvider at all → resolveImage never runs → placeholder fill rect
    // at the image geometry (same rectYUp coords as above), and NO /Do, NO XObject.
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => pageH(200, [imageBox("/missing.png", 200, 100, 10, 20)]),
    });
    const pdf = parsePdf(bytes);
    const raw = pdf.raw;
    const content = allContentText(pdf);

    expect(raw).not.toContain("/Subtype /Image");
    expect(content).not.toContain(" Do\n");
    // #f0f0f0 → 0xf0/255 = 0.9412 (num() trims to 4 decimals). Fill rect at
    // [xPt, yBottomPt, wPt, hPt] = [7.5, 60, 150, 75]. Content stream is
    // FlateDecode-compressed → read the decompressed payload.
    expect(content).toContain("0.9412 0.9412 0.9412 rg\n7.5 60 150 75 re\nf");
    // The page /Resources must NOT carry an /XObject key.
    const [pageBody] = parsePdf(bytes).pageBodies();
    expect(pageBody).not.toContain("/XObject");
  });

  it("dedups a repeated image src to one XObject with two /Im0 Do placements", () => {
    const imageProvider = createMockImageProvider({ images: { "/a.png": { w: 4, h: 4 } } });
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () =>
        pageH(300, [
          imageBox("/a.png", 200, 100, 10, 20),
          imageBox("/a.png", 200, 100, 10, 140),
        ]),
      imageProvider,
    });
    const pdf = parsePdf(bytes);

    // One XObject object, two Do placements referencing the same /Im0. The Do
    // placements live in the FlateDecode-compressed content stream.
    expect(pdf.raw.match(/\/Subtype \/Image/g)).toHaveLength(1);
    expect(allContentText(pdf).match(/\/Im0 Do/g)).toHaveLength(2);
  });

  it("dedups the same image across two pages to one XObject", () => {
    // The same src appears once per page across two pages. emitPdf's per-page
    // accumulation loop guards on `usedImageByKey.has(im.imageKey)`, so the
    // image must be written as a SINGLE XObject and referenced via /Im0 Do on
    // BOTH pages — the cross-page counterpart to the same-page dedup above.
    const imageProvider = createMockImageProvider({ images: { "/a.png": { w: 4, h: 4 } } });
    const pages = [
      pageH(200, [imageBox("/a.png", 200, 100, 10, 20)]),
      pageH(200, [imageBox("/a.png", 200, 100, 10, 20)]),
    ];
    const bytes = emitPdf({ pageCount: 2, getPage: (i) => nth(pages, i, "page"), imageProvider });
    const pdf = parsePdf(bytes);

    expect(pdf.raw.match(/\/Subtype \/Image/g)).toHaveLength(1); // ONE XObject
    // The /Im0 Do placements live in each page's FlateDecode-compressed content
    // stream — read the decompressed payloads.
    expect(allContentText(pdf).match(/\/Im0 Do/g)).toHaveLength(2); // referenced on both pages
  });

  it("image-free doc has NO /XObject key in /Resources (byte-golden invariant)", () => {
    const bytes = emitPdf({ pageCount: 1, getPage: () => page([run("Hi", 10, 20)]) });
    const [pageBody] = parsePdf(bytes).pageBodies();
    expect(pageBody).toContain("/Resources << /Font <<");
    expect(pageBody).not.toContain("/XObject");
  });

  it("emits a /Link annotation with /URI + geometry-exact /Rect for a linked run", () => {
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([linkRun("click", "https://x.com", 10, 20)]),
    });
    const pdf = parsePdf(bytes);
    const pageBody = nth(pdf.pageBodies(), 0, "page body");
    const m = pageBody.match(/\/Annots \[\s*(\d+) 0 R/);
    expect(m).not.toBeNull();
    const annotId = Number(m?.[1] ?? "NaN");
    const annot = pdf.object(annotId) ?? "";
    expect(annot).toContain("/Subtype /Link");
    expect(annot).toContain("/Border [0 0 0]");
    expect(annot).toContain("/A << /Type /Action /S /URI /URI (https://x.com) >>");
    expect(annot).toMatch(/\/Rect \[[\d.]+ [\d.]+ [\d.]+ [\d.]+\]/);
    // Geometry-exact: rectYUp(10, 20, 40, 16, 100) → [x, yBottom, w, h]
    //   = [10*0.75, (100-20-16)*0.75, 40*0.75, 16*0.75] = [7.5, 48, 30, 12]
    //   → /Rect [llx lly urx ury] = [7.5, 48, 7.5+30, 48+12] = [7.5 48 37.5 60].
    expect(annot).toContain("/Rect [7.5 48 37.5 60]");
  });

  it("omits /Annots entirely for a link-free doc (byte-golden no-regression)", () => {
    const bytes = emitPdf({ pageCount: 1, getPage: () => page([run("Hi", 10, 20)]) });
    const pageBody = nth(parsePdf(bytes).pageBodies(), 0, "page body");
    expect(pageBody).not.toContain("/Annots");
  });

  it("drops a javascript: / relative link (no annotation)", () => {
    const jsBytes = emitPdf({
      pageCount: 1,
      getPage: () => page([linkRun("evil", "javascript:alert(1)", 10, 20)]),
    });
    expect(nth(parsePdf(jsBytes).pageBodies(), 0, "page body")).not.toContain("/Annots");
    const relBytes = emitPdf({
      pageCount: 1,
      getPage: () => page([linkRun("rel", "/local/path", 10, 20)]),
    });
    expect(nth(parsePdf(relBytes).pageBodies(), 0, "page body")).not.toContain("/Annots");
  });

  it("emits one /Link per line fragment for a wrapped link", () => {
    // A link that wrapped to two lines is two separate TextRunBox fragments,
    // each carrying the same `link` attr — the emitter pushes one rect per run.
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () =>
        page([
          linkRun("wrapped", "https://x.com", 10, 20),
          linkRun("link", "https://x.com", 10, 40),
        ]),
    });
    const pdf = parsePdf(bytes);
    const pageBody = nth(pdf.pageBodies(), 0, "page body");
    const annotsMatch = pageBody.match(/\/Annots \[([^\]]*)\]/);
    expect(annotsMatch).not.toBeNull();
    const annotIds = [...(annotsMatch?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((mm) => Number(nth(mm, 1, "annot ref")));
    expect(annotIds).toHaveLength(2);
    for (const id of annotIds) {
      const annot = pdf.object(id) ?? "";
      expect(annot).toContain("/Subtype /Link");
      expect(annot).toContain("/URI (https://x.com)");
    }
  });

  it("skips a non-Latin1 URL gracefully (no crash, no annotation)", () => {
    // A safe-scheme (https) but non-ASCII URL: the CJK host carries code points
    // > 0xFF, which cannot be encoded as a PDF Latin-1 literal string. The
    // emitter must drop the annotation rather than crash in encodeLatin1 —
    // the text still renders, the link just isn't clickable.
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([linkRun("link", "https://例え.test", 10, 20)]),
    });
    const pageBody = nth(parsePdf(bytes).pageBodies(), 0, "page body");
    expect(pageBody).not.toContain("/Annots");
  });

  it("emits a /Link on each page for a link spanning a page break", () => {
    // A link split across a page break is one fragment per page (the layout
    // engine fragments the run); each page's slot carries its own /Link annot.
    const pages = [
      page([linkRun("part1", "https://x.com", 10, 20)]),
      page([linkRun("part2", "https://x.com", 10, 20)]),
    ];
    const bytes = emitPdf({ pageCount: 2, getPage: (i) => nth(pages, i, "page") });
    const pdf = parsePdf(bytes);
    const bodies = pdf.pageBodies();
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      const am = body.match(/\/Annots \[([^\]]*)\]/);
      expect(am).not.toBeNull();
      const annotIds = [...(am?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((mm) => Number(nth(mm, 1, "annot ref")));
      expect(annotIds).toHaveLength(1);
      const annot = pdf.object(nth(annotIds, 0, "annot id")) ?? "";
      expect(annot).toContain("/URI (https://x.com)");
    }
  });

  it("emits a /Link for a link inside a footnote body", () => {
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => pageWithFootnote([run("body", 10, 20)], [linkRun("cite", "https://x.com", 10, 60)]),
    });
    const pdf = parsePdf(bytes);
    const pageBody = nth(pdf.pageBodies(), 0, "page body");
    const am = pageBody.match(/\/Annots \[([^\]]*)\]/);
    expect(am).not.toBeNull();
    const annotIds = [...(am?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((mm) => Number(nth(mm, 1, "annot ref")));
    expect(annotIds).toHaveLength(1);
    const annot = pdf.object(nth(annotIds, 0, "annot id")) ?? "";
    expect(annot).toContain("/Subtype /Link");
    expect(annot).toContain("/URI (https://x.com)");
  });

  it("emits a /GoTo /Link annot referencing the target page's object + /XYZ dest", () => {
    // A cross-ref atom on page 0 targets a heading on page 1. The injected
    // resolver maps "target-B" → page 1 at (xLeft=72, yTop=50); a broken target
    // returns null. This is exactly the closure shape makeInternalDestinationResolver
    // returns, keeping the e2e independent of a full layout fixture.
    const bytes = emitPdf({
      pageCount: 2,
      getPage: (i) => nth(pages2([xrefAtom("target-B", 10, 20)], [run("Heading B", 10, 20)]), i, "page"),
      resolveInternalDestination: (t) => (t === "target-B" ? { pageIndex: 1, yTopPx: 50, xLeftPx: 72 } : null),
    });
    const pdf = parsePdf(bytes);

    // Page 0 carries the /GoTo /Link annot.
    const page0 = nth(pdf.pageBodies(), 0, "page 0 body");
    const m = page0.match(/\/Annots \[\s*(\d+) 0 R/);
    expect(m).not.toBeNull();
    const annotId = Number(m?.[1] ?? "NaN");
    const annot = pdf.object(annotId) ?? "";
    expect(annot).toContain("/Subtype /Link");
    expect(annot).toContain("/Border [0 0 0]");

    // The /A action targets page 1's OBJECT NUMBER (resolved from /Kids).
    const page1ObjId = pageObjIdAt(pdf, 1);
    // pointYUp(72, 50, 100) → [72*0.75, (100-50)*0.75] = [54, 37.5]
    expect(annot).toContain(`/A << /Type /Action /S /GoTo /D [${page1ObjId} 0 R /XYZ 54 37.5 0] >>`);

    // Geometry-exact /Rect: rectYUp(10, 20, 24, 16, 100) → [x, yBottom, w, h]
    //   = [7.5, (100-20-16)*0.75, 18, 12] = [7.5, 48, 18, 12]
    //   → /Rect [llx lly urx ury] = [7.5, 48, 7.5+18, 48+12] = [7.5 48 25.5 60].
    expect(annot).toContain("/Rect [7.5 48 25.5 60]");
  });

  it("drops a broken internal cross-ref (resolver → null) with no /GoTo annot", () => {
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([xrefAtom("nonexistent", 10, 20)]),
      resolveInternalDestination: () => null,
    });
    const pageBody = nth(parsePdf(bytes).pageBodies(), 0, "page body");
    expect(pageBody).not.toContain("/Annots");
    expect(pageBody).not.toContain("/GoTo");
  });

  it("emits no /GoTo annot when a cross-ref atom is present but NO resolver is injected", () => {
    // The `if (resolveDest !== undefined)` branch: a caller that opts out of
    // internal links (no resolver) leaves cross-ref atoms unannotated — and the
    // page still omits /Annots entirely (the byte-golden invariant).
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([xrefAtom("target-B", 10, 20)]),
      // resolveInternalDestination intentionally absent
    });
    const pageBody = nth(parsePdf(bytes).pageBodies(), 0, "page body");
    expect(pageBody).not.toContain("/Annots");
    expect(pageBody).not.toContain("/GoTo");
  });

  it("merges internal /GoTo and external /URI annots into one /Annots array", () => {
    // A page with BOTH an external linked run and an internal cross-ref atom —
    // both annots must land in the same /Annots array.
    const bytes = emitPdf({
      pageCount: 2,
      getPage: (i) =>
        nth(
          pages2(
            [linkRun("ext", "https://x.com", 10, 20), xrefAtom("target-B", 10, 40)],
            [run("Heading B", 10, 20)],
          ),
          i,
          "page",
        ),
      resolveInternalDestination: (t) => (t === "target-B" ? { pageIndex: 1, yTopPx: 50, xLeftPx: 72 } : null),
    });
    const pdf = parsePdf(bytes);
    const page0 = nth(pdf.pageBodies(), 0, "page 0 body");
    const am = page0.match(/\/Annots \[([^\]]*)\]/);
    expect(am).not.toBeNull();
    const annotIds = [...(am?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((mm) => Number(nth(mm, 1, "annot ref")));
    expect(annotIds).toHaveLength(2);
    const annotBodies = annotIds.map((id) => pdf.object(id) ?? "");
    expect(annotBodies.some((b) => b.includes("/S /URI") && b.includes("(https://x.com)"))).toBe(true);
    expect(annotBodies.some((b) => b.includes("/S /GoTo"))).toBe(true);
  });

  it("omits /Annots for an internal-link-free page even when a resolver is injected", () => {
    // The resolver is present but the page has no cross-ref atoms → no /Annots
    // (the byte-golden no-regression invariant must survive the resolver opt-in).
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("Hi", 10, 20)]),
      resolveInternalDestination: () => ({ pageIndex: 0, yTopPx: 0, xLeftPx: 0 }),
    });
    const pageBody = nth(parsePdf(bytes).pageBodies(), 0, "page body");
    expect(pageBody).not.toContain("/Annots");
  });

  // ---- #523: catalog-level /Outlines (bookmark tree) -----------------------

  // Walk catalog → /Outlines root → first item body. Returns [rootBody, firstItemId,
  // firstItemBody] so a test can assert against any of them without `!`.
  function outlineRoot(pdf: ReturnType<typeof parsePdf>): { rootId: number; rootBody: string } {
    const rootObjId = pdf.rootId();
    if (rootObjId === null) throw new Error("no /Root");
    const catalog = pdf.object(rootObjId) ?? "";
    const m = catalog.match(/\/Outlines (\d+) 0 R/);
    if (m === null) throw new Error("catalog missing /Outlines");
    const id = Number(nth(m, 1, "outlines ref"));
    return { rootId: id, rootBody: pdf.object(id) ?? "" };
  }
  function firstChildOf(pdf: ReturnType<typeof parsePdf>, body: string): { id: number; body: string } {
    const m = body.match(/\/First (\d+) 0 R/);
    if (m === null) throw new Error("dict missing /First");
    const id = Number(nth(m, 1, "first ref"));
    return { id, body: pdf.object(id) ?? "" };
  }
  function nextOf(pdf: ReturnType<typeof parsePdf>, body: string): { id: number; body: string } {
    const m = body.match(/\/Next (\d+) 0 R/);
    if (m === null) throw new Error("dict missing /Next");
    const id = Number(nth(m, 1, "next ref"));
    return { id, body: pdf.object(id) ?? "" };
  }

  it("emits a /Outlines bookmark tree with /Dest, parent/sibling links, and counts", () => {
    const outline: readonly PdfOutlineNode[] = [
      {
        title: "Intro",
        dest: { pageIndex: 0, yTopPx: 20, xLeftPx: 10 },
        children: [
          { title: "Background", dest: { pageIndex: 1, yTopPx: 30, xLeftPx: 5 }, children: [] },
        ],
      },
      { title: "Method", dest: { pageIndex: 1, yTopPx: 40, xLeftPx: 8 }, children: [] },
    ];
    const bytes = emitPdf({
      pageCount: 2,
      getPage: (i) => nth(pages2([run("a", 10, 20)], [run("b", 10, 20)]), i, "page"),
      outline,
    });
    const pdf = parsePdf(bytes);

    // Catalog references /Outlines.
    const rootObjId = pdf.rootId();
    if (rootObjId === null) throw new Error("no /Root");
    expect(pdf.object(rootObjId) ?? "").toMatch(/\/Outlines \d+ 0 R/);

    // Root dict: /Type /Outlines. Per PDF spec §12.3.3 the outline dict's /Count
    // is the total number of visible (open) items at ALL levels — Intro + its
    // child Background + Method = 3.
    const { rootId, rootBody } = outlineRoot(pdf);
    expect(rootBody).toContain("/Type /Outlines");
    expect(rootBody).toContain("/Count 3");
    expect(rootBody).toMatch(/\/First \d+ 0 R/);
    expect(rootBody).toMatch(/\/Last \d+ 0 R/);

    // First item = "Intro": one descendant (/Count 1), points to a /Next (Method),
    // a /First (Background child), parent = the root, and a /Dest into page 0.
    const intro = firstChildOf(pdf, rootBody);
    expect(intro.body).toContain("/Title (Intro)");
    expect(intro.body).toContain("/Count 1");
    expect(intro.body).toContain(`/Parent ${rootId} 0 R`);
    expect(intro.body).toMatch(/\/Next \d+ 0 R/);
    const page0ObjId = pageObjIdAt(pdf, 0);
    // pointYUp(10, 20, 100) → [7.5, (100-20)*0.75] = [7.5, 60]
    expect(intro.body).toContain(`/Dest [${page0ObjId} 0 R /XYZ 7.5 60 0]`);

    // The child "Background" → /Parent is Intro, /Dest into page 1.
    const bg = firstChildOf(pdf, intro.body);
    expect(bg.body).toContain("/Title (Background)");
    expect(bg.body).toContain(`/Parent ${intro.id} 0 R`);
    const page1ObjId = pageObjIdAt(pdf, 1);
    // pointYUp(5, 30, 100) → [3.75, (100-30)*0.75] = [3.75, 52.5]
    expect(bg.body).toContain(`/Dest [${page1ObjId} 0 R /XYZ 3.75 52.5 0]`);

    // The /Next sibling = "Method" (no children → no /Count, no /First).
    const method = nextOf(pdf, intro.body);
    expect(method.body).toContain("/Title (Method)");
    expect(method.body).not.toContain("/Count");
    expect(method.body).not.toContain("/First");
  });

  it("omits /Outlines entirely when no outline is supplied", () => {
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("Hi", 10, 20)]),
    });
    const pdf = parsePdf(bytes);
    const rootObjId = pdf.rootId();
    if (rootObjId === null) throw new Error("no /Root");
    expect(pdf.object(rootObjId) ?? "").not.toContain("/Outlines");
  });

  it("omits /Outlines for an empty outline array", () => {
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("Hi", 10, 20)]),
      outline: [],
    });
    const pdf = parsePdf(bytes);
    const rootObjId = pdf.rootId();
    if (rootObjId === null) throw new Error("no /Root");
    expect(pdf.object(rootObjId) ?? "").not.toContain("/Outlines");
  });

  it("encodes a non-Latin outline title as a UTF-16BE /Title", () => {
    const outline: readonly PdfOutlineNode[] = [
      { title: "中文", dest: { pageIndex: 0, yTopPx: 20, xLeftPx: 10 }, children: [] },
    ];
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("a", 10, 20)]),
      outline,
    });
    const pdf = parsePdf(bytes);
    const { rootBody } = outlineRoot(pdf);
    const item = firstChildOf(pdf, rootBody);
    // U+4E2D U+6587 → BOM FEFF + 4E2D 6587.
    expect(item.body).toContain("/Title <FEFF4E2D6587>");
  });

  it("emits an outline item with no /Dest when dest is null", () => {
    const outline: readonly PdfOutlineNode[] = [
      { title: "Orphan", dest: null, children: [] },
    ];
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("a", 10, 20)]),
      outline,
    });
    const pdf = parsePdf(bytes);
    const { rootBody } = outlineRoot(pdf);
    const item = firstChildOf(pdf, rootBody);
    expect(item.body).toContain("/Title (Orphan)");
    expect(item.body).not.toContain("/Dest");
  });

  it("byte-golden: std-14 output is stable (regression gate)", () => {
    // A 1-page std-14 doc with a regular (Helvetica) + bold (Helvetica-Bold) run.
    // Captures the FULL byte stream as a golden so any change to the std-14 emit
    // path — font keying, object-write ordering, resource-dict order — is caught.
    // This snapshot is the gate for the fontKey/writeFontObjects migration: it
    // must remain byte-identical before and after.
    //
    // REGENERATED for #522 (internal /GoTo links): emit-pdf now PRE-ALLOCATES every
    // page object id before the per-page write loop (so a page-N /GoTo can
    // forward-reference a later page's id). That reorders the page object id vs the
    // content-stream id (page now precedes its content), shifting one xref offset.
    // Pure object-id reordering (design M3) — NO content change; the link-free /Page
    // dict stays /Annots-free.
    const bytes = emitPdf({
      pageCount: 1,
      getPage: () => page([run("Reg", 10, 20), run("Bold", 10, 40, 700)]),
    });
    expect(decodeLatin1(bytes)).toMatchSnapshot();
  });
});
