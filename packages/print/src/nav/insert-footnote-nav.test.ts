/**
 * Bug-A-class siblings: keyboard navigation and selection ACROSS an inline-block
 * footnote call-marker. The marker is a 1-unit `EmbedItem` in the host paragraph
 * — `"abc"` (offsets 0..3) followed by the marker, which occupies one offset
 * unit, so the position BEFORE the marker is offset 3 and the position AFTER is
 * offset 4 (= block end). Every nav/selection primitive must treat the marker as
 * a SINGLE atomic cursor stop with a before/after position — never step into its
 * inner body text, never skip it, never land off-by-one.
 *
 * Phase 0b: MOVE_CURSOR / EXPAND_SELECTION / MOVE_LINE_BOUNDARY left core's
 * geometry-free reducer for the print backend's `resolveNavIntent`. These tests
 * therefore drive those keystrokes through the nav helper (driver layout →
 * resolveNavIntent → reduceEditor) end-to-end. The MOVE_WORD / DELETE_BACKWARD
 * sibling cases (still geometry-free core actions) stay in core's
 * `insert-footnote-action.test.ts`. Migrated from there; assertions byte-identical.
 *
 * Fixture: type "abc", caret to the end (offset 3), INSERT_FOOTNOTE splices the
 * marker at 3, then SET_SELECTION places a collapsed caret back in the MAIN
 * paragraph (INSERT_FOOTNOTE leaves the caret inside the new body) at the
 * requested offset. Offsets: 0..3 = "abc", 3 = before marker, 4 = after marker
 * (block end).
 */
import { describe, it, expect } from "vitest";
import { getBlock, FOOTNOTE_ANCHOR_EMBED_TYPE, type BlockId } from "@taleweaver/core";
import {
  makeNavEditor,
  typeText,
  caretAt,
  dispatch,
  nav,
  firstBlockId,
  type NavCtx,
} from "./nav-test-helpers";

/** All footnote-anchor embeds in a leaf block's inlineContent. */
function anchorEmbedsOf(ctx: NavCtx, blockId: BlockId): ReadonlyArray<{ contentBlockId: BlockId }> {
  const block = getBlock(ctx.editor.state, blockId);
  const items = block?.inlineContent?.items ?? [];
  const out: { contentBlockId: BlockId }[] = [];
  for (const it of items) {
    if (it.kind !== "embed") continue;
    if (it.embedType !== FOOTNOTE_ANCHOR_EMBED_TYPE) continue;
    const cb = it.properties.contentBlockId;
    if (typeof cb === "string") out.push({ contentBlockId: cb as BlockId });
  }
  return out;
}

/**
 * Build a ctx whose main paragraph is "abc" + a footnote marker, with a
 * collapsed caret at `caretOffset` in that main paragraph. Offsets: 0..3 =
 * "abc", 3 = before marker, 4 = after marker (block end).
 */
function markerFixture(caretOffset: number): { ctx: NavCtx; paraId: BlockId } {
  let ctx = typeText(makeNavEditor(), "abc");
  const paraId = firstBlockId(ctx);
  ctx = caretAt(ctx, paraId, 3);
  ctx = dispatch(ctx, { type: "INSERT_FOOTNOTE" });
  // The marker is now a 1-unit embed at index after "abc": block length is 4.
  expect(anchorEmbedsOf(ctx, paraId).length).toBe(1);
  // Caret back into the main paragraph at the requested offset.
  ctx = caretAt(ctx, paraId, caretOffset);
  expect(ctx.editor.selection.focus.blockId).toBe(paraId);
  expect(ctx.editor.selection.focus.offset).toBe(caretOffset);
  return { ctx, paraId };
}

describe("nav + selection across an inline-block footnote marker (Bug-A siblings)", () => {
  // (1) MOVE_CURSOR right from BEFORE the marker (offset 3) steps OVER it as a
  // single stop, landing AFTER it (offset 4) — never into its inner body text.
  it("MOVE_CURSOR forward from offset 3 (before marker) lands at offset 4 (after marker), one step", () => {
    const { ctx, paraId } = markerFixture(3);
    const moved = nav(ctx, { type: "MOVE_CURSOR", direction: "forward" });
    expect(moved.editor.selection.focus.blockId).toBe(paraId);
    expect(moved.editor.selection.focus.offset).toBe(4);
    // Collapsed (a move, not a selection).
    expect(moved.editor.selection.anchor.offset).toBe(4);
  });

  // (2) MOVE_CURSOR left from AFTER the marker (offset 4) lands BEFORE it
  // (offset 3) in one step — the symmetric ArrowLeft case.
  it("MOVE_CURSOR backward from offset 4 (after marker) lands at offset 3 (before marker), one step", () => {
    const { ctx, paraId } = markerFixture(4);
    const moved = nav(ctx, { type: "MOVE_CURSOR", direction: "backward" });
    expect(moved.editor.selection.focus.blockId).toBe(paraId);
    expect(moved.editor.selection.focus.offset).toBe(3);
    expect(moved.editor.selection.anchor.offset).toBe(3);
  });

  // (4) EXPAND_SELECTION (Shift+Arrow) selects the 1-unit marker as a unit.
  it("EXPAND_SELECTION forward from offset 3 selects the marker (anchor 3, focus 4)", () => {
    const { ctx, paraId } = markerFixture(3);
    const sel = nav(ctx, { type: "EXPAND_SELECTION", direction: "forward" });
    expect(sel.editor.selection.anchor.blockId).toBe(paraId);
    expect(sel.editor.selection.anchor.offset).toBe(3);
    expect(sel.editor.selection.focus.blockId).toBe(paraId);
    expect(sel.editor.selection.focus.offset).toBe(4);
  });

  it("EXPAND_SELECTION backward from offset 4 selects the marker (anchor 4, focus 3)", () => {
    const { ctx, paraId } = markerFixture(4);
    const sel = nav(ctx, { type: "EXPAND_SELECTION", direction: "backward" });
    expect(sel.editor.selection.anchor.blockId).toBe(paraId);
    expect(sel.editor.selection.anchor.offset).toBe(4);
    expect(sel.editor.selection.focus.blockId).toBe(paraId);
    expect(sel.editor.selection.focus.offset).toBe(3);
  });

  // (6) MOVE_LINE_BOUNDARY (Home/End) on the line carrying the marker: End lands
  // AFTER the marker (offset 4 = the line's true end, the 1-unit embed counted in
  // `inlineOffsetEnd`); Home lands at line start (offset 0).
  it("MOVE_LINE_BOUNDARY end lands AFTER the marker (offset 4); start at line start (offset 0)", () => {
    const { ctx, paraId } = markerFixture(3);
    const end = nav(ctx, { type: "MOVE_LINE_BOUNDARY", boundary: "end" });
    expect(end.editor.selection.focus.blockId).toBe(paraId);
    expect(end.editor.selection.focus.offset).toBe(4);
    const home = nav(end, { type: "MOVE_LINE_BOUNDARY", boundary: "start" });
    expect(home.editor.selection.focus.blockId).toBe(paraId);
    expect(home.editor.selection.focus.offset).toBe(0);
  });
});
