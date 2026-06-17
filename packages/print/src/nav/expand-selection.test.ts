/**
 * EXPAND_SELECTION nav tests (Phase 0b): Shift+ArrowLeft/Right extend the
 * selection FOCUS in VISUAL order through bidi-reordered lines (coherent with
 * MOVE_CURSOR's caret motion), keeping the ANCHOR fixed; pure-LTR extension stays
 * byte-identical to the prior logical ±1-grapheme focus motion.
 *
 * Post-Phase-0b these drive the print backend's NavIntent resolver end-to-end
 * (driver layout → resolveNavIntent → reduceEditor), covering the wiring (line
 * resolution, grapheme stepper, affinity threading) — not just the pure primitive
 * in core's line-bidi.test.ts. Migrated from
 * `packages/core/src/editor/actions/expand-selection.test.ts`; assertions
 * byte-identical. The affinity-lifecycle describes exercise reduceEditor's central
 * reset (now keyed on the single affinity-managing action SET_SELECTION, which the
 * resolver threads through), so they go through `nav` (resolver→SET_SELECTION) and
 * `dispatch` (direct reducer) as appropriate.
 */
import { describe, it, expect } from "vitest";
import { createPosition, createSpan } from "@taleweaver/core";
import {
  makeNavEditor,
  typeText,
  caretAt,
  dispatch,
  nav,
  firstBlockId,
  type NavCtx,
} from "./nav-test-helpers";

function expandRight(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "EXPAND_SELECTION", direction: "forward" });
}
function expandLeft(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "EXPAND_SELECTION", direction: "backward" });
}
function moveRight(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "MOVE_CURSOR", direction: "forward" });
}

/** Compact "(focusOffset/affinity)" snapshot of the moving head. */
function snap(ctx: NavCtx): string {
  return `${ctx.editor.selection.focus.offset}/${ctx.editor.caretAffinity ?? "none"}`;
}

/** Overwrite the context's editor's anchorAffinity (slice-3 plumbing helper). */
function withAnchorAffinity(ctx: NavCtx, value: "before" | "after"): NavCtx {
  return { ...ctx, editor: { ...ctx.editor, anchorAffinity: value } };
}

/** Overwrite the context's editor's caretAffinity (collapse→extend seed setup). */
function withCaretAffinity(ctx: NavCtx, value: "before" | "after"): NavCtx {
  return { ...ctx, editor: { ...ctx.editor, caretAffinity: value } };
}

describe("EXPAND_SELECTION — pure-LTR (byte-identical to logical focus motion)", () => {
  it("Shift+ArrowRight extends the focus forward (offset+1); Shift+ArrowLeft backward; anchor fixed", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 0);
    ctx = expandRight(ctx);
    expect(ctx.editor.selection.anchor).toEqual(createPosition(pid, 0));
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 1));
    ctx = expandRight(ctx);
    expect(ctx.editor.selection.anchor).toEqual(createPosition(pid, 0)); // anchor fixed
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 2));

    ctx = expandLeft(ctx);
    expect(ctx.editor.selection.anchor).toEqual(createPosition(pid, 0)); // anchor fixed
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 1));
  });

  it("extends an already-expanded selection from its focus (anchor stays put)", () => {
    let ctx = typeText(makeNavEditor(), "abcdef");
    const pid = firstBlockId(ctx);
    const sel = createSpan(createPosition(pid, 1), createPosition(pid, 3));
    ctx = dispatch(ctx, { type: "SET_SELECTION", selection: sel });

    ctx = expandRight(ctx);
    expect(ctx.editor.selection.anchor).toEqual(createPosition(pid, 1));
    expect(ctx.editor.selection.focus).toEqual(createPosition(pid, 4));
  });
});

describe("EXPAND_SELECTION — uniform-RTL", () => {
  it("Shift+ArrowRight extends the focus visual-right = logical-backward (offset−1)", () => {
    let ctx = typeText(makeNavEditor(), "אבג");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 3);
    ctx = expandRight(ctx);
    expect(ctx.editor.selection.anchor).toEqual(createPosition(pid, 3)); // anchor fixed
    expect(ctx.editor.selection.focus.offset).toBe(2);
    ctx = expandRight(ctx);
    expect(ctx.editor.selection.anchor).toEqual(createPosition(pid, 3)); // anchor fixed
    expect(ctx.editor.selection.focus.offset).toBe(1);
    ctx = expandRight(ctx);
    expect(ctx.editor.selection.focus.offset).toBe(0);
  });

  it("Shift+ArrowLeft extends the focus visual-left = logical-forward (offset+1)", () => {
    let ctx = typeText(makeNavEditor(), "אבג");
    const pid = firstBlockId(ctx);

    ctx = caretAt(ctx, pid, 0);
    ctx = expandLeft(ctx);
    expect(ctx.editor.selection.anchor).toEqual(createPosition(pid, 0));
    expect(ctx.editor.selection.focus.offset).toBe(1);
    ctx = expandLeft(ctx);
    expect(ctx.editor.selection.focus.offset).toBe(2);
  });
});

describe("EXPAND_SELECTION — mixed LTR+RTL (the dual-caret boundary, focus head)", () => {
  it("Shift+ArrowRight from offset 0 walks the visual glyph order incl. the flip; anchor fixed", () => {
    // "abcאבג": Latin [0,3) LTR, Hebrew [3,6) RTL. Glyphs L→R: a b c ג ב א. The
    // focus follows the SAME moveVisually sequence as the collapsed caret in
    // move-cursor.test.ts / line-bidi.test.ts; the anchor stays at 0 throughout.
    let ctx = typeText(makeNavEditor(), "abcאבג");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 0);

    const seq: string[] = [];
    for (let i = 0; i < 7; i++) {
      ctx = expandRight(ctx);
      seq.push(snap(ctx));
      // Anchor never moves.
      expect(ctx.editor.selection.anchor).toEqual(createPosition(pid, 0));
    }
    expect(seq).toEqual([
      "1/before", // within latin
      "2/before",
      "3/before", // latin right edge
      "6/before", // dual-caret flip into the Hebrew run (same x, different offset)
      "5/after", // within hebrew, moving visual-right = logical-backward
      "4/after",
      "3/after", // hebrew right edge (logStart)
    ]);
    // TODO(C.2.7 browser-confirm): the cross-line/edge visual target is carried
    // from C.2.3 as a logical fallback; confirm against Google Docs.
  });
});

describe("EXPAND_SELECTION — coherence with MOVE_CURSOR (C.2.3)", () => {
  it("the extended focus lands where a plain ArrowRight caret would (same visual direction)", () => {
    // Uniform-RTL: confirm Shift+ArrowRight's focus tracks ArrowRight's caret.
    const base = typeText(makeNavEditor(), "אבג");
    const pid = firstBlockId(base);

    let caretCtx = caretAt(base, pid, 3);
    let selCtx = caretAt(base, pid, 3);
    for (let i = 0; i < 3; i++) {
      caretCtx = moveRight(caretCtx);
      selCtx = expandRight(selCtx);
      expect(selCtx.editor.selection.focus.offset).toBe(caretCtx.editor.selection.focus.offset);
    }
    // And the mixed line: the focus walks the same offsets as the caret.
    const baseMixed = typeText(makeNavEditor(), "abcאבג");
    const pidMixed = firstBlockId(baseMixed);
    let caretMixed = caretAt(baseMixed, pidMixed, 0);
    let selMixed = caretAt(baseMixed, pidMixed, 0);
    for (let i = 0; i < 7; i++) {
      caretMixed = moveRight(caretMixed);
      selMixed = expandRight(selMixed);
      expect(selMixed.editor.selection.focus.offset).toBe(caretMixed.editor.selection.focus.offset);
      expect(selMixed.editor.caretAffinity).toBe(caretMixed.editor.caretAffinity);
    }
  });
});

describe("EditorState.anchorAffinity lifecycle (#503 slice 3)", () => {
  // Post-Phase-0b the affinity reset/preserve is keyed on the single
  // affinity-managing action SET_SELECTION (the resolver threads it). A nav intent
  // that COLLAPSES resolves to a SET_SELECTION with anchorAffinity:undefined
  // (clearing it); EXPAND_LINE resolves to a SET_SELECTION threading the seed
  // (preserving it). The pure non-nav actions (INSERT_TEXT, programmatic
  // SET_SELECTION) exercise the central reset directly.

  it("a non-managing action (INSERT_TEXT) clears anchorAffinity (central reset)", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 1);
    ctx = withAnchorAffinity(ctx, "after");
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "x" });
    expect(ctx.editor.anchorAffinity).toBeUndefined();
  });

  it("SET_SELECTION clears anchorAffinity (a new anchor has no bidi context)", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);
    ctx = withAnchorAffinity(ctx, "after");
    const pos = createPosition(pid, 1);
    ctx = dispatch(ctx, { type: "SET_SELECTION", selection: createSpan(pos, pos) });
    expect(ctx.editor.anchorAffinity).toBeUndefined();
  });

  it("MOVE_CURSOR clears anchorAffinity (resolves to a collapsing SET_SELECTION)", () => {
    // MOVE_CURSOR collapses the selection; the resolver's SET_SELECTION passes
    // anchorAffinity:undefined → the stale seed is cleared.
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 1);
    ctx = withAnchorAffinity(ctx, "after");
    ctx = moveRight(ctx);
    expect(ctx.editor.anchorAffinity).toBeUndefined();
  });

  it("MOVE_LINE_BOUNDARY clears anchorAffinity", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 1);
    ctx = withAnchorAffinity(ctx, "after");
    ctx = nav(ctx, { type: "MOVE_LINE_BOUNDARY", boundary: "start" });
    expect(ctx.editor.anchorAffinity).toBeUndefined();
  });

  it("MOVE_LINE clears anchorAffinity (collapses → anchor has no bidi context)", () => {
    // "abc\ndef": the literal "\n" forces a within-block second line, so MOVE_LINE
    // down has a genuine line to land on (byte-identical to the original setup).
    let ctx = typeText(makeNavEditor(), "abc\ndef");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 1);
    ctx = withAnchorAffinity(ctx, "after");
    const before = ctx.editor.selection.focus;
    ctx = nav(ctx, { type: "MOVE_LINE", direction: "down" });
    // MOVE_LINE actually moved (not a no-op early return) and cleared the stale seed.
    expect(ctx.editor.selection.focus).not.toEqual(before);
    expect(ctx.editor.anchorAffinity).toBeUndefined();
  });

  it("EXPAND_LINE PRESERVES anchorAffinity (resolver threads the seed)", () => {
    let ctx = typeText(makeNavEditor(), "abc\ndef");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 1);
    ctx = withAnchorAffinity(ctx, "after");
    const before = ctx.editor.selection.focus;
    ctx = nav(ctx, { type: "EXPAND_LINE", direction: "down" });
    // EXPAND_LINE moved the focus (so it was not a no-op early return) and kept
    // the anchorAffinity seed.
    expect(ctx.editor.selection.focus).not.toEqual(before);
    expect(ctx.editor.anchorAffinity).toBe("after");
  });
});

describe("EditorState.anchorAffinity seeding (#503 slice 4)", () => {
  // The NavIntent resolver SEEDS anchorAffinity (via seedAnchorAffinity) on the
  // collapse→extend transition (anchor inherits the caret's affinity) and PERSISTS
  // it on continued extension, threading it through the SET_SELECTION it dispatches.

  it("seeds anchorAffinity from caretAffinity on the collapse→extend transition", () => {
    // "abcאבג": a bidi boundary exists at offset 3. Start collapsed at offset 3
    // with caretAffinity:"after"; the first EXPAND_SELECTION (isCollapsed) seeds
    // anchorAffinity from the caret's boundary side.
    let ctx = typeText(makeNavEditor(), "abcאבג");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 3);
    ctx = withCaretAffinity(ctx, "after");
    // sanity: still collapsed (the seed branch is gated on isCollapsed)
    expect(ctx.editor.selection.anchor).toEqual(ctx.editor.selection.focus);
    expect(ctx.editor.caretAffinity).toBe("after");

    ctx = expandLeft(ctx);
    expect(ctx.editor.anchorAffinity).toBe("after"); // seeded from the caret's "after"
  });

  it("persists the seeded anchorAffinity on a second (continued) extension", () => {
    let ctx = typeText(makeNavEditor(), "abcאבג");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 3);
    ctx = withCaretAffinity(ctx, "after");

    ctx = expandLeft(ctx); // collapse→extend: seed "after"
    expect(ctx.editor.anchorAffinity).toBe("after");
    ctx = expandLeft(ctx); // continued extension: persist
    expect(ctx.editor.anchorAffinity).toBe("after"); // unchanged (persist branch)
  });

  it("persists anchorAffinity on continued extension of an already-expanded selection", () => {
    // Already-extended (isCollapsed = false), anchorAffinity:"before" preset →
    // EXPAND_SELECTION takes the persist branch and leaves it untouched.
    let ctx = typeText(makeNavEditor(), "abcdef");
    const pid = firstBlockId(ctx);
    const sel = createSpan(createPosition(pid, 1), createPosition(pid, 3));
    ctx = dispatch(ctx, { type: "SET_SELECTION", selection: sel });
    ctx = withAnchorAffinity(ctx, "before");

    ctx = expandRight(ctx);
    expect(ctx.editor.anchorAffinity).toBe("before"); // persisted (not re-seeded)
  });

  it("logicalExtend (visual-exit) persists anchorAffinity", () => {
    // Drive the focus to the line's visual edge so the NEXT EXPAND_SELECTION exits
    // the line and takes the logicalExtend path. On the mixed line "abcאבג" the
    // 7-step sequence lands the focus at the Hebrew right edge (3/after); the 8th
    // press exits the line → logicalExtend. We preset anchorAffinity:"after" via the
    // collapse→extend seed and assert it survives the logicalExtend hop.
    let ctx = typeText(makeNavEditor(), "abcאבג");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 0);
    ctx = withCaretAffinity(ctx, "after");

    // First expand seeds anchorAffinity from caretAffinity ("after").
    ctx = expandRight(ctx);
    expect(ctx.editor.anchorAffinity).toBe("after");
    // Walk to the line's visual edge, then one more to exit (logicalExtend path).
    for (let i = 0; i < 6; i++) ctx = expandRight(ctx);
    ctx = expandRight(ctx); // exits the line → logicalExtend
    // caretAffinity cleared by the logical fallback; anchorAffinity persisted.
    expect(ctx.editor.caretAffinity).toBeUndefined();
    expect(ctx.editor.anchorAffinity).toBe("after");
  });

  it("pure-LTR collapse→extend seeds anchorAffinity = undefined (path stays dormant)", () => {
    // A collapsed caret in pure-LTR text has caretAffinity === undefined, so the
    // seed copies undefined → anchorAffinity stays undefined.
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 0); // caretAffinity undefined
    expect(ctx.editor.caretAffinity).toBeUndefined();

    ctx = expandRight(ctx);
    expect(ctx.editor.anchorAffinity).toBeUndefined();
  });
});

describe("EXPAND_SELECTION — affinity lifecycle", () => {
  it("sets the focus caretAffinity at a bidi boundary (survives the central reset)", () => {
    let ctx = typeText(makeNavEditor(), "abcאבג");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 0);
    // Three Shift+ArrowRights land the focus at the Latin run's right edge
    // (offset 3, "before").
    ctx = expandRight(ctx);
    ctx = expandRight(ctx);
    ctx = expandRight(ctx);
    expect(ctx.editor.selection.focus.offset).toBe(3);
    expect(ctx.editor.caretAffinity).toBe("before");
  });

  it("a subsequent edit clears caretAffinity (central reset)", () => {
    let ctx = typeText(makeNavEditor(), "abcאבג");
    const pid = firstBlockId(ctx);
    ctx = caretAt(ctx, pid, 0);
    ctx = expandRight(ctx); // 1/before
    ctx = expandRight(ctx); // 2/before
    ctx = expandRight(ctx); // 3/before (Latin right edge)
    ctx = expandRight(ctx); // flips into the Hebrew run → 6/before
    expect(ctx.editor.caretAffinity).toBeDefined();
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "x" });
    expect(ctx.editor.caretAffinity).toBeUndefined();
  });
});
