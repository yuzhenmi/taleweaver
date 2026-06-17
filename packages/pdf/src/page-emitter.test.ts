import { describe, it, expect } from "vitest";
import type { ComputedStyle, UsedStyle } from "@taleweaver/core";
import type { PageBox, TextRunBox, BlockBox } from "@taleweaver/print";
import { emitPageContent } from "./page-emitter";
import { createStandard14FontProvider } from "./font-provider";
import type { PdfFontProvider, PdfFontHandle } from "./font-provider";
import { createMockImageProvider } from "./mock-image-provider";
import { rectYUp } from "./coordinate";

const decode = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * Minimal UsedStyle stub with all-zero borders. Non-text-leaf box stubs in
 * these tests need a usedStyle so that `emitBoxBorders` → `physicalBorderSides`
 * can resolve the writing-mode/direction mapping without crashing.
 */
const NO_BORDER_USED_STYLE: UsedStyle = {
  writingMode: "horizontal-tb",
  direction: "ltr",
  borderBlockStartWidth: 0, borderBlockStartStyle: "none", borderBlockStartColor: "black",
  borderBlockEndWidth: 0, borderBlockEndStyle: "none", borderBlockEndColor: "black",
  borderInlineStartWidth: 0, borderInlineStartStyle: "none", borderInlineStartColor: "black",
  borderInlineEndWidth: 0, borderInlineEndStyle: "none", borderInlineEndColor: "black",
  paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
} as unknown as UsedStyle;

function textRun(opts: {
  text: string;
  x: number; y: number; width: number; height: number;
  fontSize: number; color?: string; clusterWidths?: number[]; bidiLevel?: number;
  link?: string;
}): TextRunBox {
  const cs = {
    fontSize: opts.fontSize,
    color: opts.color ?? "#000000",
    fontFamily: "sans-serif",
    fontWeight: 400,
    fontStyle: "normal",
  } as unknown as ComputedStyle;
  return {
    type: "text-run",
    text: opts.text,
    x: opts.x, y: opts.y, width: opts.width, height: opts.height,
    clusterWidths: opts.clusterWidths,
    bidiLevel: opts.bidiLevel,
    link: opts.link,
    computedStyle: cs,
  } as unknown as TextRunBox;
}

function page(children: unknown[]): PageBox {
  return {
    type: "page",
    width: 200, height: 100,
    children,
    headerSlot: null, footerSlot: null, footnoteSlot: null,
  } as unknown as PageBox;
}

/**
 * A `display:block` ElementBox carrying `metadata.image` — the image-box shape
 * `emitPageContent` recognizes (mirrors `emit-pdf.test.ts`'s `imageBox`). The
 * all-zero `NO_BORDER_USED_STYLE` makes the background/border passes emit
 * nothing, so only the image branch contributes to the content stream.
 */
function imageBox(src: string, width: number, height: number, x: number, y: number): BlockBox {
  return {
    type: "block",
    x, y, width, height,
    computedStyle: { backgroundColor: "transparent" } as unknown as ComputedStyle,
    usedStyle: NO_BORDER_USED_STYLE,
    children: [],
    metadata: { image: { src, width, height } },
  } as unknown as BlockBox;
}

describe("emitPageContent", () => {
  it("emits a single LTR run at its absolute baseline, per-cluster", () => {
    const run = textRun({
      text: "AB", x: 10, y: 20, width: 16, height: 16, fontSize: 12,
      clusterWidths: [8, 8],
    });
    const provider = createStandard14FontProvider();
    const fontResourceName = () => "/F0";
    const { contentBytes, usedHandles } = emitPageContent(page([run]), { provider, fontResourceName, imageResourceName: () => "/Im0" });
    const s = decode(contentBytes);
    expect(s).toContain("0 0 0 rg");
    expect(s).toContain("/F0 12 Tf\n7.5 49.5 Td\n<41> Tj");
    expect(s).toContain("/F0 12 Tf\n13.5 49.5 Td\n<42> Tj");
    expect(usedHandles.map((h) => h.fontKey)).toEqual(["Helvetica"]);
  });

  it("recurses through block/line containers, accumulating parent-relative coords", () => {
    // Non-zero container coords pin the parent-relative accumulation: a run at
    // x:5 inside a line at x:0 inside a block at x:30,y:10 lands at absX=35,
    // baseline y = 10 + (16-12)/2 + 12 = 24 → pointYUp(35,24,100) = [26.25, 57].
    const cs = { backgroundColor: "transparent" } as unknown as ComputedStyle;
    const run = textRun({ text: "X", x: 5, y: 0, width: 8, height: 16, fontSize: 12, clusterWidths: [8] });
    const line = { type: "line", x: 0, y: 0, width: 100, height: 16, children: [run], computedStyle: cs, usedStyle: NO_BORDER_USED_STYLE } as unknown;
    const block = { type: "block", x: 30, y: 10, width: 100, height: 16, children: [line], computedStyle: cs, usedStyle: NO_BORDER_USED_STYLE } as unknown;
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([block]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    expect(decode(contentBytes)).toContain("26.25 57 Td\n<58> Tj");
  });

  it("recurses into a multi-column section's `columns`, accumulating column offset", () => {
    // A column offset at x:20 must thread through to the run's absolute x:
    // absX = 0(page) + 0(mc) + 20(col) + 0(run) = 20, baseline y = 0+2+12 = 14
    // → pointYUp(20,14,100) = [15, 64.5].
    const cs = { backgroundColor: "transparent" } as unknown as ComputedStyle;
    const run = textRun({ text: "Z", x: 0, y: 0, width: 8, height: 16, fontSize: 12, clusterWidths: [8] });
    const col = { type: "block", x: 20, y: 0, width: 8, height: 16, children: [run], computedStyle: cs, usedStyle: NO_BORDER_USED_STYLE } as unknown;
    const mc = { type: "multicolumn", x: 0, y: 0, width: 8, height: 16, columns: [col], columnRule: null, computedStyle: cs, usedStyle: NO_BORDER_USED_STYLE } as unknown;
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([mc]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    expect(decode(contentBytes)).toContain("15 64.5 Td\n<5a> Tj");
  });

  it("falls back to an even split when clusterWidths is absent", () => {
    const run = textRun({ text: "AB", x: 0, y: 0, width: 16, height: 16, fontSize: 12 });
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([run]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    const s = decode(contentBytes);
    expect(s).toContain("0 64.5 Td\n<41> Tj");
    expect(s).toContain("6 64.5 Td\n<42> Tj");
  });

  it("runs background then foreground: text emits exactly once across the two passes", () => {
    const run = textRun({ text: "A", x: 0, y: 0, width: 8, height: 16, fontSize: 12, clusterWidths: [8] });
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([run]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    const s = decode(contentBytes);
    expect((s.match(/<41> Tj/g) ?? []).length).toBe(1);
  });

  it("fills a block background in the background phase", () => {
    const block = {
      type: "block", x: 10, y: 20, width: 100, height: 50, children: [],
      computedStyle: { backgroundColor: "#ff0000" } as unknown as ComputedStyle,
      usedStyle: NO_BORDER_USED_STYLE,
    } as unknown;
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([block]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    // rectYUp(10,20,100,50,100) = [7.5, (100-20-50)*0.75=22.5, 75, 37.5]; #f00 -> 1 0 0
    expect(decode(contentBytes)).toContain("1 0 0 rg\n7.5 22.5 75 37.5 re\nf\n");
  });

  it("emits NO fill for a transparent background", () => {
    const block = {
      type: "block", x: 10, y: 20, width: 100, height: 50, children: [],
      computedStyle: { backgroundColor: "transparent" } as unknown as ComputedStyle,
      usedStyle: NO_BORDER_USED_STYLE,
    } as unknown;
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([block]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    const s = decode(contentBytes);
    expect(s).not.toContain(" re\n");
    expect(s).not.toContain(" rg\n");
  });

  it("does NOT register a handle that resolves but emits zero clusters", () => {
    // A provider whose encodeRun yields no glyphs for non-empty text (e.g. all
    // code points dropped). `usedHandles` drives emitPdf's written font objects,
    // so a font that never reaches a content stream must NOT appear — else
    // emitPdf writes an allocated-but-unreferenced font object. This pins that
    // the FOREGROUND glyph-emission walk, not font resolution, drives membership.
    const ghost: PdfFontHandle = { kind: "standard14", baseFont: "Ghost", fontKey: "Ghost" };
    const emptyClusterProvider: PdfFontProvider = {
      resolveFont: () => ghost,
      encodeRun: () => ({ clusters: [], dropped: 1 }),
      writeFontObjects: () => new Map(),
    };
    const run = textRun({ text: "中", x: 0, y: 0, width: 8, height: 16, fontSize: 12, clusterWidths: [8] });
    const { contentBytes, usedHandles } = emitPageContent(page([run]), {
      provider: emptyClusterProvider,
      fontResourceName: () => "/F0",
      imageResourceName: () => "/Im0",
    });
    expect(usedHandles).toHaveLength(0);
    expect(decode(contentBytes)).not.toContain("Tj");
  });

  it("excludes ONLY the zero-cluster handle, keeping a sibling that emits glyphs", () => {
    // Two runs: one whose handle resolves to a font that emits zero clusters,
    // one whose handle emits real glyphs. Only the emitting handle is recorded.
    const ghost: PdfFontHandle = { kind: "standard14", baseFont: "Ghost", fontKey: "Ghost" };
    const real: PdfFontHandle = { kind: "standard14", baseFont: "Helvetica", fontKey: "Helvetica" };
    const splitProvider: PdfFontProvider = {
      resolveFont: (used) => ((used as unknown as { color?: string }).color === "#ff0000" ? ghost : real),
      encodeRun: (h, text) =>
        h === ghost
          ? { clusters: [], dropped: text.length }
          : { clusters: Array.from(text, (ch) => ({ bytes: new Uint8Array([ch.charCodeAt(0)]), unicode: ch })), dropped: 0 },
      writeFontObjects: () => new Map(),
    };
    const ghostRun = textRun({ text: "X", x: 0, y: 0, width: 8, height: 16, fontSize: 12, color: "#ff0000", clusterWidths: [8] });
    const realRun = textRun({ text: "Y", x: 0, y: 20, width: 8, height: 16, fontSize: 12, clusterWidths: [8] });
    const { usedHandles } = emitPageContent(page([ghostRun, realRun]), {
      provider: splitProvider,
      fontResourceName: () => "/F0",
      imageResourceName: () => "/Im0",
    });
    expect(usedHandles).toEqual([real]);
  });

  it("emits per-side border rects", () => {
    const block = {
      type: "block", x: 0, y: 0, width: 100, height: 50, children: [],
      computedStyle: { backgroundColor: "transparent" } as unknown as ComputedStyle,
      usedStyle: {
        writingMode: "horizontal-tb", direction: "ltr",
        borderBlockStartWidth: 2, borderBlockStartStyle: "solid", borderBlockStartColor: "#000000",
        borderBlockEndWidth: 0, borderBlockEndStyle: "none", borderBlockEndColor: "#000000",
        borderInlineStartWidth: 4, borderInlineStartStyle: "solid", borderInlineStartColor: "#000000",
        borderInlineEndWidth: 0, borderInlineEndStyle: "none", borderInlineEndColor: "#000000",
        paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
      } as unknown as UsedStyle,
    } as unknown;
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([block]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    const s = decode(contentBytes);
    // top (blockStart→top, width=2): rectYUp(0,0,100,2,100) → [0,(100-0-2)*0.75=73.5,75,1.5]
    expect(s).toContain("0 0 0 rg\n0 73.5 75 1.5 re\nf\n");
    // left (inlineStart→left, width=4): rectYUp(0,0,4,50,100) → [0,(100-0-50)*0.75=37.5,3,37.5]
    expect(s).toContain("0 0 0 rg\n0 37.5 3 37.5 re\nf\n");
  });

  it("emits underline + line-through rects for a decorated text-run", () => {
    const run = {
      type: "text-run",
      text: "A", x: 0, y: 0, width: 8, height: 16,
      clusterWidths: [8], bidiLevel: undefined,
      computedStyle: {
        fontSize: 12, color: "#000000", fontFamily: "sans", fontWeight: 400, fontStyle: "normal",
        underline: true, lineThrough: true,
      } as unknown as ComputedStyle,
    } as unknown as TextRunBox;
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([run]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    const s = decode(contentBytes);
    // halfLeading=(16-12)/2=2.
    // underline engine y = 0+2+12+1 = 15 → rectYUp(0,15,8,1,100) = [0, (100-15-1)*0.75=63, 6, 0.75]
    expect(s).toContain("0 0 0 rg\n0 63 6 0.75 re\nf\n");
    // line-through engine y = 0+2+12*0.5 = 8 → rectYUp(0,8,8,1,100) = [0, (100-8-1)*0.75=68.25, 6, 0.75]
    expect(s).toContain("0 0 0 rg\n0 68.25 6 0.75 re\nf\n");
  });

  it("emits a horizontal rule rect", () => {
    const block = {
      type: "block", x: 0, y: 0, width: 200, height: 20, children: [],
      computedStyle: { backgroundColor: "transparent" } as unknown as ComputedStyle,
      usedStyle: NO_BORDER_USED_STYLE,
      metadata: { horizontalLine: true },
    } as unknown;
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([block]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    // engine rect (8, 0+20/2-0.5=9.5, 200-16=184, 1) → rectYUp(8,9.5,184,1,100)
    //   = [8*0.75=6, (100-9.5-1)*0.75=67.125, 184*0.75=138, 0.75]
    // #dadce0 → r=218/255≈0.8549, g=220/255≈0.8627, b=224/255≈0.8784
    const s = decode(contentBytes);
    // Pin the #dadce0 color prefix too, so an HR color regression can't pass on
    // the rect geometry alone.
    expect(s).toContain("0.8549 0.8627 0.8784 rg\n6 67.125 138 0.75 re\nf\n");
  });

  it("emits a line tab-leader as a baseline rect", () => {
    const tab = {
      type: "inline-block", x: 0, y: 0, width: 40, height: 16, children: [],
      computedStyle: { fontSize: 12, color: "#000000", backgroundColor: "transparent" } as unknown as ComputedStyle,
      usedStyle: NO_BORDER_USED_STYLE,
      inlineMeta: { embedType: "tab", leader: "line" },
    } as unknown;
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([tab]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    // baselineY engine = 0 + (16-12)/2 + 12 = 14; t = max(0.5, 12*0.06=0.72) = 0.72;
    // engine rect (0, 14-0.72=13.28, 40, 0.72) → rectYUp(0,13.28,40,0.72,100)
    //   = [0, (100-13.28-0.72)*0.75 = 86*0.75 = 64.5, 30, 0.54]
    const s = decode(contentBytes);
    expect(s).toContain("0 0 0 rg\n0 64.5 30 0.54 re\nf\n");
  });

  it("emits a dash tab-leader with the exact dash count", () => {
    const tab = {
      type: "inline-block", x: 0, y: 0, width: 40, height: 16, children: [],
      computedStyle: { fontSize: 12, color: "#000000", backgroundColor: "transparent" } as unknown as ComputedStyle,
      usedStyle: NO_BORDER_USED_STYLE,
      inlineMeta: { embedType: "tab", leader: "dash" },
    } as unknown;
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([tab]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    const s = decode(contentBytes);
    // dashLen=max(2,12*0.25)=3 (PDF width 3*0.75=2.25), gap=4.5, stride=7.5; loop
    // dx=gap; dx+dashLen<=40; dx+=stride → dx=4.5,12,19.5,27,34.5 → exactly 5
    // dashes. Pinning the COUNT (not ≥1) catches a loop-bound off-by-one.
    expect((s.match(/ 2\.25 0\.54 re\n/g) ?? []).length).toBe(5);
  });

  it("emits a dot tab-leader with the exact dot count", () => {
    const tab = {
      type: "inline-block", x: 0, y: 0, width: 40, height: 16, children: [],
      computedStyle: { fontSize: 12, color: "#000000", backgroundColor: "transparent" } as unknown as ComputedStyle,
      usedStyle: NO_BORDER_USED_STYLE,
      inlineMeta: { embedType: "tab", leader: "dot" },
    } as unknown;
    const provider = createStandard14FontProvider();
    const { contentBytes } = emitPageContent(page([tab]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    const s = decode(contentBytes);
    // r=max(0.5,12*0.05)=0.6, gap=max(3,12*0.35)=4.2; loop dx=gap; dx<=40-4.2=35.8;
    // dx+=gap → 4.2,8.4,12.6,16.8,21,25.2,29.4,33.6 → exactly 8 dots. Each dot is
    // one fillCircle = one " m\n" moveto + four " c\n" Béziers. Pinning the counts
    // catches a loop-bound off-by-one.
    expect((s.match(/ m\n/g) ?? []).length).toBe(8);
    expect((s.match(/ c\n/g) ?? []).length).toBe(32);
  });

  it("places a resolved image via q cm Do Q and records it in usedImages", () => {
    // Box at x:10,y:10, intrinsic 40×40, on a 100-tall page. The placement cm is
    // built from rectYUp(absX,absY,W,H,pageHeight) reordered to [wPt,0,0,hPt,xPt,yBottomPt]:
    //   rectYUp(10,10,40,40,100) = [10*0.75=7.5, (100-10-40)*0.75=37.5, 40*0.75=30, 40*0.75=30]
    //   → [xPt=7.5, yBottomPt=37.5, wPt=30, hPt=30] → cm = [30, 0, 0, 30, 7.5, 37.5].
    const box = imageBox("/a.png", 40, 40, 10, 10);
    const [xPt, yBottomPt, wPt, hPt] = rectYUp(10, 10, 40, 40, 100);
    const result = emitPageContent(page([box]), {
      provider: createStandard14FontProvider(),
      fontResourceName: () => "/F0",
      imageProvider: createMockImageProvider({ images: { "/a.png": { w: 4, h: 4 } } }),
      imageResourceName: () => "/Im0",
    });
    expect(result.usedImages).toHaveLength(1);
    expect(nth(result.usedImages, 0, "used image").imageKey).toBe("/a.png");
    const cm = [wPt, 0, 0, hPt, xPt, yBottomPt].join(" ");
    expect(cm).toBe("30 0 0 30 7.5 37.5");
    expect(decode(result.contentBytes)).toContain(`q\n${cm} cm\n/Im0 Do\nQ\n`);
  });

  it("collects a link rect for a text-run carrying a safe link", () => {
    const x = 10, y = 20, w = 16, h = 16;
    const run = textRun({
      text: "AB", x, y, width: w, height: h, fontSize: 12,
      clusterWidths: [8, 8], link: "https://x.com",
    });
    const provider = createStandard14FontProvider();
    const result = emitPageContent(page([run]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    expect(result.linkRects).toHaveLength(1);
    const lr = result.linkRects[0];
    expect(lr?.url).toBe("https://x.com");
    const [rx, ry, rw, rh] = rectYUp(x, y, w, h, 100);
    expect(lr?.rect).toEqual([rx, ry, rx + rw, ry + rh]);
  });

  it("does NOT collect a rect for an unsafe or relative link", () => {
    const provider = createStandard14FontProvider();
    const jsRun = textRun({ text: "A", x: 0, y: 0, width: 8, height: 16, fontSize: 12, clusterWidths: [8], link: "javascript:alert(1)" });
    const relRun = textRun({ text: "B", x: 0, y: 20, width: 8, height: 16, fontSize: 12, clusterWidths: [8], link: "/relative" });
    const result = emitPageContent(page([jsRun, relRun]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    expect(result.linkRects).toHaveLength(0);
  });

  it("collects no rects when no run has a link", () => {
    const run = textRun({ text: "AB", x: 0, y: 0, width: 16, height: 16, fontSize: 12, clusterWidths: [8, 8] });
    const provider = createStandard14FontProvider();
    expect(emitPageContent(page([run]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" }).linkRects).toEqual([]);
  });

  it("link rect uses accumulated abs coords (nested parent)", () => {
    // run at x:5 inside a block at x:30,y:10 → absX=35, absY=10. A regression
    // that passed box.x (=5) instead of absX would produce rectYUp(5,0,…).
    const cs = { backgroundColor: "transparent" } as unknown as ComputedStyle;
    const run = textRun({ text: "A", x: 5, y: 0, width: 8, height: 16, fontSize: 12, clusterWidths: [8], link: "https://x.com" });
    const block = { type: "block", x: 30, y: 10, width: 100, height: 16, children: [run], computedStyle: cs, usedStyle: NO_BORDER_USED_STYLE } as unknown;
    const provider = createStandard14FontProvider();
    const result = emitPageContent(page([block]), { provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0" });
    expect(result.linkRects).toHaveLength(1);
    const [rx, ry, rw, rh] = rectYUp(35, 10, 8, 16, 100);
    expect(result.linkRects[0]?.rect).toEqual([rx, ry, rx + rw, ry + rh]);
  });

  it("collects internal-link rects from a cross-ref atom and a TOC entry, de-duping the atom inside the TOC entry", () => {
    // (a) A standalone cross-ref `InlineBlockBox` carrying `targetId: heading-A`
    //     → one internal-link rect.
    // (b) A TOC entry `BlockBox` (`metadata.navTarget: heading-B`, whole-line
    //     click) that CONTAINS a nested cross-ref-page atom (`targetId:
    //     heading-B`). The container's whole-line link wins; the inner atom is
    //     de-duped out → NOT a 3rd entry.
    const cs = { backgroundColor: "transparent" } as unknown as ComputedStyle;
    const xrefAtom = {
      type: "inline-block", x: 0, y: 0, width: 20, height: 16, children: [],
      computedStyle: cs, usedStyle: NO_BORDER_USED_STYLE,
      targetId: "heading-A",
    } as unknown;
    const innerAtom = {
      type: "inline-block", x: 0, y: 0, width: 12, height: 16, children: [],
      computedStyle: cs, usedStyle: NO_BORDER_USED_STYLE,
      targetId: "heading-B",
    } as unknown;
    const tocEntry = {
      type: "block", x: 0, y: 20, width: 100, height: 16, children: [innerAtom],
      computedStyle: cs, usedStyle: NO_BORDER_USED_STYLE,
      metadata: { tocEntry: true, navTarget: "heading-B" },
    } as unknown;
    const provider = createStandard14FontProvider();
    const result = emitPageContent(page([xrefAtom, tocEntry]), {
      provider, fontResourceName: () => "/F0", imageResourceName: () => "/Im0",
    });
    expect(result.internalLinkRects.map((r) => r.targetId).sort()).toEqual(["heading-A", "heading-B"]);
    const aEntry = result.internalLinkRects.find((r) => r.targetId === "heading-A");
    expect(aEntry?.rect).toHaveLength(4);
  });

  it("draws a grey #f0f0f0 placeholder (and no XObject) when no provider resolves the image", () => {
    // Same box, but deps carry NO imageProvider → the unresolved branch fills a
    // grey placeholder rect at the image geometry. parseCssColor("#f0f0f0") =
    // 240/255 = 0.9411764… → num()'s toFixed(4) → 0.9412 per channel. The rect is
    // rectYUp(10,10,40,40,100) = [7.5, 37.5, 30, 30].
    const box = imageBox("/a.png", 40, 40, 10, 10);
    const result = emitPageContent(page([box]), {
      provider: createStandard14FontProvider(),
      fontResourceName: () => "/F0",
      imageResourceName: () => "/Im0",
    });
    expect(result.usedImages).toHaveLength(0);
    const s = decode(result.contentBytes);
    expect(s).toContain("0.9412 0.9412 0.9412 rg\n7.5 37.5 30 30 re\nf\n");
    expect(s).not.toContain(" Do\n");
  });
});
