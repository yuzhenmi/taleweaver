// Behavior regression tests for the virtualized-layout caret + paint path.
// These reproduce two user-reported regressions (2026-05-24):
//   Bug A: ArrowUp after Enter doesn't move the caret until pressed twice
//          (caret pixel position on the virtual tree diverges from the truth).
//   Bug B: Enter at the start of the first line still PAINTS the old text on
//          line 0 (the materialized page-0 content is stale).
//
// Root cause (fixed): `materializePage` threaded a per-page `prevLayoutCache`
// built from the prior tree's PageBox so unchanged blocks reused their boxes —
// but a SHIFTED block (e.g. text pushed to the next line by an inserted empty
// paragraph) was reused at its STALE offset instead of being repositioned.
//
// Oracle: a FRESH, non-incremental `layoutTree` of the editor's CURRENT state
// (render → cascade → layoutTree, no prevTree → no carry-forward, no reuse) is
// the independent ground truth. The driver's INCREMENTAL layout must agree with
// it. (Comparing the virtual tree to its own assembled pages is NOT
// independent — the assembly calls the same `getPage`, so both go stale
// together; the earlier version of this test had that flaw.)
//
// Migrated from `packages/core/src/integration/virtual-edit-regression.test.ts`
// (Phase 0b: the incremental render→cascade→layout pipeline left core's reducer
// for the print backend's `LayoutDriver`, and MOVE_LINE became a NavIntent). The
// "incremental tree" is now the driver's output across edits (it retains the
// prior-cycle trees and reuses by reference, keyed off `lastDirtyIds`), warmed by
// calling `layoutOf` + `paintAllPages` after each edit exactly as the controller
// paints every frame. Assertions byte-identical.
import { describe, it, expect } from "vitest";
import { render, cascadePass, getBlock, type EditorState, type EditorConfig, type BlockId } from "@taleweaver/core";
import { layoutTree, moveToLine, type LayoutBox, type VirtualLayoutTree } from "../index";
import {
  makeNavEditor,
  layoutOf,
  dispatch,
  nav,
  type NavCtx,
  type MakeNavEditorOptions,
} from "./nav-test-helpers";

const PAGE_OPTS: MakeNavEditorOptions = {
  containerWidth: 800,
  charWidth: 8,
  lineHeight: 16,
  pageConfig: {
    pageInlineSize: 816,
    pageBlockSize: 1056,
    pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
    pageGap: 24,
  },
};

/**
 * Independent ground truth: a fresh, non-incremental layout of the editor's
 * CURRENT state, built straight off the core pipeline (no prevTree → no reuse).
 * The measurer + pageConfig match the driver's (mock 8/16, PAGE_OPTS geometry).
 */
function freshLayout(ctx: NavCtx, editor: EditorState): LayoutBox | VirtualLayoutTree {
  const config: EditorConfig = ctx.config;
  const rendered = render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascadedRoot = cascadePass(rendered.root);
  if (config.pageConfig === undefined) throw new Error("expected a pageConfig");
  return layoutTree(cascadedRoot, config.containerWidth, ctx.measurer, config.pageConfig);
}

/**
 * Force every page of `lt` to materialize, exactly as the DOM controller does
 * each frame when it paints visible pages. This is load-bearing for these
 * regressions: the per-page subtree-reuse path only engages when the PRIOR tree
 * (the one handed to the next edit as `prevTree`) already had its pages
 * materialized. A test that edits without ever painting never exercises that
 * path and passes even when it is broken.
 */
function paintAllPages(lt: LayoutBox | VirtualLayoutTree): void {
  if (lt.type === "virtual-root") {
    for (let i = 0; i < lt.plan.entries.length; i++) lt.getPage(i);
  }
}

/**
 * Warm the driver's incremental memo for the current state, returning the freshly
 * built (and fully materialized) incremental tree — the controller's per-frame
 * paint. Calling this after EACH edit threads the driver's retained `prev` trees
 * into the next rebuild (the incremental path).
 */
function paintFrame(ctx: NavCtx): LayoutBox | VirtualLayoutTree {
  const lt = layoutOf(ctx);
  paintAllPages(lt);
  return lt;
}

function firstBlockIdOf(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("no first block");
  return root.firstChildId;
}

/** Build a small multi-paragraph doc (each paragraph one line). */
function buildDoc(paras: number): NavCtx {
  let ctx = makeNavEditor(PAGE_OPTS);
  const firstId = firstBlockIdOf(ctx.editor);
  ctx = dispatch(ctx, {
    type: "SET_SELECTION",
    selection: { anchor: { blockId: firstId, offset: 0 }, focus: { blockId: firstId, offset: 0 } },
  });
  for (let i = 0; i < paras; i++) {
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: `para ${i}` });
    if (i < paras - 1) ctx = dispatch(ctx, { type: "SPLIT_NODE" });
  }
  return ctx;
}

describe("virtual-layout caret/paint regressions", () => {
  it("Bug A: ArrowUp after Enter-at-start moves the caret up on the FIRST press", () => {
    // User repro: from the initial doc, Enter at the very start of line 1, then
    // ArrowUp. The caret must move up immediately (the bug needed two presses
    // because the stale page geometry left the text overlapping line 0).
    let ctx = buildDoc(5);
    const firstId = firstBlockIdOf(ctx.editor);
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: { anchor: { blockId: firstId, offset: 0 }, focus: { blockId: firstId, offset: 0 } },
    });
    paintFrame(ctx); // controller paints page 0 before the edit
    ctx = dispatch(ctx, { type: "SPLIT_NODE" });
    paintFrame(ctx); // ...and again before ArrowUp (the visible frame)

    // SANITY CHECK (not the regression guard): MOVE_LINE moves the caret to a
    // different block on the first press. The MODEL navigation was already
    // robust to the stale-geometry bug, so this passed even when the bug was
    // present — it only documents the expected model behavior, and must NOT be
    // mistaken for (or removed in favor of) the geometry guard below.
    const beforeUp = ctx.editor.selection.focus;
    ctx = nav(ctx, { type: "MOVE_LINE", direction: "up" });
    expect(ctx.editor.selection.focus.blockId).not.toEqual(beforeUp.blockId);

    // THE BUG-A REGRESSION GUARD: the user saw "ArrowUp doesn't move" because
    // the PAINTED page was stale (text overlapping line 0), even though the
    // model moved. MOVE_LINE changes only the selection, not the layout, so the
    // page the controller would paint is still the post-Enter page — it MUST
    // match a fresh layout, not the stale memoized geometry. This assertion is
    // what fails when the bug is present; do not drop it.
    const incremental = paintFrame(ctx);
    if (incremental.type !== "virtual-root") throw new Error("expected virtual-root");
    const fresh = freshLayout(ctx, ctx.editor);
    if (fresh.type !== "virtual-root") throw new Error("expected fresh virtual-root");
    expect(incremental.getPage(0)).toEqual(fresh.getPage(0));
  });

  it("Bug B: page 0 from the incremental tree matches a fresh layout after Enter-at-start", () => {
    let ctx = buildDoc(5);
    const firstId = firstBlockIdOf(ctx.editor);
    // Caret at the very start of the first block, then Enter.
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: { anchor: { blockId: firstId, offset: 0 }, focus: { blockId: firstId, offset: 0 } },
    });
    paintFrame(ctx); // controller paints page 0 before the edit
    ctx = dispatch(ctx, { type: "SPLIT_NODE" });

    const incremental = paintFrame(ctx);
    if (incremental.type !== "virtual-root") throw new Error("expected virtual-root");
    const fresh = freshLayout(ctx, ctx.editor);
    if (fresh.type !== "virtual-root") throw new Error("expected fresh virtual-root");

    // getPage(0) (the box the controller paints) must match a FRESH layout's
    // page 0 — i.e. it must NOT be a stale page still showing old text on line 0.
    expect(incremental.getPage(0)).toEqual(fresh.getPage(0));
  });

  it("Phase-4: MOVE_LINE up through the real handler matches a fresh-layout oracle (multi-page)", () => {
    // Wired path: MOVE_LINE NavIntent → resolveNavIntent → moveToLine(virtual
    // tree). On a multi-page doc, a caret on a later page must navigate up via
    // the per-page path and land exactly where a FRESH non-incremental layout's
    // moveToLine says it should — guarding the per-page line-nav against the
    // bridge it replaced.
    const text = Array.from({ length: 120 }, (_, i) => `para ${i}`).join("\n");
    let ctx = makeNavEditor(PAGE_OPTS);
    ctx = dispatch(ctx, { type: "PASTE", text });

    // Caret in a mid-document block (well past page 0), then paint (the
    // controller does this every frame — warms the per-page memo).
    let id: BlockId | null = firstBlockIdOf(ctx.editor);
    for (let i = 0; i < 60 && id !== null; i++) {
      id = getBlock(ctx.editor.state, id)?.nextSiblingId ?? null;
    }
    if (id === null) throw new Error("no block 60");
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: { anchor: { blockId: id, offset: 2 }, focus: { blockId: id, offset: 2 } },
    });
    paintFrame(ctx);

    const before = ctx.editor;
    const oracle = moveToLine(
      before.state,
      before.selection.focus,
      freshLayout(ctx, before),
      ctx.measurer,
      "up",
      before.targetX,
    );
    if (oracle === null) throw new Error("oracle move failed");

    ctx = nav(ctx, { type: "MOVE_LINE", direction: "up" });

    // Moved, and to exactly where a fresh layout would put it.
    expect(ctx.editor.selection.focus).not.toEqual(before.selection.focus);
    expect(ctx.editor.selection.focus).toEqual(oracle.position);
  });
});
