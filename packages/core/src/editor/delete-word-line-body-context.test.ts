/**
 * #430 — DELETE_WORD with a NON-COLLAPSED selection inside a footnote
 * (embedContents) / header-footer (templateContents) body must actually delete
 * the selected range.
 *
 * Root cause (pre-fix): the selection-delete branch of `handleDeleteWord`
 * validated the span's blocks with `getBlock` (MAIN-TREE ONLY). For a
 * body-context range `getBlock` returns null → the handler early-returned a
 * no-op, so Ctrl/Alt+Backspace (delete-word) with a selection inside a
 * footnote/header/footer did nothing — a Google-Docs-parity editing bug. The fix
 * mirrors the canonical delete-backward path: `isCrossContextSelection` +
 * `expandedSpanCollapsePoint` (tree-aware `resolveBlock`) → `deleteRange`
 * (tree-aware).
 *
 * MAIN-TREE selection-delete behavior must stay UNCHANGED (covered below).
 *
 * NOTE: the parallel DELETE_LINE cases for the SAME #430 fix moved to
 * `packages/print/src/nav/delete-word-line-body-context.test.ts` in Phase 0b —
 * DELETE_LINE left core's reducer for the print backend's NavIntent resolver
 * (which needs the driver-built layout to find the line span). DELETE_WORD stays
 * a pure-core action and is covered here.
 */
import { describe, it, expect } from "vitest";
import {
  config, createEditor } from "./actions/test-helpers";
import type { Editor } from "./editor";
import { resolveBlock, inlineContentLength } from "../state";
import type { BlockId, Document } from "../state";

/**
 * Tree-aware plain-text reader: the test-helpers `getTextOf` uses `getBlock`
 * (main-tree only), which returns "" for a footnote-body block (it lives in
 * embedContents). `resolveBlock` resolves across main + embed + template trees.
 */
function bodyTextOf(document: Document, blockId: BlockId): string {
  const block = resolveBlock(document, blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) return "";
  return block.inlineContent.items
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

/**
 * Build an editor with a footnote whose body contains `text`, returning the
 * footnote-body block id and its (current) content length. INSERT_FOOTNOTE
 * drops the caret into the body, then INSERT_TEXT types into the body.
 */
function withFootnoteBodyText(text: string): {
  editor: Editor;
  bodyId: BlockId;
  bodyLength: number;
} {
  const initial = createEditor(config);
  initial.dispatch({ type: "INSERT_TEXT", text: "abc" });
  initial.dispatch({ type: "INSERT_FOOTNOTE" });
  initial.dispatch({ type: "INSERT_TEXT", text });
  const bodyId = initial.selection.focus.blockId;
  const block = resolveBlock(initial.document, bodyId)?.block ?? null;
  if (block === null || block.inlineContent === null) {
    throw new Error("test setup: footnote body block missing inline content");
  }
  return {
    editor: initial,
    bodyId,
    bodyLength: inlineContentLength(block.inlineContent),
  };
}

/** Set a non-collapsed selection [start, end) inside one block. */
function selectInBlock(
  editor: Editor,
  blockId: BlockId,
  start: number,
  end: number,
): Editor {
  editor.dispatch({
      type: "SET_SELECTION",
      selection: {
        anchor: { blockId, offset: start },
        focus: { blockId, offset: end },
      },
    });
    return editor;
}

describe("#430 — DELETE_WORD deletes a non-collapsed range inside a footnote body", () => {
  it("DELETE_WORD with a selection inside the footnote body deletes the selected text", () => {
    let { editor, bodyId, bodyLength } = withFootnoteBodyText("hello world");
    expect(bodyTextOf(editor.document, bodyId)).toBe("hello world");

    // Select "hello " (offsets 0..6).
    editor = selectInBlock(editor, bodyId, 0, 6);
    editor.dispatch({ type: "DELETE_WORD", direction: "backward" });

    // The selected range is deleted (NOT extended by word — a selection delete
    // just removes the selection). Body shrinks from "hello world" → "world".
    expect(bodyTextOf(editor.document, bodyId)).toBe("world");
    // Caret collapses to the deletion point in the body.
    expect(editor.selection.anchor).toEqual(editor.selection.focus);
    expect(editor.selection.focus).toEqual({ blockId: bodyId, offset: 0 });
    // Body length dropped by the deleted length.
    const block = resolveBlock(editor.document, bodyId)?.block ?? null;
    if (block === null || block.inlineContent === null) {
      throw new Error("expected a resolvable body block");
    }
    expect(inlineContentLength(block.inlineContent)).toBe(bodyLength - 6);
  });
});

describe("#430 — main-tree DELETE_WORD selection delete unchanged", () => {
  it("DELETE_WORD with a selection in the MAIN tree deletes the selection", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hello world" });
    const blockId = initial.selection.focus.blockId;
    const selected = selectInBlock(initial, blockId, 0, 6);
    selected.dispatch({ type: "DELETE_WORD", direction: "backward" });
    expect(bodyTextOf(selected.document, blockId)).toBe("world");
    expect(selected.selection.anchor).toEqual(selected.selection.focus);
    expect(selected.selection.focus).toEqual({ blockId, offset: 0 });
  });
});
