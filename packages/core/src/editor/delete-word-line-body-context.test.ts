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
  config,
  reduceEditor,
  createInitialEditorState,
} from "./actions/test-helpers";
import type { EditorState } from "./editor-state";
import { resolveBlock, inlineContentLength } from "../state";
import type { BlockId, State } from "../state";

/**
 * Tree-aware plain-text reader: the test-helpers `getTextOf` uses `getBlock`
 * (main-tree only), which returns "" for a footnote-body block (it lives in
 * embedContents). `resolveBlock` resolves across main + embed + template trees.
 */
function bodyTextOf(state: State, blockId: BlockId): string {
  const block = resolveBlock(state, blockId)?.block ?? null;
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
  editor: EditorState;
  bodyId: BlockId;
  bodyLength: number;
} {
  const initial = createInitialEditorState(config);
  const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
  const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, config);
  const bodyTyped = reduceEditor(withFn, { type: "INSERT_TEXT", text }, config);
  const bodyId = bodyTyped.selection.focus.blockId;
  const block = resolveBlock(bodyTyped.state, bodyId)?.block ?? null;
  if (block === null || block.inlineContent === null) {
    throw new Error("test setup: footnote body block missing inline content");
  }
  return {
    editor: bodyTyped,
    bodyId,
    bodyLength: inlineContentLength(block.inlineContent),
  };
}

/** Set a non-collapsed selection [start, end) inside one block. */
function selectInBlock(
  editor: EditorState,
  blockId: BlockId,
  start: number,
  end: number,
): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: {
        anchor: { blockId, offset: start },
        focus: { blockId, offset: end },
      },
    },
    config,
  );
}

describe("#430 — DELETE_WORD deletes a non-collapsed range inside a footnote body", () => {
  it("DELETE_WORD with a selection inside the footnote body deletes the selected text", () => {
    let { editor, bodyId, bodyLength } = withFootnoteBodyText("hello world");
    expect(bodyTextOf(editor.state, bodyId)).toBe("hello world");

    // Select "hello " (offsets 0..6).
    editor = selectInBlock(editor, bodyId, 0, 6);
    editor = reduceEditor(
      editor,
      { type: "DELETE_WORD", direction: "backward" },
      config,
    );

    // The selected range is deleted (NOT extended by word — a selection delete
    // just removes the selection). Body shrinks from "hello world" → "world".
    expect(bodyTextOf(editor.state, bodyId)).toBe("world");
    // Caret collapses to the deletion point in the body.
    expect(editor.selection.anchor).toEqual(editor.selection.focus);
    expect(editor.selection.focus).toEqual({ blockId: bodyId, offset: 0 });
    // Body length dropped by the deleted length.
    const block = resolveBlock(editor.state, bodyId)?.block ?? null;
    if (block === null || block.inlineContent === null) {
      throw new Error("expected a resolvable body block");
    }
    expect(inlineContentLength(block.inlineContent)).toBe(bodyLength - 6);
  });
});

describe("#430 — main-tree DELETE_WORD selection delete unchanged", () => {
  it("DELETE_WORD with a selection in the MAIN tree deletes the selection", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "hello world" }, config);
    const blockId = typed.selection.focus.blockId;
    const selected = selectInBlock(typed, blockId, 0, 6);
    const after = reduceEditor(
      selected,
      { type: "DELETE_WORD", direction: "backward" },
      config,
    );
    expect(bodyTextOf(after.state, blockId)).toBe("world");
    expect(after.selection.anchor).toEqual(after.selection.focus);
    expect(after.selection.focus).toEqual({ blockId, offset: 0 });
  });
});
