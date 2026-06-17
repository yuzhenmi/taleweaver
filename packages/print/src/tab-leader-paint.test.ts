/**
 * Tab leader paint (S9).
 *
 * A `"tab"` inline embed lays out as an inline-block whose layout box carries
 * `inlineMeta: { embedType: "tab"; leader: LeaderStyle }`. The IFC stamps the
 * destination tab stop's leader onto it. This slice paints that leader
 * (dot / dash / line) across the tab's inline advance at the text baseline.
 *
 * These tests build an inline-block tab box spanning a known inline x-range and
 * assert the recording 2D-context emitted the leader-specific draw calls WITHIN
 * that span — and emitted NONE for `leader: "none"` or a non-tab inline-block
 * (no `inlineMeta`).
 *
 * The harness (recording ctx + layout-build helpers) mirrors
 * `inline-block-paint.test.ts`; this file extends the spy to also record the
 * leader primitives (arc / fillRect / stroke segments).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import type { LayoutBox } from "./index";

// ── Canvas mock (records leader + text primitives w/ coords) ─────────────────
interface FillText { text: string; x: number; y: number; }
interface FillRect { x: number; y: number; w: number; h: number; }
interface Arc { x: number; y: number; r: number; }
interface Seg { x: number; y: number; }

interface SpyCtx extends CanvasRenderingContext2D {
  _fills: FillText[];
  _rects: FillRect[];
  _arcs: Arc[];
  _moves: Seg[];
  _lines: Seg[];
  _strokes: number;
}

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const fills: FillText[] = [];
  const rects: FillRect[] = [];
  const arcs: Arc[] = [];
  const moves: Seg[] = [];
  const lines: Seg[] = [];
  const state = { strokes: 0 };
  const ctx: Partial<CanvasRenderingContext2D> & {
    _fills: FillText[];
    _rects: FillRect[];
    _arcs: Arc[];
    _moves: Seg[];
    _lines: Seg[];
    _strokes: number;
  } = {
    _fills: fills,
    _rects: rects,
    _arcs: arcs,
    _moves: moves,
    _lines: lines,
    get _strokes() { return state.strokes; },
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    clearRect() { /* no-op */ },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h });
    },
    fillText(text: string, x: number, y: number) {
      fills.push({ text, x, y });
    },
    beginPath() { /* no-op */ },
    arc(x: number, y: number, r: number) {
      arcs.push({ x, y, r });
    },
    fill() { /* no-op */ },
    moveTo(x: number, y: number) {
      moves.push({ x, y });
    },
    lineTo(x: number, y: number) {
      lines.push({ x, y });
    },
    stroke() {
      state.strokes += 1;
    },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
  };
  return ctx as unknown as SpyCtx;
}

// ── LayoutBox helpers (mirror inline-block-paint.test.ts) ────────────────────
const BASE_CS = {
  backgroundColor: "transparent",
  color: "rgb(10, 20, 30)",
  fontFamily: "sans-serif",
  fontSize: 16,
  fontWeight: "normal",
  fontStyle: "normal",
  underline: false,
  lineThrough: false,
  direction: "ltr",
};

const BASE_US = {
  paddingBlockStart: 0, paddingBlockEnd: 0,
  paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 0, borderBlockEndWidth: 0,
  borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none",
  borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black",
  borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr",
  lineHeight: 20,
  writingMode: "horizontal-tb",
};

type Leader = "none" | "dot" | "dash" | "line";

/** An inline-block tab box at (x, y) spanning `width`, optionally with a leader. */
function makeTabInlineBlock(opts: {
  x: number; y: number; width: number; height: number; leader?: Leader;
}): LayoutBox {
  const meta = opts.leader === undefined
    ? undefined
    : { embedType: "tab" as const, leader: opts.leader };
  return {
    type: "inline-block",
    key: "tab",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: opts.width, blockSize: opts.height,
    x: opts.x, y: opts.y,
    width: opts.width, height: opts.height,
    writingMode: "horizontal-tb", direction: "ltr",
    children: [],
    inlineMeta: meta,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function makeBlock(opts: { children: LayoutBox[] }): LayoutBox {
  return {
    type: "block",
    key: "block",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: 200, blockSize: 100,
    x: 0, y: 0,
    width: 200, height: 100,
    writingMode: "horizontal-tb", direction: "ltr",
    children: opts.children,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function paint(ctx: SpyCtx, box: LayoutBox): void {
  paintCanvas(
    ctx,
    box,
    [],
    [],
    [], [], { x: 0, y: 0, height: 0 },
    "hidden",
    600,
    800,
    0,
    800,
  );
}

const TAB_X = 8;
const TAB_W = 92;
const TAB_RIGHT = TAB_X + TAB_W; // 100

function inSpan(x: number): boolean {
  return x >= TAB_X && x <= TAB_RIGHT;
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("tab leader painting", () => {
  let ctx: SpyCtx;

  beforeEach(() => {
    ctx = createSpyCtx();
  });

  it("paints a dot leader (filled circles) across the tab span for leader:'dot'", () => {
    const tab = makeTabInlineBlock({ x: TAB_X, y: 0, width: TAB_W, height: 20, leader: "dot" });
    const root = makeBlock({ children: [tab] });

    paint(ctx, root);

    // Dots are emitted as filled circles via arc(); at least two land inside the span.
    const dotsInSpan = ctx._arcs.filter((a) => inSpan(a.x));
    expect(dotsInSpan.length).toBeGreaterThanOrEqual(2);
  });

  it("paints a dash leader (short rects) across the tab span for leader:'dash'", () => {
    const tab = makeTabInlineBlock({ x: TAB_X, y: 0, width: TAB_W, height: 20, leader: "dash" });
    const root = makeBlock({ children: [tab] });

    paint(ctx, root);

    // Dashes are short filled rects spaced across the span. The inline-block
    // branch never paints a fillRect background here (transparent bg), so these
    // rects are the leader dashes.
    const dashesInSpan = ctx._rects.filter((r) => inSpan(r.x) && r.w < TAB_W);
    expect(dashesInSpan.length).toBeGreaterThanOrEqual(2);
  });

  it("paints a line leader (single rule) across the tab span for leader:'line'", () => {
    const tab = makeTabInlineBlock({ x: TAB_X, y: 0, width: TAB_W, height: 20, leader: "line" });
    const root = makeBlock({ children: [tab] });

    paint(ctx, root);

    // A single horizontal rule spanning (nearly) the whole tab width.
    const rule = ctx._rects.find((r) => inSpan(r.x) && r.w >= TAB_W * 0.8);
    expect(rule).toBeDefined();
  });

  it("draws the leader at the text baseline (within the box's vertical extent)", () => {
    const tab = makeTabInlineBlock({ x: TAB_X, y: 0, width: TAB_W, height: 20, leader: "line" });
    const root = makeBlock({ children: [tab] });

    paint(ctx, root);

    const rule = ctx._rects.find((r) => inSpan(r.x) && r.w >= TAB_W * 0.8);
    expect(rule).toBeDefined();
    // Baseline ≈ box top (0) + halfLeading((20-16)/2 = 2) + fontSize(16) = 18,
    // which sits within [0, 20] (the box's vertical extent).
    expect(rule?.y).toBeGreaterThanOrEqual(0);
    expect(rule?.y).toBeLessThanOrEqual(20);
  });

  it("paints NO leader for leader:'none'", () => {
    const tab = makeTabInlineBlock({ x: TAB_X, y: 0, width: TAB_W, height: 20, leader: "none" });
    const root = makeBlock({ children: [tab] });

    paint(ctx, root);

    expect(ctx._arcs.length).toBe(0);
    expect(ctx._rects.length).toBe(0);
    expect(ctx._strokes).toBe(0);
    expect(ctx._lines.length).toBe(0);
  });

  it("paints NO leader for a non-tab inline-block (no inlineMeta)", () => {
    const ib = makeTabInlineBlock({ x: TAB_X, y: 0, width: TAB_W, height: 20 }); // leader undefined → no inlineMeta
    const root = makeBlock({ children: [ib] });

    paint(ctx, root);

    expect(ctx._arcs.length).toBe(0);
    expect(ctx._rects.length).toBe(0);
    expect(ctx._strokes).toBe(0);
    expect(ctx._lines.length).toBe(0);
  });
});
