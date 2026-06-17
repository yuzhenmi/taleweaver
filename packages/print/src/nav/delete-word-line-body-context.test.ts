/**
 * #430 — DELETE_LINE with a NON-COLLAPSED selection inside a footnote
 * (embedContents) body must actually delete the selected range.
 *
 * Root cause (pre-fix): the selection-delete branch of `handleDeleteLine`
 * validated the span's blocks with `getBlock` (MAIN-TREE ONLY). For a
 * body-context range `getBlock` returns null → the handler early-returned a
 * no-op, so delete-line with a selection inside a footnote/header/footer did
 * nothing — a Google-Docs-parity editing bug. The fix mirrors the canonical
 * delete-backward path: `isCrossContextSelection` + `expandedSpanCollapsePoint`
 * (tree-aware `resolveBlock`) → `deleteRange` (tree-aware). In the print backend
 * this lives in `resolveDeleteLine`'s non-collapsed branch (returns a
 * geometry-free `DELETE_RANGE` that core applies through the same path).
 *
 * MAIN-TREE selection-delete behavior must stay UNCHANGED (covered below).
 *
 * Migrated from `packages/core/src/editor/delete-word-line-body-context.test.ts`
 * (Phase 0b: DELETE_LINE left core's reducer for the NavIntent resolver, which
 * needs the driver-built layout to find the line span). The parallel DELETE_WORD
 * cases stay in the core file (DELETE_WORD is still a pure-core action).
 * Assertions byte-identical; fixtures are authored through the public editor API.
 */
import { describe, it, expect } from "vitest";
import { resolveBlock, type BlockId, type State } from "@taleweaver/core";
import { makeNavEditor, dispatch, nav, type NavCtx } from "./nav-test-helpers";

/**
 * Tree-aware plain-text reader: `getBlock` (main-tree only) returns "" for a
 * footnote-body block (it lives in embedContents). `resolveBlock` resolves across
 * main + embed + template trees.
 */
function bodyTextOf(state: State, blockId: BlockId): string {
  const block = resolveBlock(state, blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) return "";
  return block.inlineContent.items
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

/**
 * Build a ctx with a footnote whose body contains `text`, returning the
 * footnote-body block id. INSERT_FOOTNOTE drops the caret into the body, then
 * INSERT_TEXT types into the body.
 */
function withFootnoteBodyText(text: string): { ctx: NavCtx; bodyId: BlockId } {
  let ctx = makeNavEditor();
  ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "abc" });
  ctx = dispatch(ctx, { type: "INSERT_FOOTNOTE" });
  ctx = dispatch(ctx, { type: "INSERT_TEXT", text });
  const bodyId = ctx.editor.selection.focus.blockId;
  const block = resolveBlock(ctx.editor.state, bodyId)?.block ?? null;
  if (block === null || block.inlineContent === null) {
    throw new Error("test setup: footnote body block missing inline content");
  }
  return { ctx, bodyId };
}

/** Set a non-collapsed selection [start, end) inside one block. */
function selectInBlock(ctx: NavCtx, blockId: BlockId, start: number, end: number): NavCtx {
  return dispatch(ctx, {
    type: "SET_SELECTION",
    selection: {
      anchor: { blockId, offset: start },
      focus: { blockId, offset: end },
    },
  });
}

describe("#430 — DELETE_LINE deletes a non-collapsed range inside a footnote body", () => {
  it("DELETE_LINE with a selection inside the footnote body deletes the selected text", () => {
    let { ctx, bodyId } = withFootnoteBodyText("hello world");
    expect(bodyTextOf(ctx.editor.state, bodyId)).toBe("hello world");

    // Select "world" (offsets 6..11).
    ctx = selectInBlock(ctx, bodyId, 6, 11);
    ctx = nav(ctx, { type: "DELETE_LINE" });

    expect(bodyTextOf(ctx.editor.state, bodyId)).toBe("hello ");
    expect(ctx.editor.selection.anchor).toEqual(ctx.editor.selection.focus);
    expect(ctx.editor.selection.focus).toEqual({ blockId: bodyId, offset: 6 });
  });
});

describe("#430 — main-tree DELETE_LINE selection delete unchanged", () => {
  it("DELETE_LINE with a selection in the MAIN tree deletes the selection", () => {
    let ctx = makeNavEditor();
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "hello world" });
    const blockId = ctx.editor.selection.focus.blockId;
    ctx = selectInBlock(ctx, blockId, 6, 11);
    ctx = nav(ctx, { type: "DELETE_LINE" });
    expect(bodyTextOf(ctx.editor.state, blockId)).toBe("hello ");
    expect(ctx.editor.selection.anchor).toEqual(ctx.editor.selection.focus);
    expect(ctx.editor.selection.focus).toEqual({ blockId, offset: 6 });
  });
});
