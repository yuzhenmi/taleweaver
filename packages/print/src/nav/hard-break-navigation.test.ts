/**
 * Hard-break (`<br>`) caret / selection / hit-test / line-navigation behavior
 * (#504, Phase 0b). A hard-break embed (`HARD_BREAK_EMBED_TYPE`) is ONE
 * state-model offset (one cursor stop) that the IFC turns into a FORCED line
 * break. These VERIFY — through the print backend's NavIntent resolver (driver
 * layout → resolveNavIntent → reduceEditor) and the real cursor modules (hit-test,
 * cursor-position) — that caret motion, Home/End, line-nav, hit-test, and selection
 * behave correctly ACROSS the break.
 *
 * Model: paragraph inlineContent = [ text "AB", hard-break embed, text "CD" ].
 * Offsets: A=0..1, B=1..2, hard-break=2..3 (one unit), C=3..4, D=4..5; block
 * length 5. Lays out as TWO visual lines — "AB" (line 0, offsets [0,2]) and "CD"
 * (line 1, offsets [3,5]) — with the break occupying offset 2→3.
 *
 * Migrated from `packages/core/src/editor/actions/hard-break-navigation.test.ts`.
 * The fixture is rebuilt via the dom package's `decodeHtml` (the real clipboard
 * decode path — `<p>AB<br>CD</p>` → one paragraph with the hard-break embed),
 * since core's `buildState`/`embed` test-utils don't cross the package boundary.
 * Assertions byte-identical; the layout SOURCE is the driver rebuild.
 */
import { describe, it, expect } from "vitest";
import { createPosition, getBlock, productionAllocator, decodeHtml, type BlockId } from "@taleweaver/core";
import { resolvePositionFromPixel, resolvePixelPosition } from "../index";
import { browserHtmlParser } from "../html-parser";
import {
  makeNavEditorFromState,
  caretAt as caretAtHelper,
  nav,
  layoutOf,
  firstBlockId,
  type NavCtx,
} from "./nav-test-helpers";

const CHAR_W = 8;
const LINE_H = 16;

/** A fresh nav context over one paragraph "AB" <hard-break> "CD" (block length 5). */
function hardBreakCtx(): { ctx: NavCtx; para: BlockId } {
  const state = decodeHtml("<p>AB<br>CD</p>", productionAllocator, browserHtmlParser);
  const ctx = makeNavEditorFromState(state, {
    containerWidth: 200,
    charWidth: CHAR_W,
    lineHeight: LINE_H,
  });
  return { ctx, para: firstBlockId(ctx) };
}

/** Place a collapsed caret at `offset` in the (single) paragraph. */
function caretAt(ctx: NavCtx, para: BlockId, offset: number): NavCtx {
  return caretAtHelper(ctx, para, offset);
}

function right(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_CURSOR", direction: "forward" });
}
function left(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_CURSOR", direction: "backward" });
}
function down(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_LINE", direction: "down" });
}
function up(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_LINE", direction: "up" });
}

/** Rendered caret pixel position for the editor's current focus. */
function caretPixel(ctx: NavCtx) {
  const r = resolvePixelPosition(
    ctx.editor.state,
    ctx.editor.selection.focus,
    layoutOf(ctx),
    ctx.measurer,
    ctx.editor.caretPageHint,
    ctx.editor.caretAffinity,
  );
  if (r === null) throw new Error("caret did not resolve");
  return r;
}

describe("hard-break — layout is two visual lines", () => {
  it("offset 2 (end of AB) and offset 3 (start of CD) sit on DIFFERENT lines", () => {
    const { ctx, para } = hardBreakCtx();

    const endOfAB = caretPixel(caretAt(ctx, para, 2));
    const startOfCD = caretPixel(caretAt(ctx, para, 3));

    // The break forces a new line: offset 3 is one line-height BELOW offset 2.
    expect(startOfCD.lineY).toBeGreaterThan(endOfAB.lineY);
    expect(startOfCD.lineY - endOfAB.lineY).toBeCloseTo(LINE_H, 5);
    // ...and offset 3 is at the line's inline start (x === 0), not glued after "AB".
    expect(startOfCD.x).toBeCloseTo(0, 5);
    expect(endOfAB.x).toBeCloseTo(2 * CHAR_W, 5);
  });
});

describe("hard-break — caret across the break (MOVE_CURSOR)", () => {
  it("ArrowRight from end of line 0 (offset 2) lands at start of line 1 (offset 3) in ONE step", () => {
    const { ctx, para } = hardBreakCtx();
    const moved = right(caretAt(ctx, para, 2));
    expect(moved.editor.selection.focus).toEqual(createPosition(para, 3));
    expect(moved.editor.selection.anchor).toEqual(createPosition(para, 3));
  });

  it("ArrowLeft from start of line 1 (offset 3) returns to end of line 0 (offset 2)", () => {
    const { ctx, para } = hardBreakCtx();
    const moved = left(caretAt(ctx, para, 3));
    expect(moved.editor.selection.focus).toEqual(createPosition(para, 2));
  });

  it("ArrowRight from inside AB to past the break walks 0→1→2→3→4 (the break is one stop)", () => {
    const { ctx, para } = hardBreakCtx();
    let cur = caretAt(ctx, para, 0);
    const seen: number[] = [cur.editor.selection.focus.offset];
    for (let i = 0; i < 4; i++) {
      cur = right(cur);
      seen.push(cur.editor.selection.focus.offset);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("hard-break — Home/End resolve per sub-line (MOVE_LINE_BOUNDARY)", () => {
  function home(ctx: NavCtx): NavCtx {
    return nav(ctx, { type: "MOVE_LINE_BOUNDARY", boundary: "start" });
  }
  function end(ctx: NavCtx): NavCtx {
    return nav(ctx, { type: "MOVE_LINE_BOUNDARY", boundary: "end" });
  }

  it("End on line 0 (caret in AB) → line 0's inlineOffsetEnd (offset 3, owning the break) — NOT end of block — and renders at the VISUAL end of line 0", () => {
    const { ctx, para } = hardBreakCtx();
    const moved = end(caretAt(ctx, para, 1)); // inside "AB"
    expect(moved.editor.selection.focus).toEqual(createPosition(para, 3));
    expect(moved.editor.caretAffinity).toBe("before");
    const px = caretPixel(moved);
    // "before" affinity pins the offset-3 boundary to the END of line 0.
    expect(px.x).toBeCloseTo(2 * CHAR_W, 5);
    const startOfCD = caretPixel(caretAt(ctx, para, 3)); // affinity "after" → line 1
    expect(px.lineY).toBeLessThan(startOfCD.lineY);
  });

  it("Home on line 1 (caret in CD) → start of CD (offset 3), NOT start of block — and renders at the start of line 1", () => {
    const { ctx, para } = hardBreakCtx();
    const moved = home(caretAt(ctx, para, 4)); // inside "CD"
    expect(moved.editor.selection.focus).toEqual(createPosition(para, 3));
    expect(moved.editor.caretAffinity).toBe("after");
    const px = caretPixel(moved);
    expect(px.x).toBeCloseTo(0, 5);
    const endOfAB = caretPixel(caretAt(ctx, para, 2)); // line 0
    expect(px.lineY).toBeGreaterThan(endOfAB.lineY);
  });

  it("End on line 1 → end of block (offset 5)", () => {
    const { ctx, para } = hardBreakCtx();
    const moved = end(caretAt(ctx, para, 4));
    expect(moved.editor.selection.focus).toEqual(createPosition(para, 5));
  });
});

describe("hard-break — line navigation across the break (MOVE_LINE)", () => {
  it("ArrowDown from line 0 lands on line 1 at a corresponding x (goal-x preserved)", () => {
    const { ctx, para } = hardBreakCtx();
    // Caret at offset 1 (between A and B) → x = 1*CHAR_W on line 0.
    const seated = caretAt(ctx, para, 1);
    const before = caretPixel(seated);

    const moved = down(seated);
    expect(moved.editor.selection.focus.blockId).toBe(para);
    expect(moved.editor.selection.focus.offset).toBe(4);
    const after = caretPixel(moved);
    expect(after.lineY).toBeGreaterThan(before.lineY);
    expect(after.x).toBeCloseTo(before.x, 5);
  });

  it("ArrowUp from line 1 returns to line 0 at the corresponding x", () => {
    const { ctx, para } = hardBreakCtx();
    const seated = caretAt(ctx, para, 4); // between C and D on line 1
    const before = caretPixel(seated);

    const moved = up(seated);
    expect(moved.editor.selection.focus.offset).toBe(1); // between A and B
    const after = caretPixel(moved);
    expect(after.lineY).toBeLessThan(before.lineY);
    expect(after.x).toBeCloseTo(before.x, 5);
  });
});

describe("hard-break — hit-test lands on the clicked sub-line", () => {
  it("a click on line 1's CD resolves to an offset within CD (>= 3)", () => {
    const { ctx, para } = hardBreakCtx();
    const lt = layoutOf(ctx);
    if (lt.type === "virtual-root") {
      throw new Error("test expects a materialized (non-virtual) layout tree for a one-page doc");
    }

    const startOfCD = caretPixel(caretAt(ctx, para, 3));
    const x = startOfCD.x + CHAR_W; // between C and D
    const y = startOfCD.lineY + LINE_H / 2;

    const hit = resolvePositionFromPixel(ctx.editor.state, lt, ctx.measurer, x, y);
    expect(hit).not.toBeNull();
    expect(hit?.position.blockId).toBe(para);
    expect(hit?.position.offset).toBeGreaterThanOrEqual(3);
    expect(hit?.position.offset).toBeLessThanOrEqual(5);
  });

  it("a click on line 0's AB resolves to an offset within AB (<= 2)", () => {
    const { ctx, para } = hardBreakCtx();
    const lt = layoutOf(ctx);
    if (lt.type === "virtual-root") {
      throw new Error("test expects a materialized layout tree");
    }
    const endOfAB = caretPixel(caretAt(ctx, para, 2));
    const x = CHAR_W; // between A and B
    const y = endOfAB.lineY + LINE_H / 2;

    const hit = resolvePositionFromPixel(ctx.editor.state, lt, ctx.measurer, x, y);
    expect(hit?.position.blockId).toBe(para);
    expect(hit?.position.offset).toBeGreaterThanOrEqual(0);
    expect(hit?.position.offset).toBeLessThanOrEqual(2);
  });
});

describe("hard-break — selection spans the break (EXPAND_SELECTION / EXPAND_LINE)", () => {
  it("Shift+ArrowRight from end of line 0 (offset 2) extends the focus past the break into CD", () => {
    const { ctx, para } = hardBreakCtx();
    const seated = caretAt(ctx, para, 2);
    const expanded = nav(seated, { type: "EXPAND_SELECTION", direction: "forward" });
    expect(expanded.editor.selection.anchor).toEqual(createPosition(para, 2));
    expect(expanded.editor.selection.focus).toEqual(createPosition(para, 3));
  });

  it("Shift+ArrowDown from line 0 extends the selection onto line 1 (focus reaches into CD)", () => {
    const { ctx, para } = hardBreakCtx();
    const seated = caretAt(ctx, para, 1); // line 0, between A and B
    const expanded = nav(seated, { type: "EXPAND_LINE", direction: "down" });
    expect(expanded.editor.selection.anchor).toEqual(createPosition(para, 1));
    expect(expanded.editor.selection.focus.blockId).toBe(para);
    expect(expanded.editor.selection.focus.offset).toBeGreaterThanOrEqual(3);
  });

  it("the spanning selection actually covers the break offset (2→3 contiguous)", () => {
    const { ctx, para } = hardBreakCtx();
    let expanded = nav(caretAt(ctx, para, 2), { type: "EXPAND_SELECTION", direction: "forward" });
    expanded = nav(expanded, { type: "EXPAND_SELECTION", direction: "forward" });
    expect(expanded.editor.selection.anchor.offset).toBe(2);
    expect(expanded.editor.selection.focus.offset).toBe(4);
    const block = getBlock(expanded.editor.state, para);
    expect(block?.inlineContent?.items.length).toBe(3);
  });
});
