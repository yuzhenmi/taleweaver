/**
 * C.2c T5 — paint the header/footer slots.
 *
 * `materializePage` (T4) produces `PageBox.headerSlot` / `PageBox.footerSlot`
 * as BlockBoxes positioned in PAGE-LOCAL coords (header at block-offset 0 in
 * the top margin band; footer at `pageBlockSize − blockEnd` in the bottom
 * margin band), or `null`. They are NAMED fields, NOT in `page.children`.
 *
 * These tests assert:
 *  - paintBox (via paintPage) draws the header text near the top and the
 *    footer text near the bottom (geometry: the y-coordinate of the draw).
 *  - walkAndDetectChanges (via paintPage incremental) marks a slot's region
 *    dirty when the slot changed, and nothing for an unchanged slot.
 *  - a page with both slots null paints / walks exactly as before (no extra
 *    draw calls, no extra dirty rects).
 *
 * JSDOM does not implement CanvasRenderingContext2D — we use a spy-stub that
 * records fillText (text + y) and clearRect calls.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintPage } from "./canvas-renderer";
import { createPaintCache } from "./paint-cache";
import type { LayoutBox } from "./index";

// ── Canvas mock (records fillText text+y and clearRect) ──────────────────────

interface FillText { text: string; x: number; y: number; }
interface ClearCall { x: number; y: number; w: number; h: number; }

interface SpyCtx extends CanvasRenderingContext2D {
  _fills: FillText[];
  _clearRects: ClearCall[];
}

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const fills: FillText[] = [];
  const clearRects: ClearCall[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & {
    _fills: FillText[];
    _clearRects: ClearCall[];
  } = {
    _fills: fills,
    _clearRects: clearRects,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect(x: number, y: number, w: number, h: number) {
      clearRects.push({ x, y, w, h });
    },
    fillRect() { /* no-op */ },
    fillText(text: string, x: number, y: number) {
      fills.push({ text, x, y });
    },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
  };
  return ctx as unknown as SpyCtx;
}

// ── LayoutBox helpers ────────────────────────────────────────────────────────

const BASE_CS = {
  backgroundColor: "transparent",
  color: "black",
  fontFamily: "sans-serif",
  fontSize: 16,
  fontWeight: "normal",
  fontStyle: "normal",
  underline: false,
  lineThrough: false,
  borderBlockStartStyle: "none",
  borderBlockEndStyle: "none",
  borderInlineStartStyle: "none",
  borderInlineEndStyle: "none",
  borderBlockStartColor: "black",
  borderBlockEndColor: "black",
  borderInlineStartColor: "black",
  borderInlineEndColor: "black",
  direction: "ltr",
};

const BASE_US = {
  paddingBlockStart: 0,
  paddingBlockEnd: 0,
  paddingInlineStart: 0,
  paddingInlineEnd: 0,
  borderBlockStartWidth: 0,
  borderBlockEndWidth: 0,
  borderInlineStartWidth: 0,
  borderInlineEndWidth: 0,
  borderBlockStartStyle: "none",
  borderBlockEndStyle: "none",
  borderInlineStartStyle: "none",
  borderInlineEndStyle: "none",
  borderBlockStartColor: "black",
  borderBlockEndColor: "black",
  borderInlineStartColor: "black",
  borderInlineEndColor: "black",
  direction: "ltr",
  lineHeight: 20,
  writingMode: "horizontal-tb",
};

function makeTextRun(opts: {
  key: string; x?: number; y?: number; width?: number; height?: number; text: string;
}): LayoutBox {
  return {
    type: "text-run",
    key: opts.key,
    inlineOffset: 0, blockOffset: 0,
    inlineSize: opts.width ?? 100, blockSize: opts.height ?? 16,
    x: opts.x ?? 0, y: opts.y ?? 0,
    width: opts.width ?? 100, height: opts.height ?? 16,
    writingMode: "horizontal-tb", direction: "ltr",
    text: opts.text,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function makeLine(opts: {
  key: string; x?: number; y?: number; width?: number; height?: number; children: LayoutBox[];
}): LayoutBox {
  return {
    type: "line",
    key: opts.key,
    inlineOffset: 0, blockOffset: 0,
    inlineSize: opts.width ?? 100, blockSize: opts.height ?? 16,
    x: opts.x ?? 0, y: opts.y ?? 0,
    width: opts.width ?? 100, height: opts.height ?? 16,
    writingMode: "horizontal-tb", direction: "ltr",
    baseline: 12,
    ownerBlockId: "owner",
    inlineStartOffset: 0,
    children: opts.children,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

/** A header/footer slot: BlockBox → LineBox → TextRunBox. */
function makeSlot(opts: {
  key: string; y: number; text: string; width?: number; height?: number;
}): LayoutBox {
  const w = opts.width ?? 200;
  const h = opts.height ?? 16;
  return {
    type: "block",
    key: opts.key,
    inlineOffset: 0, blockOffset: 0,
    inlineSize: w, blockSize: h,
    x: 0, y: opts.y,
    width: w, height: h,
    writingMode: "horizontal-tb", direction: "ltr",
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
    children: [
      makeLine({
        key: `${opts.key}-line`, x: 0, y: 0, width: w, height: h,
        children: [makeTextRun({ key: `${opts.key}-text`, x: 0, y: 0, width: w, height: h, text: opts.text })],
      }),
    ],
  } as unknown as LayoutBox;
}

function makeBodyBlock(opts: { key: string; y: number; text: string }): LayoutBox {
  return {
    type: "block",
    key: opts.key,
    inlineOffset: 0, blockOffset: 0,
    inlineSize: 456, blockSize: 16,
    x: 72, y: opts.y,
    width: 456, height: 16,
    writingMode: "horizontal-tb", direction: "ltr",
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
    children: [
      makeLine({
        key: `${opts.key}-line`, x: 0, y: 0, width: 456, height: 16,
        children: [makeTextRun({ key: `${opts.key}-text`, x: 0, y: 0, width: 100, height: 16, text: opts.text })],
      }),
    ],
  } as unknown as LayoutBox;
}

/** A PageBox with optional header/footer/footnote slots and a body child. */
function makePage(opts: {
  headerSlot?: LayoutBox | null;
  footerSlot?: LayoutBox | null;
  footnoteSlot?: LayoutBox | null;
  children?: LayoutBox[];
  width?: number;
  height?: number;
}): LayoutBox {
  const w = opts.width ?? 600;
  const h = opts.height ?? 800;
  return {
    type: "page",
    key: "page-0",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: w, blockSize: h,
    x: 0, y: 0,
    width: w, height: h,
    writingMode: "horizontal-tb", direction: "ltr",
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
    children: opts.children ?? [],
    pageIndex: 0,
    headerSlot: opts.headerSlot ?? null,
    footerSlot: opts.footerSlot ?? null,
    footnoteSlot: opts.footnoteSlot ?? null,
  } as unknown as LayoutBox;
}

const PAGE_HEIGHT = 800;
const FOOTER_BAND_Y = PAGE_HEIGHT - 96; // pageBlockSize − blockEnd (mirrors materializePage)
// The footnote slot sits BETWEEN the body content and the footer: above the footer
// band, below the body. A representative band y for the test slot.
const FOOTNOTE_BAND_Y = PAGE_HEIGHT - 160;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("C.2c T5: paint header/footer slots", () => {
  let ctx: SpyCtx;
  const noCursor = null;
  const noCursorState = "hidden" as const;

  beforeEach(() => {
    ctx = createSpyCtx(600, PAGE_HEIGHT);
  });

  it("paints header text near the top and footer text near the bottom", () => {
    const header = makeSlot({ key: "hdr", y: 0, text: "HEADER" });
    const footer = makeSlot({ key: "ftr", y: FOOTER_BAND_Y, text: "FOOTER" });
    const body = makeBodyBlock({ key: "body", y: 96, text: "BODY" });
    const page = makePage({ headerSlot: header, footerSlot: footer, children: [body] });

    paintPage(ctx, page, [], [], [], [], noCursor, noCursorState);

    // #330: text paints one fillText PER CLUSTER (per code unit), not one per
    // run. Each word's first cluster carries the run's baseline y, which is what
    // these geometry assertions exercise. The first fill of "HEADER" is "H",
    // of "FOOTER" is "F", of "BODY" is "B".
    const headerFill = ctx._fills.find((f) => f.text === "H");
    const footerFill = ctx._fills.find((f) => f.text === "F");
    const bodyFill = ctx._fills.find((f) => f.text === "B");

    // All three painted.
    expect(headerFill).toBeDefined();
    expect(footerFill).toBeDefined();
    expect(bodyFill).toBeDefined();

    if (headerFill === undefined || footerFill === undefined || bodyFill === undefined) {
      throw new Error("missing fill");
    }

    // Geometry: header near the top, footer near the bottom.
    expect(headerFill.y).toBeLessThan(BASE_US.lineHeight); // header in top band, y ≈ 0
    expect(footerFill.y).toBeGreaterThanOrEqual(FOOTER_BAND_Y);
    // Footer below body, body below header.
    expect(headerFill.y).toBeLessThan(bodyFill.y);
    expect(bodyFill.y).toBeLessThan(footerFill.y);
  });

  it("NO-REGRESSION: null slots paint exactly as before (only body text)", () => {
    const body = makeBodyBlock({ key: "body", y: 96, text: "BODY" });
    const page = makePage({ headerSlot: null, footerSlot: null, children: [body] });

    paintPage(ctx, page, [], [], [], [], noCursor, noCursorState);

    // #330: only the body paints (no slots) — but now one fillText per cluster,
    // so the fills spell out "BODY" letter-by-letter rather than in one call.
    const painted = ctx._fills.map((f) => f.text).join("");
    expect(painted).toBe("BODY");
  });

  // DA3: the footnote slot is a PURE NAMED field (NOT in `page.children`), exactly
  // like header/footer. paintBox must reach it BY NAME — otherwise footnote bodies
  // silently stop painting. Single-paint (exactly once): the slot's text appears in
  // the painted output the same number of times as its clusters, no more.
  it("paints the footnote-slot text exactly once (by-name, slot NOT in children)", () => {
    const footnote = makeSlot({ key: "fn", y: FOOTNOTE_BAND_Y, text: "FN" });
    const body = makeBodyBlock({ key: "body", y: 96, text: "BODY" });
    // The slot is the NAMED field only — NOT in children (mirrors production after DA3).
    const page = makePage({ footnoteSlot: footnote, children: [body] });

    paintPage(ctx, page, [], [], [], [], noCursor, noCursorState);

    // "FN" → clusters "F","N". Both must be painted (the slot is reached by name),
    // and EXACTLY once each (not double-painted from also being in children).
    expect(ctx._fills.filter((f) => f.text === "F")).toHaveLength(1);
    expect(ctx._fills.filter((f) => f.text === "N")).toHaveLength(1);
    // Geometry: footnote band sits below the body and above the page bottom.
    const fnFill = ctx._fills.find((f) => f.text === "F");
    const bodyFill = ctx._fills.find((f) => f.text === "B");
    expect(fnFill).toBeDefined();
    expect(bodyFill).toBeDefined();
    if (fnFill === undefined || bodyFill === undefined) throw new Error("missing fill");
    expect(fnFill.y).toBeGreaterThanOrEqual(FOOTNOTE_BAND_Y);
    expect(bodyFill.y).toBeLessThan(fnFill.y);
  });
});

describe("C.2c T5: walkAndDetectChanges covers header/footer slots", () => {
  const noCursor = null;
  const noCursorState = "hidden" as const;

  it("marks the header slot region dirty when the slot changes", () => {
    const cache = createPaintCache();

    // First paint: seed the cache with header v1.
    const headerA = makeSlot({ key: "hdr", y: 0, text: "PAGE 1" });
    const body = makeBodyBlock({ key: "body", y: 96, text: "BODY" });
    const ctx1 = createSpyCtx(600, PAGE_HEIGHT);
    paintPage(ctx1, makePage({ headerSlot: headerA, children: [body] }), [], [], [], [], noCursor, noCursorState, undefined, cache);

    // Second paint: fresh page tree, header changed (different text/ref), same body ref.
    const headerB = makeSlot({ key: "hdr", y: 0, text: "PAGE 2" });
    const ctx2 = createSpyCtx(600, PAGE_HEIGHT);
    const dirty = paintPage(
      ctx2,
      makePage({ headerSlot: headerB, children: [body] }),
      [], [], [], [], noCursor, noCursorState, undefined, cache,
    );

    // The header slot's region (top band) must be dirty. The header text-run
    // sits at page-local y ≈ 0 and is much shorter than the full page; assert a
    // dirty rect overlaps the top band AND is slot-sized (not the full-page box,
    // which is always dirty because the page wrapper is a fresh ref each paint).
    const coversHeader = dirty.some((r) => r.y < BASE_US.lineHeight && r.h < 100);
    expect(coversHeader).toBe(true);
  });

  it("marks the footer slot region dirty when the slot changes", () => {
    const cache = createPaintCache();

    const footerA = makeSlot({ key: "ftr", y: FOOTER_BAND_Y, text: "1" });
    const body = makeBodyBlock({ key: "body", y: 96, text: "BODY" });
    const ctx1 = createSpyCtx(600, PAGE_HEIGHT);
    paintPage(ctx1, makePage({ footerSlot: footerA, children: [body] }), [], [], [], [], noCursor, noCursorState, undefined, cache);

    const footerB = makeSlot({ key: "ftr", y: FOOTER_BAND_Y, text: "2" });
    const ctx2 = createSpyCtx(600, PAGE_HEIGHT);
    const dirty = paintPage(
      ctx2,
      makePage({ footerSlot: footerB, children: [body] }),
      [], [], [], [], noCursor, noCursorState, undefined, cache,
    );

    // The footer slot's region (bottom band) must be dirty.
    const coversFooter = dirty.some((r) => r.y >= FOOTER_BAND_Y);
    expect(coversFooter).toBe(true);
  });

  // DA3: walkAndDetectChanges must reach the footnote slot BY NAME (it is NOT in
  // children). Otherwise a changed footnote body never marks its region dirty and
  // the stale number/text is never repainted.
  it("marks the footnote slot region dirty when the slot changes", () => {
    const cache = createPaintCache();

    const footnoteA = makeSlot({ key: "fn", y: FOOTNOTE_BAND_Y, text: "1" });
    const body = makeBodyBlock({ key: "body", y: 96, text: "BODY" });
    const ctx1 = createSpyCtx(600, PAGE_HEIGHT);
    paintPage(ctx1, makePage({ footnoteSlot: footnoteA, children: [body] }), [], [], [], [], noCursor, noCursorState, undefined, cache);

    const footnoteB = makeSlot({ key: "fn", y: FOOTNOTE_BAND_Y, text: "2" });
    const ctx2 = createSpyCtx(600, PAGE_HEIGHT);
    const dirty = paintPage(
      ctx2,
      makePage({ footnoteSlot: footnoteB, children: [body] }),
      [], [], [], [], noCursor, noCursorState, undefined, cache,
    );

    // The footnote slot's region (its band) must be dirty — and slot-sized, not the
    // full-page box (always dirty since the page wrapper is a fresh ref each paint).
    const coversFootnote = dirty.some((r) => r.y >= FOOTNOTE_BAND_Y && r.h < 100);
    expect(coversFootnote).toBe(true);
  });

  it("does NOT dirty an unchanged slot (same ref, warm cache)", () => {
    const cache = createPaintCache();

    const header = makeSlot({ key: "hdr", y: 0, text: "STABLE" });
    const footer = makeSlot({ key: "ftr", y: FOOTER_BAND_Y, text: "STABLE" });
    // DA3: a stable footnote slot too — same by-name reach as header/footer.
    const footnote = makeSlot({ key: "fn", y: FOOTNOTE_BAND_Y, text: "STABLE" });
    const body = makeBodyBlock({ key: "body", y: 96, text: "BODY" });

    // First paint seeds the cache with these exact slot/body refs.
    const ctx1 = createSpyCtx(600, PAGE_HEIGHT);
    paintPage(ctx1, makePage({ headerSlot: header, footerSlot: footer, footnoteSlot: footnote, children: [body] }), [], [], [], [], noCursor, noCursorState, undefined, cache);

    // Second paint: a FRESH page wrapper (so the root short-circuit can't fire),
    // but with the SAME header/footer/footnote/body slot references. Nothing should
    // be dirty.
    const ctx2 = createSpyCtx(600, PAGE_HEIGHT);
    const dirty = paintPage(
      ctx2,
      makePage({ headerSlot: header, footerSlot: footer, footnoteSlot: footnote, children: [body] }),
      [], [], [], [], noCursor, noCursorState, undefined, cache,
    );

    // Only the page box itself is a fresh ref; its slots/children are warm.
    // No dirty rect should fall in the header (top band), footer (bottom band), or
    // footnote band. The footnote band check mirrors the footer assertion: a future
    // regression that always-dirties the by-name footnote slot would fail here.
    const coversHeader = dirty.some((r) => r.y < BASE_US.lineHeight && r.h < 100);
    const coversFooter = dirty.some((r) => r.y >= FOOTER_BAND_Y);
    const coversFootnote = dirty.some((r) => r.y >= FOOTNOTE_BAND_Y && r.h < 100);
    expect(coversHeader).toBe(false);
    expect(coversFooter).toBe(false);
    expect(coversFootnote).toBe(false);
  });

  it("NO-REGRESSION: page with null slots — identical re-walk yields no dirty rects", () => {
    const cache = createPaintCache();
    const body = makeBodyBlock({ key: "body", y: 96, text: "BODY" });
    const page = makePage({ headerSlot: null, footerSlot: null, children: [body] });

    const ctx1 = createSpyCtx(600, PAGE_HEIGHT);
    paintPage(ctx1, page, [], [], [], [], noCursor, noCursorState, undefined, cache);

    // Re-paint the SAME page reference — root short-circuit fires, zero dirty.
    const ctx2 = createSpyCtx(600, PAGE_HEIGHT);
    const dirty = paintPage(ctx2, page, [], [], [], [], noCursor, noCursorState, undefined, cache);
    expect(dirty).toHaveLength(0);
  });
});
