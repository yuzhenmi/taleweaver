/**
 * `INSERT_HORIZONTAL_LINE` / `handleInsertHorizontalLine` — Google Docs Insert ▸
 * Horizontal line. Inserts a `horizontal-line` atomic-leaf block immediately
 * after the caret's block, followed by a fresh empty paragraph; the caret lands
 * at the start of that paragraph (so the doc stays editable below the rule).
 * One undo entry.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  firstChildId,
  createPosition,
  createSpan,
} from "./test-helpers";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";

describe("handleInsertHorizontalLine — INSERT_HORIZONTAL_LINE (#L11.1)", () => {
  it("inserts a horizontal-line + trailing paragraph after the caret block", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "above" });
    const paraId = firstChildId(editor.document) as BlockId;

    const next = reduceEditor(editor, { type: "INSERT_HORIZONTAL_LINE" });

    // Document order: para → hr → new paragraph.
    const hrId = getBlock(next.document, paraId)?.nextSiblingId ?? null;
    expect(hrId).not.toBeNull();
    const hr = hrId !== null ? getBlock(next.document, hrId) : null;
    expect(hr?.type).toBe("horizontal-line");

    const trailingId = hr?.nextSiblingId ?? null;
    expect(trailingId).not.toBeNull();
    const trailing = trailingId !== null ? getBlock(next.document, trailingId) : null;
    expect(trailing?.type).toBe("paragraph");

    // The original paragraph keeps its content.
    expect(getBlock(next.document, paraId)?.inlineContent?.items[0]).toMatchObject({
      kind: "text",
      text: "above",
    });
  });

  it("places the caret at the start of the new trailing paragraph", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" });
    const paraId = firstChildId(editor.document) as BlockId;

    const next = reduceEditor(editor, { type: "INSERT_HORIZONTAL_LINE" });

    const hrId = getBlock(next.document, paraId)?.nextSiblingId ?? null;
    const trailingId = hrId !== null ? getBlock(next.document, hrId)?.nextSiblingId ?? null : null;
    expect(next.selection.focus.blockId).toBe(trailingId);
    expect(next.selection.focus.offset).toBe(0);
    // Collapsed caret.
    expect(next.selection.anchor).toEqual(next.selection.focus);
  });

  it("splices the rule + paragraph BETWEEN the focus block and its existing next sibling", () => {
    // Build two paragraphs: "a" then an empty one (Enter at end of "a").
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    const para2 = firstChildId(editor.document) as BlockId;
    editor = reduceEditor(editor, { type: "SPLIT_NODE" });
    // the head "a" is the new block; the original keeps the (empty) tail.
    const para1 = getBlock(editor.document, para2)?.prevSiblingId ?? null;
    expect(para1).not.toBeNull();
    if (para1 === null) return;

    // Put the caret back in para1, then insert the rule.
    const caretInPara1 = createPosition(para1, 1);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(caretInPara1, caretInPara1) },
    );
    const next = reduceEditor(editor, { type: "INSERT_HORIZONTAL_LINE" });

    // Order: para1 → hr → trailingPara → para2 (the run is spliced between).
    const hrId = getBlock(next.document, para1)?.nextSiblingId ?? null;
    expect(getBlock(next.document, hrId as BlockId)?.type).toBe("horizontal-line");
    const trailingId = getBlock(next.document, hrId as BlockId)?.nextSiblingId ?? null;
    expect(getBlock(next.document, trailingId as BlockId)?.type).toBe("paragraph");
    expect(getBlock(next.document, trailingId as BlockId)?.nextSiblingId).toBe(para2);
    // Caret lands in the NEW trailing paragraph, not the pre-existing para2.
    expect(next.selection.focus.blockId).toBe(trailingId);
  });

  it("is a no-op when the caret is in a header body (not the main tree)", () => {
    let editor = createInitialEditorState(config);
    // INSERT_HEADER moves the caret into the header body (a templateContents
    // tree, not the main blocks tree). getBlock (main-tree-only) returns null
    // there, so INSERT_HORIZONTAL_LINE must no-op rather than throw (D3).
    editor = reduceEditor(editor, { type: "INSERT_HEADER" });
    const inHeaderBody = getBlock(editor.document, editor.selection.focus.blockId) === null;
    expect(inHeaderBody).toBe(true); // precondition: caret is outside the main tree

    const next = reduceEditor(editor, { type: "INSERT_HORIZONTAL_LINE" });
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.document).toBe(editor.document);
  });

  it("undo removes the rule and the trailing paragraph", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "y" });
    const paraId = firstChildId(editor.document) as BlockId;
    // Baseline: the paragraph is the doc's only/last child.
    expect(getBlock(editor.document, paraId)?.nextSiblingId).toBeNull();

    const inserted = reduceEditor(editor, { type: "INSERT_HORIZONTAL_LINE" });
    expect(getBlock(inserted.document, paraId)?.nextSiblingId).not.toBeNull();

    const undone = reduceEditor(inserted, { type: "UNDO" });
    // Back to the paragraph being the last child — both inserted blocks gone.
    expect(getBlock(undone.document, paraId)?.nextSiblingId).toBeNull();
  });
});
