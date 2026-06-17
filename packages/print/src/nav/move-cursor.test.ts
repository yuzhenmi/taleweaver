/**
 * MOVE_CURSOR nav tests (Phase 0b): ArrowLeft/Right perform VISUAL-order caret
 * motion through bidi-reordered lines, with the dual-caret boundary affinity,
 * while pure-LTR motion stays byte-identical to the prior logical ±1-grapheme
 * behavior.
 *
 * Post-Phase-0b these drive the print backend's NavIntent resolver end-to-end
 * (driver layout → resolveNavIntent → reduceEditor), covering the wiring (line
 * resolution, grapheme stepper, affinity threading, central-reset exemption) —
 * not just the pure primitive in core's line-bidi.test.ts. Migrated from
 * `packages/core/src/editor/actions/move-cursor.test.ts`; assertions byte-identical.
 */
import { describe, it, expect } from "vitest";
import { createPosition } from "@taleweaver/core";
import {
  makeNavEditor,
  typeText,
  caretAt,
  dispatch,
  nav,
  firstBlockId,
  type NavCtx,
} from "./nav-test-helpers";

function right(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_CURSOR", direction: "forward" });
}
function left(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_CURSOR", direction: "backward" });
}

/** Compact "(offset/affinity)" snapshot of the collapsed caret. */
function snap(ctx: NavCtx): string {
  return `${ctx.editor.selection.focus.offset}/${ctx.editor.caretAffinity ?? "none"}`;
}

describe("MOVE_CURSOR — pure-LTR (byte-identical to logical motion)", () => {
  it("ArrowRight advances one offset; ArrowLeft retreats", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 0);
    ctx = right(ctx);
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 1));
    ctx = right(ctx);
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 2));

    ctx = left(ctx);
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 1));
  });

  it("expanded selection + ArrowRight collapses to the end (no move)", () => {
    let ctx = typeText(makeNavEditor(), "abcdef");
    const pid = firstBlockId(ctx);
    const sel = {
      anchor: createPosition(pid, 1),
      focus: createPosition(pid, 4),
    };
    ctx = dispatch(ctx, { type: "SET_SELECTION", selection: sel });

    ctx = right(ctx);
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 4));
    expect(ctx.editor.selection.anchor).toEqual(createPosition(pid, 4));

    // And ArrowLeft on an expanded selection collapses to the start.
    ctx = dispatch(ctx, { type: "SET_SELECTION", selection: sel });
    ctx = left(ctx);
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 1));
  });
});

describe("MOVE_CURSOR — uniform-RTL", () => {
  it("ArrowRight moves toward logical START (offset−1)", () => {
    let ctx = typeText(makeNavEditor(), "אבג");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 3);
    ctx = right(ctx);
    expect(ctx.editor.selection.focus.offset).toBe(2);
    ctx = right(ctx);
    expect(ctx.editor.selection.focus.offset).toBe(1);
    ctx = right(ctx);
    expect(ctx.editor.selection.focus.offset).toBe(0);
  });

  it("ArrowLeft moves toward logical END (offset+1)", () => {
    let ctx = typeText(makeNavEditor(), "אבג");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 0);
    ctx = left(ctx);
    expect(ctx.editor.selection.focus.offset).toBe(1);
    ctx = left(ctx);
    expect(ctx.editor.selection.focus.offset).toBe(2);
  });
});

describe("MOVE_CURSOR — mixed LTR+RTL (the dual-caret boundary)", () => {
  it("ArrowRight from offset 0 walks the visual glyph order incl. the flip", () => {
    // "abcאבג": Latin [0,3) LTR, Hebrew [3,6) RTL. Glyphs L→R: a b c ג ב א. The
    // sequence is derived + locked in core's line-bidi.test.ts; here we confirm
    // the NavIntent resolver threads (offset, caretAffinity) through the same way.
    let ctx = typeText(makeNavEditor(), "abcאבג");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 0);

    const seq: string[] = [];
    for (let i = 0; i < 7; i++) {
      ctx = right(ctx);
      seq.push(snap(ctx));
    }
    expect(seq).toEqual([
      "1/before",
      "2/before",
      "3/before",
      "6/before", // dual-caret flip into the Hebrew run (same x, different offset)
      "5/after",
      "4/after",
      "3/after",
    ]);
  });

  it("same-parity boundary (bold/plain split) advances with NO affinity flip", () => {
    // Type "abcd", bold the first two chars → two adjacent LTR runs.
    let ctx = typeText(makeNavEditor(), "abcd");
    const pid = firstBlockId(ctx);
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: { anchor: createPosition(pid, 0), focus: createPosition(pid, 2) },
    });
    ctx = dispatch(ctx, { type: "TOGGLE_STYLE", style: "bold" });

    ctx = caretAt(ctx, pid, 2);
    ctx = right(ctx);
    // Advances to 3 immediately — never a same-offset (2/2) flip.
    expect(ctx.editor.selection.focus.offset).toBe(3);
  });
});

describe("MOVE_CURSOR — affinity lifecycle", () => {
  it("sets caretAffinity at a bidi boundary and the central reset preserves it", () => {
    let ctx = typeText(makeNavEditor(), "abcאבג");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 0);
    // Three ArrowRights land at the Latin run's right edge (offset 3, "before").
    ctx = right(ctx);
    ctx = right(ctx);
    ctx = right(ctx);
    expect(ctx.editor.caretAffinity).toBe("before");
  });

  it("a subsequent edit clears caretAffinity (central reset)", () => {
    let ctx = typeText(makeNavEditor(), "abcאבג");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 0);
    ctx = right(ctx); // 1/before
    ctx = right(ctx); // 2/before
    ctx = right(ctx); // 3/before (Latin right edge)
    ctx = right(ctx); // flips into the Hebrew run → 6/before
    expect(ctx.editor.caretAffinity).toBeDefined();
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "x" });
    expect(ctx.editor.caretAffinity).toBeUndefined();
  });
});
