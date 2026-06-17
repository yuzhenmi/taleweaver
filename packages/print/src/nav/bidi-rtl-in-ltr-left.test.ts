/**
 * Regression for the bidi LEFT-arrow warp (#502, Phase 0b): an RTL Hebrew run
 * embedded in an LTR paragraph and a pure-RTL word. Pressing ArrowLeft on/within
 * the RTL run must advance the caret VISUALLY-LEFTWARD (rendered x moves
 * monotonically left), never warp rightward.
 *
 * Two fixes are exercised: (1) in-run affinity (line-bidi) keeps an RTL run's
 * visual-left edge owned by THAT run; (2) exit logical direction steps
 * `moveByCharacter` bidi-correctly at a line edge. Post-Phase-0b these drive the
 * print backend's NavIntent resolver (driver layout → resolveNavIntent →
 * reduceEditor) and measure rendered caret-x via `resolvePixelPosition` against the
 * driver layout. Migrated from
 * `packages/core/src/editor/actions/bidi-rtl-in-ltr-left.test.ts`; assertions
 * byte-identical.
 */
import { describe, it, expect } from "vitest";
import { resolvePixelPosition } from "../index";
import {
  makeNavEditor,
  typeText,
  caretAt,
  nav,
  layoutOf,
  firstBlockId,
  type NavCtx,
} from "./nav-test-helpers";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function left(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_CURSOR", direction: "backward" });
}
function right(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_CURSOR", direction: "forward" });
}

/** Rendered caret x for the current collapsed caret, threading caretAffinity. */
function caretX(ctx: NavCtx): number {
  const px = resolvePixelPosition(
    ctx.editor.state,
    ctx.editor.selection.focus,
    layoutOf(ctx),
    ctx.measurer,
    ctx.editor.caretPageHint,
    ctx.editor.caretAffinity,
  );
  if (px === null) throw new Error("no pixel position");
  return px.x;
}

/** Assert the caret-x sequence is non-increasing within `tol` (monotone left). */
function expectNonIncreasing(xs: readonly number[]): void {
  for (let i = 1; i < xs.length; i++) {
    expect(nth(xs, i, "x")).toBeLessThanOrEqual(nth(xs, i - 1, "x") + 1e-6);
  }
}
/** Assert the caret-x sequence is non-decreasing within `tol` (monotone right). */
function expectNonDecreasing(xs: readonly number[]): void {
  for (let i = 1; i < xs.length; i++) {
    expect(nth(xs, i, "x")).toBeGreaterThanOrEqual(nth(xs, i - 1, "x") - 1e-6);
  }
}

describe("MOVE_CURSOR — RTL run inside LTR paragraph (#502)", () => {
  it("LEFT from the boundary owned by the Hebrew run steps monotonically left (no warp)", () => {
    // "ab זאב cd": "ab " [0,3) LTR, "זאב" [3,6) RTL, " cd" [6,9) LTR. Visual L→R:
    // a b _ ב א ז _ c d. Offset 3 with "after" affinity belongs to the Hebrew
    // run (its visual-RIGHT edge) — the state after walking RIGHT into the run.
    let ctx = typeText(makeNavEditor(), "ab זאב cd");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 3);
    ctx = { ...ctx, editor: { ...ctx.editor, caretAffinity: "after" } };

    const xs: number[] = [caretX(ctx)];
    for (let i = 0; i < 7; i++) {
      ctx = left(ctx);
      xs.push(caretX(ctx));
    }
    // Pre-fix this oscillated 48→40→32→48(warp)→…; the fix makes it monotone.
    expectNonIncreasing(xs);
    // And it actually progresses past the Hebrew run to its visual left and beyond.
    expect(nth(xs, xs.length - 1, "x")).toBeLessThan(nth(xs, 0, "x"));
  });

  it("LEFT from the LTR tail walks monotonically left across the whole line", () => {
    let ctx = typeText(makeNavEditor(), "ab זאב cd");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 9); // visual far right

    const xs: number[] = [caretX(ctx)];
    for (let i = 0; i < 9; i++) {
      ctx = left(ctx);
      xs.push(caretX(ctx));
    }
    expectNonIncreasing(xs);
  });
});

describe("MOVE_CURSOR — pure-RTL word in an LTR paragraph (#502 exit-direction)", () => {
  it("LEFT walks all the way through and STAYS at the visual-left edge (no warp back)", () => {
    // "זאב" is a single RTL run inside an LTR paragraph. Visual L→R: ב א ז.
    // logStart(0)=visual-RIGHT edge, logEnd(3)=visual-LEFT edge.
    let ctx = typeText(makeNavEditor(), "זאב");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 0); // visual-right edge

    const xs: number[] = [caretX(ctx)];
    for (let i = 0; i < 5; i++) {
      ctx = left(ctx);
      xs.push(caretX(ctx));
    }
    // Monotone left through 0→1→2→3, then it must NOT warp back rightward.
    expectNonIncreasing(xs);
    expect(ctx.editor.selection.focus.offset).toBe(3); // logical end = visual-left edge
  });

  it("RIGHT walks monotonically right and STAYS at the visual-right edge (no warp back)", () => {
    let ctx = typeText(makeNavEditor(), "זאב");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 3); // logical end = visual-left edge

    const xs: number[] = [caretX(ctx)];
    for (let i = 0; i < 5; i++) {
      ctx = right(ctx);
      xs.push(caretX(ctx));
    }
    // Pre-fix RIGHT oscillated 0↔1 forever; now it walks 3→2→1→0 (visual right)
    // and pins at the visual-right edge (offset 0).
    expectNonDecreasing(xs);
    expect(ctx.editor.selection.focus.offset).toBe(0);
  });
});
