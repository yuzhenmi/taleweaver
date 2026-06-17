/**
 * Home/End + Shift+Home/End caret-affinity wiring (Phase 0b). Home/End are LOGICAL
 * line-boundary commands: Home → `inlineOffsetStart`, End → `inlineOffsetEnd` in
 * BOTH directions. The resolver does NOT touch the offset; it sets a
 * direction-independent `caretAffinity` so the logical boundary RENDERS at the
 * correct visual edge of an RTL line, threaded through the SET_SELECTION it
 * dispatches (the central reset exempts SET_SELECTION, so the affinity survives
 * until the next edit clears it).
 *
 * Post-Phase-0b these drive the print backend's NavIntent resolver end-to-end
 * (driver layout → resolveNavIntent → reduceEditor), then cross-check the rendered
 * caret X via `resolvePixelPosition` against the driver layout. Migrated from
 * `packages/core/src/editor/actions/line-boundary-affinity.test.ts`; assertions
 * byte-identical (the layout SOURCE is the driver rebuild instead of
 * `editor.layoutTree`).
 */
import { describe, it, expect } from "vitest";
import { createPosition } from "@taleweaver/core";
import { resolvePixelPosition } from "../index";
import {
  makeNavEditor,
  typeText,
  caretAt,
  splitBlock,
  dispatch,
  nav,
  layoutOf,
  firstBlockId,
  type NavCtx,
} from "./nav-test-helpers";

function home(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_LINE_BOUNDARY", boundary: "start" });
}
function end(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_LINE_BOUNDARY", boundary: "end" });
}
function shiftHome(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "EXPAND_LINE_BOUNDARY", boundary: "start" });
}
function shiftEnd(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "EXPAND_LINE_BOUNDARY", boundary: "end" });
}

/** Rendered caret X for the editor's current focus, using its current affinity. */
function caretX(ctx: NavCtx): number {
  const r = resolvePixelPosition(
    ctx.editor.state,
    ctx.editor.selection.focus,
    layoutOf(ctx),
    ctx.measurer,
    ctx.editor.caretPageHint,
    ctx.editor.caretAffinity,
  );
  expect(r).not.toBeNull();
  return r?.x ?? NaN;
}

describe("MOVE_LINE_BOUNDARY — offset logic UNCHANGED (logical boundaries, both directions)", () => {
  it("LTR Home → inlineOffsetStart (0); End → inlineOffsetEnd", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 2);
    ctx = home(ctx);
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 0));

    ctx = end(ctx);
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 3));
  });

  it("RTL Home → logical START offset (NOT swapped); End → logical END offset", () => {
    // "אבג": one level-1 Hebrew run, [0,3). Home is the LOGICAL line start =
    // inlineOffsetStart = 0 (NOT inlineOffsetEnd). End = inlineOffsetEnd = 3.
    let ctx = typeText(makeNavEditor(), "אבג");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 1);
    ctx = home(ctx);
    expect(ctx.editor.selection.focus.offset).toBe(0); // logical start, NOT 3

    ctx = end(ctx);
    expect(ctx.editor.selection.focus.offset).toBe(3); // logical end, NOT 0
  });
});

describe("MOVE_LINE_BOUNDARY — caretAffinity (direction-independent: Home→after, End→before)", () => {
  it("LTR Home sets affinity 'after', End sets 'before'", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 1);
    ctx = home(ctx);
    expect(ctx.editor.caretAffinity).toBe("after");

    ctx = end(ctx);
    expect(ctx.editor.caretAffinity).toBe("before");
  });

  it("RTL Home sets affinity 'after', End sets 'before' (same values as LTR)", () => {
    let ctx = typeText(makeNavEditor(), "אבג");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 1);
    ctx = home(ctx);
    expect(ctx.editor.caretAffinity).toBe("after");

    ctx = end(ctx);
    expect(ctx.editor.caretAffinity).toBe("before");
  });
});

describe("MOVE_LINE_BOUNDARY — RTL caret renders at the correct visual edge", () => {
  it("RTL Home renders at the visual-RIGHT edge; End renders at the visual-LEFT edge", () => {
    // "אבג" at 8px/char → run x[0,24]. Logical start (offset 0) sits at the RTL
    // run's RIGHT edge (24); logical end (offset 3) sits at the LEFT edge (0).
    let ctx = typeText(makeNavEditor(), "אבג");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 1);
    ctx = home(ctx);
    const xHome = caretX(ctx);

    ctx = caretAt(ctx, pid, 1);
    ctx = end(ctx);
    const xEnd = caretX(ctx);

    // Visual-right (Home) is strictly greater than visual-left (End).
    expect(xHome).toBeGreaterThan(xEnd);
    expect(xHome).toBe(24); // right edge of the RTL run
    expect(xEnd).toBe(0); // left edge of the RTL run
  });
});

describe("MOVE_LINE_BOUNDARY — affinity lifecycle (survives reset; cleared by edit)", () => {
  it("MOVE_LINE_BOUNDARY threads an affinity that survives the central reset", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 1);
    ctx = home(ctx);
    // The reducer ran its central reset but kept the resolver-threaded affinity.
    expect(ctx.editor.caretAffinity).toBe("after");
  });

  it("a subsequent edit clears caretAffinity (central reset)", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 1);
    ctx = home(ctx);
    expect(ctx.editor.caretAffinity).toBe("after");
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "x" });
    expect(ctx.editor.caretAffinity).toBeUndefined();
  });
});

describe("EXPAND_LINE_BOUNDARY — Shift+Home/End (focus to boundary, anchor fixed, focus affinity set)", () => {
  it("Shift+End extends focus to inlineOffsetEnd, keeps anchor, sets affinity 'before'", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 1);
    const anchor = ctx.editor.selection.anchor;
    ctx = shiftEnd(ctx);
    expect(ctx.editor.selection.anchor).toEqual(anchor); // anchor fixed
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 3)); // logical end
    expect(ctx.editor.caretAffinity).toBe("before");
  });

  it("Shift+Home extends focus to inlineOffsetStart, keeps anchor, sets affinity 'after'", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 2);
    const anchor = ctx.editor.selection.anchor;
    ctx = shiftHome(ctx);
    expect(ctx.editor.selection.anchor).toEqual(anchor); // anchor fixed
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 0)); // logical start
    expect(ctx.editor.caretAffinity).toBe("after");
  });

  it("EXPAND_LINE_BOUNDARY affinity survives the reset and is cleared by a later edit", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 1);
    ctx = shiftEnd(ctx);
    expect(ctx.editor.caretAffinity).toBe("before");
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "x" });
    expect(ctx.editor.caretAffinity).toBeUndefined();
  });
});

describe("MOVE_LINE / EXPAND_LINE — vertical-nav threads the move-resolved affinity (#500)", () => {
  // ArrowUp/Down (MOVE_LINE) and Shift+ArrowUp/Down (EXPAND_LINE) seed
  // `caretAffinity` from the hit-test the line-move resolved at the target line,
  // so a caret landing on an offset shared across a soft-wrap / column boundary
  // renders on the line the move stepped onto. Post-Phase-0b the resolver threads
  // `result.caretAffinity` through the SET_SELECTION it dispatches (exempt from the
  // central reset). Pre-#500 the affinity was discarded.
  function twoParagraphs(): NavCtx {
    let ctx = typeText(makeNavEditor(), "abc");
    ctx = splitBlock(ctx); // Enter → 2nd paragraph
    return typeText(ctx, "def"); // caret at end of para 2
  }

  it("MOVE_LINE (ArrowUp) seeds a defined affinity that survives the reset and clears on edit", () => {
    let ctx = twoParagraphs();
    ctx = nav(ctx, { type: "MOVE_LINE", direction: "up" });
    // Threaded + managed → a concrete affinity survives (was `undefined` pre-#500).
    expect(ctx.editor.caretAffinity).toBeDefined();
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "x" });
    expect(ctx.editor.caretAffinity).toBeUndefined();
  });

  it("EXPAND_LINE (Shift+ArrowUp) seeds a defined focus affinity that survives the reset (symmetric twin)", () => {
    let ctx = twoParagraphs();
    const anchor = ctx.editor.selection.anchor;
    ctx = nav(ctx, { type: "EXPAND_LINE", direction: "up" });
    expect(ctx.editor.selection.anchor).toEqual(anchor); // anchor fixed (it's a selection-extend)
    expect(ctx.editor.caretAffinity).toBeDefined();
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "x" });
    expect(ctx.editor.caretAffinity).toBeUndefined();
  });
});
