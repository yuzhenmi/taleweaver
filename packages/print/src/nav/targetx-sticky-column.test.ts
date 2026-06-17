// packages/print/src/nav/targetx-sticky-column.test.ts
//
// Phase 0b sticky goal-column (`targetX`) regression. A vertical line-move
// (`MOVE_LINE`) remembers the caret's pixel column so consecutive ArrowUp/Down
// keep returning to it even when an intervening line is too short to reach it —
// Google Docs / every word-processor behavior. With the geometry split, the
// backend's `resolveMoveLine` computes the move's `targetX` and threads it into
// the `SET_SELECTION` it dispatches; `reduceEditor`'s entry `targetX`-clear
// EXEMPTS `SET_SELECTION`, so the goal column survives across two
// backend-dispatched line-moves. If it were cleared between moves, the caret on
// line 3 would sit at line 2's short clamped column instead of the original.
import { describe, it, expect } from "vitest";
import { createPosition, createSpan } from "@taleweaver/core";
import { resolvePixelPosition } from "../index";
import {
  makeNavEditor,
  dispatch,
  nav,
  layoutOf,
  focusOf,
  firstBlockId,
  type NavCtx,
} from "./nav-test-helpers";

/** The caret's pixel X on its line (the goal column targetX preserves). */
function caretX(ctx: NavCtx): number {
  const px = resolvePixelPosition(ctx.editor.state, ctx.editor.selection.focus, layoutOf(ctx), ctx.measurer);
  if (px === null) throw new Error("caret did not resolve to a pixel position");
  return px.x;
}

describe("MOVE_LINE sticky goal-column (targetX) survives consecutive line-moves", () => {
  it("ArrowDown past a short line, then again, returns the caret to the original high column", () => {
    // Three hard-break paragraphs: LONG, SHORT, LONG. Line 2 is too short to
    // reach the column the caret holds on lines 1 and 3.
    const LONG = "the quick brown fox jumps over lazy"; // 35 chars
    const SHORT = "ab"; // 2 chars
    let ctx = makeNavEditor({ containerWidth: 800, charWidth: 8, lineHeight: 16 });
    const line1Id = firstBlockId(ctx);

    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: LONG });
    ctx = dispatch(ctx, { type: "SPLIT_NODE" });
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: SHORT });
    ctx = dispatch(ctx, { type: "SPLIT_NODE" });
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: LONG });

    // Caret near the END of line 1 (a high column line 2 can't reach).
    const highOffset = LONG.length - 2; // 33
    const startPos = createPosition(line1Id, highOffset);
    ctx = dispatch(ctx, { type: "SET_SELECTION", selection: createSpan(startPos, startPos) });
    const line1Id_check = focusOf(ctx).blockId;
    expect(line1Id_check).toBe(line1Id);
    const goalX = caretX(ctx);
    expect(goalX).toBeGreaterThan(SHORT.length * 8); // genuinely past line 2's extent

    // Down → line 2 (the short line), clamped to its end.
    ctx = nav(ctx, { type: "MOVE_LINE", direction: "down" });
    const line2 = focusOf(ctx);
    expect(line2.blockId).not.toBe(line1Id);
    // Clamped to the short line's content edge (well left of the goal column).
    expect(caretX(ctx)).toBeLessThan(goalX);
    expect(line2.offset).toBeLessThanOrEqual(SHORT.length);

    // Down again → line 3 (the second LONG line). The sticky targetX restores
    // the original high column; without it the caret would stay at line 2's
    // short clamped column.
    ctx = nav(ctx, { type: "MOVE_LINE", direction: "down" });
    const line3 = focusOf(ctx);
    expect(line3.blockId).not.toBe(line2.blockId);
    // The caret returns to the original goal column (same pixel X) — and thus
    // the same logical offset within the identical-content line 3.
    expect(caretX(ctx)).toBe(goalX);
    expect(line3.offset).toBe(highOffset);
  });
});
